export function isBusyStatus(row: Record<string, unknown> | undefined): boolean {
  return String(row?.status ?? "").toLowerCase() === "busy";
}

/** Busy slot owned by another booking blocks assignment; same booking may be re-locked. */
export function busySlotBlocksPartner(
  row: Record<string, unknown> | undefined,
  bookingId: string,
): boolean {
  if (!row || !isBusyStatus(row)) return false;
  const existing = String(row.bookingId ?? "").trim();
  if (!existing) return true;
  return existing !== String(bookingId || "").trim();
}
