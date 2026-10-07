import { splitComingSoonByCategory } from "@/lib/catalog/coming-soon";

export type HomeSectionLayout =
  | "slider"
  | "autoSlider"
  | "grid"
  | "grid2"
  | "list"
  | "single"
  | "static"
  | string;
export type HomeSectionContentType =
  | "serviceTypes"
  | "search"
  | "banners"
  | "categories"
  | "serviceCategories"
  | "services"
  | "variations"
  | "static"
  | string;
export type HomeSectionSelectionMode =
  | "manual"
  | "all"
  | "featured"
  | "coming_soon"
  | "coming_soon_main"
  | "coming_soon_commercial"
  | string;

const LAYOUT_ALIASES: Record<string, string> = {
  horizontal: "slider",
  carousel: "autoSlider",
  slideshow: "autoSlider",
  two_column: "grid2",
  "2col": "grid2",
};

export function normalizeClientLayout(raw?: string | null) {
  const key = String(raw || "grid").trim();
  return LAYOUT_ALIASES[key] || key;
}

/**
 * Platform visibility for CMS home sections.
 *
 * Field names (Firestore `homeSections`):
 * - `showOnApp` — native mobile app
 * - `showOnWebsite` — legacy / generic website flag (both web surfaces when
 *   mobile/desktop web flags are undefined)
 * - `showOnMobileWeb` — phone-width website home (`MobileAppHome`)
 * - `showOnDesktopWeb` — desktop marketing homepage
 *
 * When `showOnMobileWeb` / `showOnDesktopWeb` are undefined, clients fall back
 * to `showOnWebsite` for backward compatibility.
 */
export type HomeSectionDoc = {
  id: string;
  title?: string;
  subtitle?: string;
  layout?: HomeSectionLayout | string;
  contentType?: HomeSectionContentType | string;
  type?: string;
  selectionMode?: HomeSectionSelectionMode | string;
  contentSource?: string;
  itemIds?: string[];
  columns?: number;
  rows?: number;
  maxItems?: number;
  enabled?: boolean;
  visible?: boolean;
  showOnApp?: boolean;
  showOnWebsite?: boolean;
  showOnMobileWeb?: boolean;
  showOnDesktopWeb?: boolean;
  displayOrder?: number;
  showViewAll?: boolean;
  viewAllPath?: string;
  staticBody?: string;
  staticImage?: string;
  staticCtaLabel?: string;
  staticCtaLink?: string;
  serviceTypeId?: string;
  categoryId?: string;
  serviceCategoryId?: string;
  images?: HomeSectionBannerSlide[];
  settings?: {
    height?: number;
    autoplay?: boolean;
    slideDuration?: number;
    manualSwipe?: boolean;
  };
};

export type HomeSectionBannerSlide = {
  id: string;
  source?: "upload" | "url" | string;
  url?: string;
  displayOrder?: number;
  clickAction?: string;
  serviceTypeId?: string;
  categoryId?: string;
  serviceCategoryId?: string;
  serviceId?: string;
  redirectLink?: string;
};

export type HomeSectionPlatform =
  | "mobileWeb"
  | "desktopWeb"
  | "website"
  | "app";

export type HomeBannerDoc = {
  id: string;
  title?: string;
  image?: string;
  mobileImage?: string;
  websiteImage?: string;
  imageUrl?: string;
  redirectLink?: string;
  clickAction?: string;
  serviceTypeId?: string;
  categoryId?: string;
  serviceCategoryId?: string;
  serviceId?: string;
  section?: string;
  displayOrder?: number;
  enabled?: boolean;
  active?: boolean;
  slideDuration?: number;
};

function isShown(
  value: boolean | undefined,
  fallback?: boolean | undefined,
): boolean {
  if (value !== undefined) return value !== false;
  if (fallback !== undefined) return fallback !== false;
  return true;
}

