function money(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Server-side payable amount for a booking (never trust client-only totals). */
export function bookingPayableAmount(booking: Record<string, unknown>): number {
  const payment = booking.payment as { amount?: unknown } | undefined;
  const fromPayment = money(payment?.amount);
  if (fromPayment > 0) return fromPayment;
  const candidates = [
    booking.quotedFinalAmount,
    booking.customerTotal,
    booking.finalBookingAmount,
    booking.totalAmount,
    booking.amount,
  ];
  for (const c of candidates) {
    const v = money(c);
    if (v > 0) return v;
  }
  return 0;
}
