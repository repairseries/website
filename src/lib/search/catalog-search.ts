import type { ServiceDoc } from "@/lib/booking/types";

export type CategoryDoc = {
  id: string;
  name?: string;
  title?: string;
  slug?: string;
  serviceTypeId?: string;
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function serviceName(s: ServiceDoc): string {
  return String(s.name ?? s.title ?? "").trim();
}

function categoryName(c: CategoryDoc): string {
  return String(c.name ?? c.title ?? "").trim();
}

export function searchCatalog(
  query: string,
  services: ServiceDoc[],
  categories: CategoryDoc[],
  limit = 8,
  options?: { serviceTypeId?: string },
): { services: ServiceDoc[]; categories: CategoryDoc[] } {
  const q = norm(query);
  const typeId = String(options?.serviceTypeId || "").trim();
  const scopedServices = typeId
    ? services.filter((s) => !s.serviceTypeId || String(s.serviceTypeId) === typeId)
    : services;
  const scopedCategories = typeId
    ? categories.filter((c) => !c.serviceTypeId || String(c.serviceTypeId) === typeId)
    : categories;
  if (!q) {
    return {
      services: scopedServices.slice(0, limit),
      categories: scopedCategories.slice(0, Math.min(4, limit)),
    };
  }

  const matchedServices = scopedServices.filter((s) => {
    const name = norm(serviceName(s));
    const cat = norm(String(s.categoryName ?? s.serviceCategoryName ?? ""));
    const type = norm(String(s.serviceTypeName ?? ""));
    const vars = (Array.isArray(s.variations) ? s.variations : []).some((v) =>
      norm(String(v.title ?? "")).includes(q),
    );
    return name.includes(q) || cat.includes(q) || type.includes(q) || vars;
  });

  const matchedCategories = scopedCategories.filter((c) => {
    const name = norm(categoryName(c));
    return name.includes(q);
  });

  return {
    services: matchedServices.slice(0, limit),
    categories: matchedCategories.slice(0, limit),
  };
}

export function filterServicesByNameKeywords(
  services: ServiceDoc[],
  keywords: string[],
): ServiceDoc[] {
  const lowered = keywords.map(norm);
  return services.filter((s) => {
    const name = norm(serviceName(s));
    return lowered.some((kw) => name.includes(kw));
  });
}

export function filterServicesByAnyKeyword(
  services: ServiceDoc[],
  keywords: string[],
): ServiceDoc[] {
  const lowered = keywords.map(norm);
  return services.filter((s) => {
    const name = norm(serviceName(s));
    return lowered.some((kw) => name.includes(kw));
  });
}
