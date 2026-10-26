import { getAuthClient } from "@/lib/firebase/auth";

export type AssignPartnerRequest = {
  bookingId: string;
  mode: "nearest" | "specific" | "unassign";
  technicianId?: string;
  dateStr?: string;
  slotIndex?: number;
  slotLabel?: string;
  reservedSlotIndices?: number[];
  categoryId?: string;
  serviceTypeId?: string;
  serviceCategoryId?: string;
  userLat?: number;
  userLng?: number;
};

/** Same post-create assignment path as the Expo customer app (`assignPartnerRequest`). */
export async function assignNearestPartnerForBooking(params: {
  bookingId: string;
  dateStr: string;
  slotIndex: number;
  slotLabel: string;
  categoryId: string;
  serviceTypeId?: string;
  serviceCategoryId?: string;
  userLat?: number;
  userLng?: number;
}) {
  return requestAssignPartner({
    bookingId: params.bookingId,
    mode: "nearest",
    dateStr: params.dateStr,
    slotIndex: params.slotIndex,
    slotLabel: params.slotLabel,
    categoryId: params.categoryId,
    serviceTypeId: params.serviceTypeId,
    serviceCategoryId: params.serviceCategoryId,
    userLat: params.userLat,
    userLng: params.userLng,
  });
}

export async function assignSpecificPartnerForBooking(params: {
  bookingId: string;
  technicianId: string;
  dateStr: string;
  slotIndex: number;
  slotLabel: string;
  categoryId?: string;
  serviceTypeId?: string;
  serviceCategoryId?: string;
}) {
  return requestAssignPartner({
    bookingId: params.bookingId,
    mode: "specific",
    technicianId: params.technicianId,
    dateStr: params.dateStr,
    slotIndex: params.slotIndex,
    slotLabel: params.slotLabel,
    categoryId: params.categoryId,
    serviceTypeId: params.serviceTypeId,
    serviceCategoryId: params.serviceCategoryId,
  });
}

export async function requestAssignPartner(body: AssignPartnerRequest) {
  const auth = getAuthClient();
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in required");
  const token = await user.getIdToken();
  const response = await fetch("/api/bookings/assign", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    technicianId?: string | null;
    technicianName?: string;
    status?: string;
  };
  if (!response.ok) {
    throw Object.assign(new Error(payload.error || "Could not assign a partner"), {
      code: payload.code,
    });
  }
  return payload;
}
