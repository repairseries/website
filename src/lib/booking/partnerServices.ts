export type PartnerCategoryAssignment = {
  categoryId: string;
  serviceCategoryIds: string[];
};

export type PartnerServiceTypeBlock = {
  serviceTypeId: string;
  categories: PartnerCategoryAssignment[];
};

const MAX_PARTNER_SERVICE_TYPES = 2;
const MAX_PARTNER_CATEGORIES = 3;

function uniqStrings(list: unknown[]): string[] {
  return [...new Set(list.map((id) => String(id).trim()).filter(Boolean))];
}

export function normalizePartnerServices(
  raw: unknown,
  categoriesById: Record<string, { serviceTypeId?: string }> = {},
): PartnerServiceTypeBlock[] {
  if (!Array.isArray(raw)) return [];

  const byType = new Map<string, PartnerServiceTypeBlock>();

  const mergeCategory = (
    serviceTypeId: string,
    categoryId: string,
    serviceCategoryIds: string[],
  ) => {
    const st = String(serviceTypeId || "").trim();
    const cat = String(categoryId || "").trim();
    if (!st || !cat) return;
    let block = byType.get(st);
    if (!block) {
      block = { serviceTypeId: st, categories: [] };
      byType.set(st, block);
    }
    let row = block.categories.find((c) => c.categoryId === cat);
    if (!row) {
      row = { categoryId: cat, serviceCategoryIds: [] };
      block.categories.push(row);
    }
    row.serviceCategoryIds = uniqStrings([...row.serviceCategoryIds, ...serviceCategoryIds]);
  };

  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;

    if (Array.isArray(r.categories) && String(r.serviceTypeId || "").trim()) {
      const st = String(r.serviceTypeId).trim();
      for (const catRow of r.categories) {
        if (!catRow || typeof catRow !== "object") continue;
        const cr = catRow as Record<string, unknown>;
        const ids = Array.isArray(cr.serviceCategoryIds)
          ? (cr.serviceCategoryIds as unknown[])
          : Array.isArray(cr.serviceTypeIds)
            ? (cr.serviceTypeIds as unknown[])
            : [];
        mergeCategory(st, String(cr.categoryId || ""), uniqStrings(ids));
      }
      continue;
    }

    const categoryId = String(r.categoryId ?? "").trim();
    if (!categoryId) continue;
    const legacyScIds = Array.isArray(r.serviceCategoryIds)
      ? (r.serviceCategoryIds as unknown[])
      : Array.isArray(r.serviceTypeIds)
        ? (r.serviceTypeIds as unknown[])
        : [];
    const catDoc = categoriesById[categoryId];
    const serviceTypeId = String(r.serviceTypeId || catDoc?.serviceTypeId || "").trim();
    if (!serviceTypeId) continue;
    mergeCategory(serviceTypeId, categoryId, uniqStrings(legacyScIds));
  }

  const blocks = [...byType.values()];
  let categoryCount = 0;
  const trimmed: PartnerServiceTypeBlock[] = [];
  for (const block of blocks) {
    if (trimmed.length >= MAX_PARTNER_SERVICE_TYPES) break;
    const cats: PartnerCategoryAssignment[] = [];
    for (const c of block.categories) {
      if (categoryCount >= MAX_PARTNER_CATEGORIES) break;
      cats.push({
        categoryId: c.categoryId,
        serviceCategoryIds: uniqStrings(c.serviceCategoryIds),
      });
      categoryCount += 1;
    }
    if (cats.length) trimmed.push({ serviceTypeId: block.serviceTypeId, categories: cats });
  }
  return trimmed;
}

function categoryApprovedInBlock(
  block: PartnerServiceTypeBlock,
  cat: string,
  sc: string,
): boolean {
  if (!cat) return true;
  const catRow = block.categories.find((c) => c.categoryId === cat);
  if (!catRow) return false;
  if (!sc) return true;
  if (!catRow.serviceCategoryIds.length) return true;
  return catRow.serviceCategoryIds.some((id) => String(id) === sc);
}

export function technicianMatchesPartnerServices(
  technician: Record<string, unknown> | null | undefined,
  categoryId: string,
  serviceTypeId?: string,
  serviceCategoryId?: string,
): boolean {
  const cat = String(categoryId ?? "").trim();
  const st = String(serviceTypeId ?? "").trim();
  const sc = String(serviceCategoryId ?? "").trim();
  if (!cat && !st && !sc) return true;

  const structured = normalizePartnerServices(technician?.services);
  if (structured.length) {
    if (st) {
      const block = structured.find((b) => b.serviceTypeId === st);
      if (block) {
        if (categoryApprovedInBlock(block, cat, sc)) return true;
      }
      // Booking serviceTypeId may differ from partner doc; still match by approved category.
      if (cat && structured.some((b) => categoryApprovedInBlock(b, cat, sc))) return true;
      if (!cat) return Boolean(block);
      return false;
    }
    for (const block of structured) {
      if (categoryApprovedInBlock(block, cat, sc)) return true;
    }
    return false;
  }

  const single = String(technician?.categoryId ?? "").trim();
  const arr = Array.isArray(technician?.categoryIds) ? technician.categoryIds : [];
  const allowedCats = new Set(
    [...arr.map((id) => String(id).trim()), single].filter(Boolean),
  );
  if (allowedCats.size > 0 && cat && !allowedCats.has(cat)) return false;

  const assigned = technician?.assignedServiceCategories;
  if (sc && assigned && typeof assigned === "object" && !Array.isArray(assigned)) {
    const forCat = (assigned as Record<string, unknown>)[cat];
    if (Array.isArray(forCat) && forCat.length > 0) {
      return forCat.some((id) => String(id).trim() === sc);
    }
  }

  // Legacy categoryId/categoryIds match (or no category metadata on the partner).
  return true;
}

