import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  fetchTechniciansMatchingCategory,
  rankPartnersByDistance,
} from "@/lib/booking/slot-allocation";
import { technicianMatchesPartnerServices } from "@/lib/booking/partnerServices";
import { buildSlotDocId, slotLabelFromIndex } from "@/lib/booking/technician-slots";
import type { TechnicianDoc } from "@/lib/booking/types";
import { ASSIGNMENT_STATUS, LIFECYCLE } from "@/lib/booking/lifecycle";
import {
  groupBookingItemsByCategory,
  normalizeBookingItems,
  type NormalizedBookingItem,
} from "@/lib/server/assignment/bookingItems";

export type PartnerAssignmentRow = {
  partnerId: string;
  categoryId: string;
  serviceItems: string[];
  serviceTypeIds?: string[];
  serviceCategoryIds?: string[];
  status: "ASSIGNED" | "OFFERED" | "ACCEPTED" | "DECLINED";
  assignedAt?: FirebaseFirestore.FieldValue;
  distanceKm?: number;
};

function partnerEligibleForItem(
  tech: Record<string, unknown>,
  item: NormalizedBookingItem,
): boolean {
  return technicianMatchesPartnerServices(
    tech,
    item.categoryId,
    item.serviceTypeId,
    item.serviceCategoryId,
  );
}

function partnerEligibleForGroup(tech: Record<string, unknown>, items: NormalizedBookingItem[]): boolean {
  return items.every((item) => partnerEligibleForItem(tech, item));
}

function rankEligibleForGroup(
  technicians: TechnicianDoc[],
  items: NormalizedBookingItem[],
  userLat: number,
  userLng: number,
  excluded: Set<string>,
) {
  const categoryId = items[0]?.categoryId || "";
  const serviceTypeId = items[0]?.serviceTypeId || "";
  const serviceCategoryId = items[0]?.serviceCategoryId || "";
  const base = fetchTechniciansMatchingCategory(
    technicians,
    categoryId,
    serviceTypeId,
    serviceCategoryId,
  ).filter((t) => !excluded.has(t.id));
  const filtered = base.filter((t) =>
    partnerEligibleForGroup(t as unknown as Record<string, unknown>, items),
  );
  return rankPartnersByDistance(filtered, userLat, userLng);
}

function mergeGroupIntoRow(row: PartnerAssignmentRow, group: { categoryId: string; items: NormalizedBookingItem[] }) {
  row.serviceItems = [
    ...new Set([...row.serviceItems, ...group.items.map((i) => i.itemId)]),
  ];
  row.serviceTypeIds = [
    ...new Set([
      ...(row.serviceTypeIds || []),
      ...group.items.map((i) => i.serviceTypeId).filter(Boolean),
    ]),
  ];
  row.serviceCategoryIds = [
    ...new Set([
      ...(row.serviceCategoryIds || []),
      ...group.items.map((i) => i.serviceCategoryId).filter(Boolean),
    ]),
  ];
  if (!row.categoryId) row.categoryId = group.categoryId;
}

/** Greedy plan: reuse partner across category groups when eligible; else nearest eligible per group. */
export function planMultiCategoryAssignments(params: {
  booking: Record<string, unknown>;
  technicians: TechnicianDoc[];
  userLat: number;
  userLng: number;
  excludeTechnicianIds?: string[];
}): PartnerAssignmentRow[] | null {
  const items = normalizeBookingItems(params.booking);
  if (!items.length) return null;

  const groups = groupBookingItemsByCategory(items);
  const excluded = new Set(
    (params.excludeTechnicianIds || []).map((id) => String(id || "").trim()).filter(Boolean),
  );
  const assignments: PartnerAssignmentRow[] = [];

  for (const group of groups) {
    let merged = false;
    for (const row of assignments) {
      const tech = params.technicians.find((t) => t.id === row.partnerId);
      if (!tech) continue;
      if (!partnerEligibleForGroup(tech as unknown as Record<string, unknown>, group.items)) {
        continue;
      }
      mergeGroupIntoRow(row, group);
      merged = true;
      break;
    }
    if (merged) continue;

    const ranked = rankEligibleForGroup(
      params.technicians,
      group.items,
      params.userLat,
      params.userLng,
      excluded,
    );
    if (!ranked.length) return null;

    const pick = ranked[0]!;
    const dist =
      typeof (pick as { distanceKm?: number }).distanceKm === "number"
        ? (pick as { distanceKm?: number }).distanceKm
        : undefined;
    assignments.push({
      partnerId: pick.id,
      categoryId: group.categoryId,
      serviceItems: group.items.map((i) => i.itemId),
      serviceTypeIds: [...new Set(group.items.map((i) => i.serviceTypeId).filter(Boolean))],
      serviceCategoryIds: [
        ...new Set(group.items.map((i) => i.serviceCategoryId).filter(Boolean)),
      ],
      status: "ASSIGNED",
      assignedAt: FieldValue.serverTimestamp(),
      ...(dist != null ? { distanceKm: dist } : {}),
    });
  }

  return assignments.length ? assignments : null;
}