export function filterHomeSectionsForPlatform(
  sections: HomeSectionDoc[],
  platform: HomeSectionPlatform = "website",
) {
  return (sections || [])
    .filter((s) => {
      if (!s || s.enabled === false || s.visible === false) return false;
      if (platform === "app") return isShown(s.showOnApp);
      if (platform === "mobileWeb") {
        return isShown(s.showOnMobileWeb, s.showOnWebsite);
      }
      if (platform === "desktopWeb") {
        return isShown(s.showOnDesktopWeb, s.showOnWebsite);
      }
      return isShown(s.showOnWebsite);
    })
    .sort((a, b) => {
      const oa = Number(a.displayOrder ?? 0);
      const ob = Number(b.displayOrder ?? 0);
      if (oa !== ob) return oa - ob;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
}

/** Only this service type's home. Never mix another type's layout. */
export function filterHomeSectionsForServiceType(
  sections: HomeSectionDoc[],
  serviceTypeId?: string | null,
) {
  const typeId = String(serviceTypeId || "").trim();
  if (!typeId) return [];
  return (Array.isArray(sections) ? sections : []).filter(
    (s) => String(s.serviceTypeId || "").trim() === typeId,
  );
}

export function getHomeSectionMaxItems(section: HomeSectionDoc) {
  const maxItems = Number(section?.maxItems) || 0;
  if (maxItems > 0) return maxItems;
  const layout = normalizeClientLayout(section?.layout);
  const columns = layout === "grid2" ? 2 : Math.max(1, Number(section?.columns) || 1);
  const rows = Number(section?.rows) || 0;
  if ((layout === "grid" || layout === "grid2") && rows > 0) return columns * rows;
  return 50;
}

type CatalogLike = {
  id: string;
  active?: boolean;
  isActive?: boolean;
  status?: string;
  name?: string;
  title?: string;
  serviceTypeId?: string;
  categoryId?: string;
  serviceCategoryId?: string;
};

type ServiceLike = CatalogLike & {
  featured?: boolean;
  isFeatured?: boolean;
  comingSoonCategory?: unknown;
  variations?: Array<{
    id?: string;
    title?: string;
    name?: string;
    price?: number;
    image?: string;
    imageUrl?: string;
    status?: string;
  }>;
};

function catalogTitle(row: { name?: string; title?: string }) {
  return String(row?.title || row?.name || "").trim();
}

function isCatalogActive(row: CatalogLike) {
  const st = String(row.status || "").trim();
  if (st && st.toLowerCase() === "inactive") return false;
  return row.active !== false && row.isActive !== false;
}

function matchesHierarchy(
  row: CatalogLike,
  section: HomeSectionDoc,
  selectedTypeId: string,
) {
  const typeId = String(section?.serviceTypeId || selectedTypeId || "").trim();
  const categoryId = String(section?.categoryId || "").trim();
  const issueId = String(section?.serviceCategoryId || "").trim();
  if (typeId && String(row.serviceTypeId || "") && String(row.serviceTypeId) !== typeId) {
    return false;
  }
  if (categoryId && String(row.categoryId || "") !== categoryId) return false;
  if (issueId && String(row.serviceCategoryId || "") !== issueId) return false;
  return true;
}

function pickNamed<T extends CatalogLike>(pool: T[], mode: string, ids: string[], max: number) {
  const active = (pool || []).filter((c) => isCatalogActive(c));
  if (mode === "manual" || mode === "selected") {
    const map = new Map(active.map((c) => [String(c.id), c]));
    return ids.map((id) => map.get(id)).filter(Boolean).slice(0, max) as T[];
  }
  return active.slice(0, max);
}

export function resolveHomeSectionItems<
  C extends CatalogLike,
  S extends ServiceLike,
>(
  section: HomeSectionDoc,
  {
    categories = [],
    services = [],
    comingSoon = [],
    serviceTypes = [],
    serviceCategories = [],
    selectedServiceTypeId = "",
  }: {
    categories?: C[];
    services?: S[];
    comingSoon?: S[];
    serviceTypes?: C[];
    serviceCategories?: C[];
    selectedServiceTypeId?: string;
  },
): Array<C | S | Record<string, unknown>> {
  const contentType = String(section?.contentType || section?.type || "");
  if (!section || contentType === "static" || contentType === "search" || contentType === "banners") {
    return [];
  }

  const mode = String(section.selectionMode || section.contentSource || "all");
  const max = getHomeSectionMaxItems(section);
  const ids = Array.isArray(section.itemIds) ? section.itemIds.map(String) : [];
  const typeId = String(section.serviceTypeId || selectedServiceTypeId || "").trim();

  if (contentType === "serviceTypes") {
    return pickNamed(serviceTypes, mode, ids, max).map((row) => ({
      ...row,
      contentLevel: "serviceType",
      name: catalogTitle(row),
    }));
  }

  if (contentType === "serviceCategories") {
    const pool = (serviceCategories || []).filter((row) =>
      matchesHierarchy(row, section, typeId),
    );
    return pickNamed(pool, mode, ids, max).map((row) => ({
      ...row,
      contentLevel: "serviceCategory",
      name: catalogTitle(row),
    }));
  }

  if (contentType === "categories") {
    const pool = (categories || []).filter((row) => {
      if (typeId && String(row.serviceTypeId || "") && String(row.serviceTypeId) !== typeId) {
        return false;
      }
      return true;
    });
    return pickNamed(pool, mode, ids, max).map((row) => ({
      ...row,
      name: catalogTitle(row),
    }));
  }

  if (contentType === "variations") {
    const pool: Array<Record<string, unknown>> = [];
    for (const service of services || []) {
      if (!matchesHierarchy(service, section, typeId)) continue;
      if (String(service.status || "Active") !== "Active") continue;
      for (const v of Array.isArray(service.variations) ? service.variations : []) {
        const st = String(v.status || "Active").toLowerCase();
        if (st === "inactive") continue;
        pool.push({
          ...v,
          id: v.id,
          name: catalogTitle(v),
          price: v.price,
          image: v.image || v.imageUrl,
          serviceId: service.id,
          contentLevel: "variation",
        });
      }
    }
    return pickNamed(pool as CatalogLike[], mode, ids, max);
  }

  if (contentType === "services") {
    const activeServices = (services || []).filter(
      (s) =>
        String(s.status || "Active") === "Active" && matchesHierarchy(s, section, typeId),
    );
    const soon = (Array.isArray(comingSoon) ? comingSoon : []).filter((s) =>
      matchesHierarchy(s, section, typeId),
    );
    const { main, commercial } = splitComingSoonByCategory(soon);

    let pool: S[] = activeServices;
    if (mode === "featured") {
      const featured = activeServices.filter((s) => s.featured || s.isFeatured);
      pool = featured.length > 0 ? featured : activeServices;
    } else if (mode === "coming_soon") pool = soon;
    else if (mode === "coming_soon_main") pool = main;
    else if (mode === "coming_soon_commercial") pool = commercial;
    else if (mode === "manual" || mode === "selected") {
      const all = [...activeServices, ...soon];
      const map = new Map(all.map((s) => [String(s.id), s]));
      return ids.map((id) => map.get(id)).filter(Boolean).slice(0, max) as S[];
    }
    return pool.slice(0, max);
  }

  return [];
}

function normalizeSectionBannerImages(raw: HomeSectionBannerSlide[] | undefined) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row, i) => ({
      id: String(row?.id || `banner_${i}`).trim(),
      source: row?.source === "url" ? "url" : "upload",
      url: String(row?.url || "").trim(),
      displayOrder: Number(row?.displayOrder) || i + 1,
      clickAction: String(row?.clickAction || "none"),
      serviceTypeId: String(row?.serviceTypeId || "").trim(),
      categoryId: String(row?.categoryId || "").trim(),
      serviceCategoryId: String(row?.serviceCategoryId || "").trim(),
      serviceId: String(row?.serviceId || "").trim(),
      redirectLink: String(row?.redirectLink || "").trim(),
    }))
    .filter((row) => row.url)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
}

