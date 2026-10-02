import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import {
  assignExistingTechnicianAndLockBusySlot,
  assignNearestTechnicianAndLockBusySlot,
  isSlotStillAvailable,
} from "@/lib/booking/allocation";
import { buildFullAddress, addressFormToBookingAddress } from "@/lib/booking/address";
import { generateBookingCode } from "@/lib/booking/booking-code";
import { resolveBookingSlot, isSlotPast, isPastDateKey } from "@/lib/booking/slots";
import { slotLabelFromIndex } from "@/lib/booking/technician-slots";
import { getServiceCategoryId } from "@/lib/booking/slot-availability";
import type { BookingDraft, ServiceDoc } from "@/lib/booking/types";
import {
  getCustomerProfile,
  incrementCustomerBookings,
  saveCustomerAddresses,
  saveLastUsedAddress,
} from "@/lib/firebase/customer";
import {
  bookingAddressFromForm,
  upsertSavedAddress,
} from "@/lib/booking/saved-addresses";
import { getAuthClient } from "@/lib/firebase/auth";
import {
  buildLocalCheckoutQuote,
  calculatePartnerEconomics,
  type CheckoutQuoteLine,
} from "@/lib/pricing";
import { NO_PARTNER_FOR_SLOT, SLOT_NO_LONGER_AVAILABLE } from "@/lib/booking/messages";
import {
  getServiceName,
  getActiveVariations,
  getServicePrice,
} from "@/lib/services/helpers";
import {
  canClaimRevisit,
  normalizeRevisitPolicy,
} from "@/lib/booking/revisit";

function scheduledAtFromLocalSlot(dateKey: string, startHour: number): Date {
  const parts = String(dateKey).trim().split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return new Date(NaN);
  }
  const [y, m, d] = parts;
  return new Date(y, m - 1, d, startHour, 0, 0, 0);
}

const BOOKING_STATUS = { NEW: "New", ASSIGNED: "Assigned" } as const;

async function resolveCategoryName(
  db: Firestore,
  categoryId: string,
  fallback?: string,
): Promise<string> {
  const trimmed = String(fallback ?? "").trim();
  if (trimmed) return trimmed;
  const cid = String(categoryId ?? "").trim();
  if (!cid) return "Category";
  try {
    const snap = await getDoc(doc(db, "categories", cid));
    if (snap.exists()) {
      const name = String((snap.data() as { name?: string }).name ?? "").trim();
      if (name) return name;
    }
  } catch {
    /* optional */
  }
  return "Category";
}

