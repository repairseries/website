export type PaymentPreference = "PAY_NOW" | "PAY_LATER";

function money(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Centralized payment object. Online success is webhook-verified only — never PAID from the client. */
export function bookingPaymentFields(opts: {
  preference: PaymentPreference;
  amount: number;
  isRevisit?: boolean;
}) {
  const amount = opts.isRevisit ? 0 : money(opts.amount);
  const preference = opts.preference === "PAY_NOW" ? "PAY_NOW" : "PAY_LATER";
  return {
    paymentPreference: preference,
    payment: {
      status: "PENDING",
      method: preference === "PAY_NOW" ? "ONLINE" : "PAY_LATER",
      amount,
      razorpayOrderId: null,
      razorpayPaymentId: null,
      paidAt: null,
      verifiedAt: null,
    },
    paymentStatus: "unpaid",
    paymentRequired: preference !== "PAY_NOW",
  };
}

export function isPrepaid(booking: Record<string, unknown> | null | undefined): boolean {
  if (!booking) return false;
  const payment = booking.payment as { status?: unknown } | undefined;
  const st = String(payment?.status ?? booking.paymentStatus ?? "").toUpperCase();
  return st === "PAID" || st === "CASH_COLLECTED";
}
