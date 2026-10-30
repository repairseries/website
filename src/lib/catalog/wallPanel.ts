import { catalogTitle } from "./hierarchy";

type WallPanelRow = {
  bookingFlow?: string;
  department?: string;
  slug?: string;
  handle?: string;
  title?: string;
  name?: string;
};

export function isWallPanelCatalogItem(row: WallPanelRow | null | undefined): boolean {
  if (!row) return false;
  const flow = String(row.bookingFlow || row.department || "").toLowerCase();
  if (flow === "wallpanel" || flow === "wall_panel") return true;
  const slug = String(row.slug || row.handle || "").toLowerCase();
  if (slug.includes("wall-panel") || slug.includes("wallpanel")) return true;
  return catalogTitle(row).toLowerCase().includes("wall panel");
}
