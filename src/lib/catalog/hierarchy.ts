export function catalogTitle(row: { title?: string; name?: string } | null | undefined): string {
  return String(row?.title ?? row?.name ?? "").trim();
}

export function catalogImage(row: {
  image?: string;
  imageUrl?: string;
  icon?: string;
  homeImage?: string;
} | null | undefined): string {
  return String(row?.image ?? row?.imageUrl ?? row?.icon ?? row?.homeImage ?? "").trim();
}

export function isCatalogActive(row: {
  status?: string;
  active?: boolean;
  isActive?: boolean;
} | null | undefined): boolean {
  if (!row) return false;
  if (row.active === false || row.isActive === false) return false;
  const s = String(row.status ?? "").trim().toLowerCase();
  if (s === "inactive" || s === "disabled" || s === "deleted") return false;
  return true;
}

export function sortByDisplayOrder<T extends { displayOrder?: number; order?: number; title?: string; name?: string }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) => {
    const oa = Number(a.displayOrder ?? a.order ?? 0);
    const ob = Number(b.displayOrder ?? b.order ?? 0);
    if (oa !== ob) return oa - ob;
    return catalogTitle(a).localeCompare(catalogTitle(b));
  });
}

export function catalogSegment(row: { slug?: string; title?: string; name?: string; id: string }): string {
  const slug = String(row.slug ?? "").trim();
  if (slug) return slug;
  const name = catalogTitle(row);
  if (name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  return row.id;
}