function isBusy(row: Record<string, unknown> | undefined): boolean {
  return String(row?.status ?? "").toLowerCase() === "busy";
}

export type MultiAssignResult = {
  partnerAssignments: PartnerAssignmentRow[];
  primaryTechnicianId: string | null;
  primaryTechnicianName: string;
  primaryTechnicianPhone: string;
};

export function technicianPhone(data: Record<string, unknown>): string {
  const candidates = [data.phone, data.mobile, data.contactNumber, data.phoneNumber];
  const hit = candidates.find((value) => value != null && String(value).trim() !== "");
  return hit != null ? String(hit).trim() : "";
}

/** Lock slots for each unique partner in plan and persist partnerAssignments. */
export async function commitMultiCategoryAssignments(params: {
  db: Firestore;
  bookingRef: FirebaseFirestore.DocumentReference;
  bookingId: string;
  technicians: TechnicianDoc[];
  partnerAssignments: PartnerAssignmentRow[];
  dateKey: string;
  slotLabel: string;
  reserved: number[];
}): Promise<MultiAssignResult | null> {
  const uniquePartners = [...new Set(params.partnerAssignments.map((a) => a.partnerId))];
  let result: MultiAssignResult | null = null;

  await params.db.runTransaction(async (tx) => {
    for (const partnerId of uniquePartners) {
      for (const index of params.reserved) {
        const ref = params.db.doc(
          `technicians/${partnerId}/busySlots/${buildSlotDocId(params.dateKey, index)}`,
        );
        const snap = await tx.get(ref);
        if (!snap.exists) continue;
        const row = snap.data() as Record<string, unknown>;
        if (isBusy(row) && String(row.bookingId || "") !== params.bookingId) {
          throw Object.assign(new Error("ALL_TECHS_BUSY"), { code: "ALL_TECHS_BUSY", status: 409 });
        }
      }
    }

    for (const partnerId of uniquePartners) {
      for (const [i, index] of params.reserved.entries()) {
        const ref = params.db.doc(
          `technicians/${partnerId}/busySlots/${buildSlotDocId(params.dateKey, index)}`,
        );
        tx.set(ref, {
          date: params.dateKey,
          slot: index === params.reserved[0] ? params.slotLabel : slotLabelFromIndex(index),
          slotIndex: index,
          status: "busy",
          reason: "booking",
          bookingId: params.bookingId,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }

    const primary = params.partnerAssignments[0];
    const primaryTech = primary
      ? params.technicians.find((t) => t.id === primary.partnerId)
      : null;
    const primaryData = (primaryTech || {}) as unknown as Record<string, unknown>;
    const phone = technicianPhone(primaryData);

    tx.update(params.bookingRef, {
      ...multiAssignBookingPatch({
        partnerAssignments: params.partnerAssignments,
        primaryTechnicianId: primary?.partnerId || null,
        primaryTechnicianName: String(primaryData.name ?? "").trim(),
        primaryTechnicianPhone: phone,
      }),
      scheduledSlotDate: params.dateKey,
      scheduledSlotLabel: params.slotLabel,
      scheduledSlotIndex: params.reserved[0],
      reservedSlotIndices: params.reserved,
    });

    result = {
      partnerAssignments: params.partnerAssignments,
      primaryTechnicianId: primary?.partnerId || null,
      primaryTechnicianName: String(primaryData.name ?? "").trim(),
      primaryTechnicianPhone: phone,
    };
  });

  return result;
}

export function multiAssignBookingPatch(result: {
  partnerAssignments: PartnerAssignmentRow[];
  primaryTechnicianId: string | null;
  primaryTechnicianName: string;
  primaryTechnicianPhone: string;
}) {
  const multiPartner = result.partnerAssignments.length > 1;
  return {
    status: "Assigned",
    technicianId: result.primaryTechnicianId,
    technicianName: result.primaryTechnicianName,
    ...(result.primaryTechnicianPhone ? { technicianPhone: result.primaryTechnicianPhone } : {}),
    lifecycleStatus: LIFECYCLE.PARTNER_ASSIGNED,
    assignmentStatus: ASSIGNMENT_STATUS.OFFERED,
    assignmentOfferedAt: FieldValue.serverTimestamp(),
    partnerAssignments: result.partnerAssignments,
    multiPartner,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function shouldUseMultiCategoryEngine(booking: Record<string, unknown>): boolean {
  const items = normalizeBookingItems(booking);
  if (items.length <= 1) return false;
  const groups = groupBookingItemsByCategory(items);
  return groups.length >= 1 && items.length > 1;
}
