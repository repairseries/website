/** Mirror of Partner App `src/utils/categoryMatch.ts` for unit tests. */
function norm(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function collectCategoryTokens(source: {
  categoryId?: unknown;
  categoryIds?: unknown;
  categories?: unknown;
  category?: unknown;
  categoryName?: unknown;
}): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const n = norm(v);
    if (n) out.push(n);
  };
  push(source.categoryId);
  push(source.category);
  push(source.categoryName);
  if (Array.isArray(source.categoryIds)) source.categoryIds.forEach(push);
  if (Array.isArray(source.categories)) source.categories.forEach(push);
  return out;
}

export function serviceMatchesBookingCategory(
  service: {
    categoryId?: unknown;
    categoryIds?: unknown;
    categories?: unknown;
    category?: unknown;
    categoryName?: unknown;
  },
  bookingCategoryId: string | null | undefined,
  bookingCategoryName?: string | null,
): boolean {
  const want = [norm(bookingCategoryId), norm(bookingCategoryName)].filter(Boolean);
  if (!want.length) return false;
  const tokens = collectCategoryTokens(service);
  return tokens.some((t) => want.includes(t));
}

export function isSecondaryAdditionalType(raw: unknown): boolean {
  return String(raw ?? "").trim().toLowerCase() === "secondary";
}
