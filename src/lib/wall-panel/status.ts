import type { WallPanelStatus } from "./types";

const TRANSITIONS: Record<WallPanelStatus, WallPanelStatus[]> = {
  CONSULTATION_PENDING: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["ARRIVAL_OTP_PENDING", "CANCELLED"],
  ARRIVAL_OTP_PENDING: ["CONSULTATION_IN_PROGRESS", "ASSIGNED", "CANCELLED"],
  CONSULTATION_IN_PROGRESS: ["QUOTATION_PENDING_CUSTOMER", "CANCELLED"],
  QUOTATION_DRAFT: ["QUOTATION_PENDING_CUSTOMER", "CONSULTATION_IN_PROGRESS"],
  QUOTATION_PENDING_CUSTOMER: ["QUOTATION_ACCEPTED", "QUOTATION_REJECTED"],
  QUOTATION_REJECTED: [],
  QUOTATION_ACCEPTED: ["DELIVERY_IN_PROGRESS"],
  DELIVERY_IN_PROGRESS: ["DELIVERY_OTP_PENDING"],
  DELIVERY_OTP_PENDING: ["COMPLETED", "DELIVERY_IN_PROGRESS"],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertWallPanelTransition(from: string, to: WallPanelStatus): void {
  const current = String(from || "CONSULTATION_PENDING") as WallPanelStatus;
  const allowed = TRANSITIONS[current] || [];
  if (!allowed.includes(to)) {
    throw Object.assign(new Error(`Invalid status transition ${current} → ${to}`), {
      status: 409,
      code: "INVALID_STATUS",
    });
  }
}