export async function createCustomerBooking(
  db: Firestore,
  params: {
    customerId: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    service: ServiceDoc;
    draft: BookingDraft;
    notes?: string;
    revisitFromBookingId?: string;
    promoCode?: string;
    discountAmount?: number;
    /** When set, assign this technician (cart follow-up / shared tech). */
    preferredTechnicianId?: string;
    /** This booking's line from a whole-cart quote (category-wise convenience fee). */
    quoteLine?: CheckoutQuoteLine;
    quantity?: number;
  },
): Promise<{ bookingId: string; status: string; technicianId: string | null }> {
  const liveUser = getAuthClient()?.currentUser;
  if (!liveUser) {
    throw Object.assign(new Error("Sign in required"), { status: 401 });
  }
  if (params.customerId && params.customerId !== liveUser.uid) {
    throw Object.assign(new Error("Not allowed"), { status: 403 });
  }
  const customerId = liveUser.uid;
  const { customerName, customerPhone, customerEmail, service, draft } = params;
  const revisitFrom = String(params.revisitFromBookingId || "").trim();
  let revisitTechnicianId = String(params.preferredTechnicianId || "").trim();
  let parentServicePolicy: Record<string, unknown> | undefined;
  if (revisitFrom) {
    const parentSnap = await getDoc(doc(db, "bookings", revisitFrom));
    if (!parentSnap.exists()) {
      throw new Error("Original booking not found for revisit.");
    }
    const parent = {
      id: parentSnap.id,
      ...(parentSnap.data() as Record<string, unknown>),
    } as Record<string, unknown> & { id: string };
    if (String(parent.customerId || "") !== customerId) {
      throw new Error("You can only claim revisits on your own bookings.");
    }
    const svcPolicy = (service as { revisitPolicy?: Record<string, unknown> })
      .revisitPolicy;
    parentServicePolicy = svcPolicy;
    if (!canClaimRevisit(parent as Record<string, unknown>, svcPolicy)) {
      throw new Error("No free revisits remaining on this booking.");
    }
    revisitTechnicianId = String(
      parent.technicianId ||
        parent.assignedTechnicianId ||
        parent.techId ||
        "",
    ).trim();
    if (!revisitTechnicianId) {
      throw new Error("Previous technician not found for this booking.");
    }
  }
  const slot = resolveBookingSlot(draft.slotId, draft.slotIndex);
  if (!slot) throw new Error("Invalid time slot selected.");

  if (isPastDateKey(draft.dateKey)) {
    throw new Error("Cannot book a past date.");
  }
  if (isSlotPast(draft.dateKey, slot)) {
    throw new Error("This time slot has already passed. Please choose a future slot.");
  }

  const bookingAddress = addressFormToBookingAddress(draft.address);
  const userLat = Number(bookingAddress.lat);
  const userLng = Number(bookingAddress.lng);
  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
    throw new Error(
      "Location coordinates are required. Use current location or confirm your address.",
    );
  }

  const stillFree = await isSlotStillAvailable(db, {
    service,
    userLat,
    userLng,
    dateStr: draft.dateKey,
    slotIndex: slot.slotIndex,
  });
  if (!stillFree) {
    throw new Error(
      "This slot is no longer available. Please select another slot.",
    );
  }

  const scheduledAtDate = scheduledAtFromLocalSlot(draft.dateKey, slot.startHour);
  if (Number.isNaN(scheduledAtDate.getTime())) {
    throw new Error("Invalid booking date.");
  }

  const variationId = draft.variationId?.trim() ?? "";
  let selectedVariations: Array<{
    variationId: string;
    title: string;
    price: number;
    quantity: number;
  }> = [];
  let servicePrice = 0;

  const activeVariations = getActiveVariations(service);
  if (service.hasVariations || activeVariations.length > 0) {
    if (!variationId) throw new Error("Select a service option.");
    const match = activeVariations.find((v) => String(v.id) === variationId);
    if (!match) throw new Error("Invalid service option.");
    servicePrice = match.price;
    selectedVariations = [
      {
        variationId: match.id,
        title: match.title,
        price: match.price,
        quantity: 1,
      },
    ];
  } else {
    servicePrice = getServicePrice(service) ?? 0;
  }

  if (!Number.isFinite(servicePrice) || servicePrice < 0) {
    throw new Error("Invalid service price.");
  }

  const categoryId = getServiceCategoryId(service);
  let priced: CheckoutQuoteLine | null = null;
  if (!revisitFrom) {
    if (params.quoteLine) {
      priced = params.quoteLine;
    } else {
      const qty = Math.max(1, Math.round(Number(params.quantity) || 1));
      priced =
        buildLocalCheckoutQuote({
          items: [
            {
              lineId: service.id,
              serviceId: service.id,
              variationId: variationId || undefined,
              categoryId,
              unitPrice: servicePrice,
              quantity: qty,
            },
          ],
          discountAmount: params.discountAmount,
        }).lines[0] ?? null;
    }
    if (!priced) throw new Error("Could not confirm the booking amount.");
    servicePrice = priced.customer.serviceAmount;
  }

  const discountAmount = revisitFrom
    ? 0
    : Math.max(
        0,
        Math.round((Number(priced?.customer.discount ?? params.discountAmount) || 0) * 100) / 100,
      );
  const snapRates = (priced?.snapshot ?? {}) as Record<string, unknown>;
  const promoCode = revisitFrom
    ? ""
    : String(params.promoCode || "").trim().toUpperCase();
  const fullAddress = buildFullAddress(draft.address);
  const durationMinutes = 60;
  const categoryName = await resolveCategoryName(
    db,
    categoryId,
    (service as { categoryName?: string }).categoryName,
  );
  const slotLabel =
    String(draft.scheduledSlotLabel ?? "").trim() || slotLabelFromIndex(slot.slotIndex);
  const bookingCode = generateBookingCode(8);

  const payload: Record<string, unknown> = {
    customerId,
    customerName: String(customerName).trim(),
    customerPhone: String(customerPhone).trim(),
    phone: String(customerPhone).trim(),
    ...(customerEmail?.trim() ? { customerEmail: customerEmail.trim() } : {}),
    serviceId: service.id,
    serviceName: getServiceName(service),
    categoryId,
    categoryName,
    serviceCategoryId: categoryId,
    serviceVariationId: variationId || "",
    serviceVariationTitle: selectedVariations[0]?.title ?? "",
    address: {
      ...bookingAddress,
      fullAddress,
    },
    scheduledAt: Timestamp.fromDate(scheduledAtDate),
    durationMinutes,
    amount: revisitFrom ? 0 : servicePrice,
    visitingCharge: priced ? Number(priced.customer.visitingCharge) || 0 : 0,
    servicePrice: revisitFrom ? 0 : servicePrice,
    ...(priced
      ? {
            financeFormulaVersion: "v3",
            serviceAmount: servicePrice,
            serviceSubtotal: servicePrice,
            customerConvenienceFee: Number(priced.customer.customerConvenienceFee) || 0,
            convenienceFee: Number(priced.customer.customerConvenienceFee) || 0,
            convenienceFeeRate: Number(priced.convenienceRate) || 0,
            visitingCharge: Number(priced.customer.visitingCharge) || 0,
            gst: 0,
            customerTotal: Number(priced.customer.customerTotal) || servicePrice,
            ...calculatePartnerEconomics(
              servicePrice,
              Number(priced.customer.customerConvenienceFee) || 0,
              Number(priced.customer.visitingCharge) || 0,
              Number(snapRates.platformFeePercent) || 0,
            ),
            quotedConvenienceFee: Number(priced.customer.customerConvenienceFee) || 0,
            quotedFinalAmount: Number(priced.customer.customerTotal) || servicePrice,
            platformFeePercent: Number(snapRates.platformFeePercent) || 0,
            addonFeePercent: Number(snapRates.addonFeePercent) || 0,
            sparePartCommissionPercent: Number(snapRates.sparePartCommissionPercent) || 0,
        }
      : {}),
    scheduledSlotDate: draft.dateKey,
    scheduledSlotLabel: slotLabel,
    scheduledSlotIndex: slot.slotIndex,
    scheduleDateKey: draft.dateKey,
    scheduleSlotIndex: Math.max(0, slot.slotIndex - 1),
    slotStartHour: slot.startHour,
    date: draft.dateKey,
    time: slotLabel,
    slot: slotLabel,
    bookingDate: draft.dateKey,
    ...(promoCode ? { promoCode } : {}),
    ...(discountAmount > 0 ? { discountAmount } : {}),
    notes: params.notes?.trim() ?? (revisitFrom ? "Free revisit claim" : ""),
    addOnServices: [],
    status: BOOKING_STATUS.NEW,
    bookingCode,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(selectedVariations.length ? { selectedVariations } : {}),
    ...(revisitFrom
      ? {
          isRevisit: true,
          parentBookingId: revisitFrom,
          originalBookingId: revisitFrom,
          revisitReason: "Customer claimed free revisit",
        }
      : (() => {
          const rawPolicy =
            (service as { revisitPolicy?: Record<string, unknown> }).revisitPolicy ||
            null;
          if (!rawPolicy) return {};
          const p = normalizeRevisitPolicy(rawPolicy);
          if (!p.enabled) return {};
          const remaining =
            p.type === "fixed_count"
              ? p.freeRevisitCount
              : p.maxRevisitsInPeriod > 0
                ? p.maxRevisitsInPeriod
                : p.freeRevisitCount || 1;
          return {
            revisitPolicy: p,
            revisitRemaining: remaining,
            remainingRevisits: remaining,
            freeRevisitsRemaining: remaining,
            revisitHistory: [],
          };
        })()),
  };

  const ref = await addDoc(collection(db, "bookings"), payload);
  const bookingId = ref.id;

  try {
    if (revisitTechnicianId) {
      await assignExistingTechnicianAndLockBusySlot(db, {
        bookingId,
        technicianId: revisitTechnicianId,
        dateStr: draft.dateKey,
        slotIndex: slot.slotIndex,
        slotLabel,
      });
      // Update parent revisit counters
      try {
        const parentRef = doc(db, "bookings", revisitFrom);
        const parentSnap = await getDoc(parentRef);
        if (parentSnap.exists()) {
          const p = parentSnap.data() || {};
          const history = Array.isArray(p.revisitHistory) ? [...p.revisitHistory] : [];
          history.push({
            bookingId,
            bookingCode,
            claimedAt: new Date().toISOString(),
            technicianId: revisitTechnicianId,
          });
          const remainingRaw =
            p.revisitRemaining ?? p.remainingRevisits ?? p.freeRevisitsRemaining;
          const patch: Record<string, unknown> = {
            revisitHistory: history,
            updatedAt: serverTimestamp(),
          };
          if (remainingRaw != null && Number.isFinite(Number(remainingRaw))) {
            const next = Math.max(0, Math.round(Number(remainingRaw)) - 1);
            patch.revisitRemaining = next;
            patch.remainingRevisits = next;
            patch.freeRevisitsRemaining = next;
          } else if (parentServicePolicy || p.revisitPolicy) {
            const pol = normalizeRevisitPolicy(
              (p.revisitPolicy as Record<string, unknown>) ||
                parentServicePolicy ||
                {},
            );
            const used = history.length;
            const next =
              pol.type === "fixed_count"
                ? Math.max(0, pol.freeRevisitCount - used)
                : pol.maxRevisitsInPeriod > 0
                  ? Math.max(0, pol.maxRevisitsInPeriod - used)
                  : Math.max(0, (pol.freeRevisitCount || 1) - used);
            patch.revisitRemaining = next;
            patch.remainingRevisits = next;
            patch.freeRevisitsRemaining = next;
            if (!p.revisitPolicy && parentServicePolicy) {
              patch.revisitPolicy = normalizeRevisitPolicy(parentServicePolicy);
            }
          }
          await updateDoc(parentRef, patch);
        }
      } catch {
        /* best effort */
      }
    } else {
      await assignNearestTechnicianAndLockBusySlot(db, {
        bookingId,
        categoryId,
        service,
        userLat,
        userLng,
        dateStr: draft.dateKey,
        slotIndex: slot.slotIndex,
        slotLabel,
      });
    }
  } catch (e) {
    const err = e as Error & { code?: string };
    let alreadyAssigned = false;
    try {
      const assignedSnap = await getDoc(doc(db, "bookings", bookingId));
      const assigned = assignedSnap.data() as Record<string, unknown> | undefined;
      const tech = String(assigned?.technicianId || assigned?.assignedTechnicianId || "").trim();
      alreadyAssigned = Boolean(tech) || String(assigned?.status || "") === "Assigned";
    } catch {
      alreadyAssigned = false;
    }
    if (!alreadyAssigned) {
    const slotFail =
      err.code === "NO_ELIGIBLE_PARTNER" ||
      err.code === "ALL_TECHS_BUSY" ||
      err.code === "PAST_SLOT";
    if (slotFail) {
      try {
        await updateDoc(doc(db, "bookings", bookingId), {
          status: "Cancelled",
          cancelledBy: "system",
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch {
        /* best effort */
      }
    }
    if (err.code === "NO_ELIGIBLE_PARTNER") {
      throw new Error(NO_PARTNER_FOR_SLOT);
    }
    if (err.code === "ALL_TECHS_BUSY" || err.code === "PAST_SLOT") {
      throw new Error(SLOT_NO_LONGER_AVAILABLE);
    }
    if (err.code === "ASSIGN_PERMISSION_DENIED" || err.code === "permission-denied") {
      throw new Error("Booking assignment permission denied");
    }
    throw new Error(
      err.message ||
        "Could not assign a partner for this slot. Please try another time.",
    );
    }
  }

  try {
    await incrementCustomerBookings(db, customerId);
  } catch {
    /* profile counter must not fail a committed booking */
  }
  const savedAddress = {
    ...bookingAddressFromForm(draft.address),
    ...bookingAddress,
    fullAddress,
  };
  try {
    await saveLastUsedAddress(db, customerId, savedAddress);
  } catch {
    /* address cache must not fail a committed booking */
  }
  try {
    const profile = await getCustomerProfile(db, customerId);
    const nextAddresses = upsertSavedAddress(profile?.addresses, savedAddress);
    await saveCustomerAddresses(db, customerId, nextAddresses);
  } catch {
    /* best effort — lastUsedAddress already saved */
  }

  let technicianId: string | null = null;
  let status = String(BOOKING_STATUS.ASSIGNED);
  try {
    const assignedSnap = await getDoc(doc(db, "bookings", bookingId));
    const assigned = assignedSnap.data() as Record<string, unknown> | undefined;
    technicianId = assigned?.technicianId ? String(assigned.technicianId) : null;
    status = String(assigned?.status ?? BOOKING_STATUS.ASSIGNED);
  } catch {
    /* booking already committed; return id even if the follow-up read fails */
  }

  try {
    const { requestRemotePush } = await import("@/lib/notify/remote-notify");
    await requestRemotePush({
      eventType: technicianId ? "assigned" : "created",
      bookingId,
      customerId,
      technicianId: technicianId || "",
      serviceName: getServiceName(service),
      bookingCode,
      audience: "both",
    });
  } catch {
    /* optional until notify server configured */
  }

  return { bookingId, status, technicianId };
}
