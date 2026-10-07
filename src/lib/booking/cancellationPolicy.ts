/** Cancellation / reschedule: free until 2 hours before slot inclusive; 5% after; disabled at slot time. */

export const CANCEL_FREE_HOURS = 2;
export const LATE_CANCEL_CHARGE_PERCENT = 5;

function money(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function hoursUntilSlot(slotStartMs: number, nowMs = Date.now()): number {
  if (!Number.isFinite(slotStartMs)) return Number.NEGATIVE_INFINITY;
  return (slotStartMs - nowMs) / (3600 * 1000);
}

export function slotStartMsFromBooking(
  booking: Record<string, unknown> | null | undefined,
): number {
  if (!booking) return Number.NaN;
  const at = booking.scheduledAt as unknown;
  if (at && typeof at === "object" && typeof (at as { toDate?: () => Date }).toDate === "function") {
    return (at as { toDate: () => Date }).toDate().getTime();
  }
  if (at instanceof Date) return at.getTime();
  if (typeof at === "number" && Number.isFinite(at)) {
    return at < 1e12 ? at * 1000 : at;
  }
  if (typeof at === "string") {
    const t = Date.parse(at);
    if (Number.isFinite(t)) return t;
  }
  if (at && typeof at === "object" && typeof (at as { seconds?: number }).seconds === "number") {
    return (at as { seconds: number }).seconds * 1000;
  }
  const dateKey = String(booking.scheduledSlotDate || booking.scheduleDateKey || booking.date || "");
  const hour = Number(booking.slotStartHour);
  const parts = dateKey.split("-").map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n)) && Number.isFinite(hour)) {
    return new Date(parts[0], parts[1] - 1, parts[2], hour, 0, 0, 0).getTime();
  }
  return Number.NaN;
}

export function bookingPaidAmount(booking: Record<string, unknown> | null | undefined): number {
  if (!booking) return 0;
  const payment = booking.payment as { amount?: unknown } | undefined;
  return money(
    payment?.amount ??
      booking.quotedFinalAmount ??
      booking.customerTotal ??
      booking.finalBookingAmount ??
      booking.totalAmount ??
      booking.amount,
  );
}

export function isBookingOnlinePaid(booking: Record<string, unknown> | null | undefined): boolean {
  if (!booking) return false;
  const payment = booking.payment as { status?: unknown } | undefined;
  const st = String(payment?.status ?? booking.paymentStatus ?? "").toUpperCase();
  return st === "PAID" || st === "CASH_COLLECTED";
}

export type CancelEvaluation = {
  allowed: boolean;
  reason: "FREE" | "LATE_FEE" | "AT_SLOT" | "STATUS";
  chargePercent: number;
  chargeAmount: number;
  refundAmount: number;
  hoursUntil: number;
};

export function evaluateCancellation(opts: {
  slotStartMs: number;
  paidAmount: number;
  alreadyPaid: boolean;
  nowMs?: number;
}): CancelEvaluation {
  const hours = hoursUntilSlot(opts.slotStartMs, opts.nowMs);
  const amount = money(opts.paidAmount);
  if (hours <= 0) {
    return {
      allowed: false,
      reason: "AT_SLOT",
      chargePercent: 0,
      chargeAmount: 0,
      refundAmount: 0,
      hoursUntil: hours,
    };
  }
  if (hours >= CANCEL_FREE_HOURS) {
    return {
      allowed: true,
      reason: "FREE",
      chargePercent: 0,
      chargeAmount: 0,
      refundAmount: opts.alreadyPaid ? amount : 0,
      hoursUntil: hours,
    };
  }
  const chargeAmount = money((amount * LATE_CANCEL_CHARGE_PERCENT) / 100);
  return {
    allowed: true,
    reason: "LATE_FEE",
    chargePercent: LATE_CANCEL_CHARGE_PERCENT,
    chargeAmount,
    refundAmount: opts.alreadyPaid ? money(amount - chargeAmount) : 0,
    hoursUntil: hours,
  };
}

export function evaluateReschedule(opts: { slotStartMs: number; nowMs?: number }): {
  allowed: boolean;
  reason: "OK" | "CUTOFF" | "AT_SLOT";
} {
  const hours = hoursUntilSlot(opts.slotStartMs, opts.nowMs);
  if (hours <= 0) return { allowed: false, reason: "AT_SLOT" };
  if (hours >= CANCEL_FREE_HOURS) return { allowed: true, reason: "OK" };
  return { allowed: false, reason: "CUTOFF" };
}

export function cancellationFirestoreFields(evalResult: CancelEvaluation) {
  return {
    cancellation: {
      cancelledAt: new Date().toISOString(),
      cancelledBy: "user",
      reason: evalResult.reason,
      chargePercent: evalResult.chargePercent,
      chargeAmount: evalResult.chargeAmount,
      refundAmount: evalResult.refundAmount,
    },
    refundStatus: evalResult.refundAmount > 0 ? "PENDING" : "NOT_REQUIRED",
  };
}