function mapEmbeddedBannerSlide(img: ReturnType<typeof normalizeSectionBannerImages>[number]): HomeBannerDoc {
  const url = String(img.url || "").trim();
  return {
    id: img.id,
    image: url,
    imageUrl: url,
    mobileImage: url,
    websiteImage: url,
    clickAction: img.clickAction || "none",
    serviceTypeId: img.serviceTypeId,
    categoryId: img.categoryId,
    serviceCategoryId: img.serviceCategoryId,
    serviceId: img.serviceId,
    redirectLink: img.redirectLink,
  };
}

export function resolveSectionBannerSlides(
  section: HomeSectionDoc,
  banners: HomeBannerDoc[] | undefined,
  selectedServiceTypeId?: string,
) {
  const embedded = normalizeSectionBannerImages(section?.images);
  if (embedded.length) return embedded.map(mapEmbeddedBannerSlide);
  return resolveBannersForSection(section, banners, selectedServiceTypeId);
}

export function resolveBannersForSection(
  section: HomeSectionDoc,
  banners: HomeBannerDoc[] | undefined,
  selectedServiceTypeId?: string,
) {
  const typeId = String(section?.serviceTypeId || selectedServiceTypeId || "").trim();
  return (Array.isArray(banners) ? banners : [])
    .filter((b) => b && b.enabled !== false && b.active !== false)
    .filter((b) => {
      const bType = String(b.serviceTypeId || "").trim();
      if (bType && typeId && bType !== typeId) return false;
      const cat = String(section?.categoryId || "").trim();
      if (cat && String(b.categoryId || "") && String(b.categoryId) !== cat) return false;
      const sectionKey = String(b.section || "home");
      if (sectionKey === "home" || sectionKey === "offers" || !b.section) return true;
      return false;
    })
    .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
}
