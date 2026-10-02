/** Show a customer-facing charge row only when the amount actually applies. */
export function shouldShowCharge(amount: unknown): boolean {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0;
}
