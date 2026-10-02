/**
 * Integer paise helpers for local checkout pricing (client-safe).
 * 1 rupee = 100 paise.
 */

export const PAISE_PER_RUPEE = 100;

export function toPaise(rupees: unknown): number {
  const n = Number(rupees);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * PAISE_PER_RUPEE);
}

export function toRupees(paise: unknown): number {
  const p = Number(paise);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.round(p) / PAISE_PER_RUPEE;
}

export function sanitizePercent(raw: unknown, fallback = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}

export function percentOfPaise(paise: number, percent: number): number {
  const p = Math.max(0, Math.round(Number(paise) || 0));
  const pct = sanitizePercent(percent, 0);
  if (p === 0 || pct === 0) return 0;
  return Math.round((p * pct) / 100);
}

export function clampNonNegativePaise(paise: number): number {
  const p = Math.round(Number(paise) || 0);
  return p > 0 ? p : 0;
}
