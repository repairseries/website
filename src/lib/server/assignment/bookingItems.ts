export type NormalizedBookingItem = {
  itemId: string;
  serviceTypeId: string;
  categoryId: string;
  serviceCategoryId: string;
  serviceId: string;
  title?: string;
};

function str(v: unknown): string {
  return v != null ? String(v).trim() : "";
}

/** Canonical line items from unified `bookingItems` or legacy single-service fields. */
export function normalizeBookingItems(booking: Record<string, unknown>): NormalizedBookingItem[] {
  const raw = booking.bookingItems;
  if (Array.isArray(raw) && raw.length) {
    const out: NormalizedBookingItem[] = [];
    raw.forEach((row, index) => {
      if (!row || typeof row !== "object") return;
      const r = row as Record<string, unknown>;
      const categoryId = str(r.categoryId);
      if (!categoryId) return;
      out.push({
        itemId: str(r.itemId || r.lineId || r.serviceId) || `item-${index}`,
        serviceTypeId: str(r.serviceTypeId),
        categoryId,
        serviceCategoryId: str(r.serviceCategoryId),
        serviceId: str(r.serviceId),
        title: str(r.title || r.serviceName) || undefined,
      });
    });
    if (out.length) return out;
  }

  const categoryId = str(booking.categoryId);
  if (!categoryId) return [];
  return [
    {
      itemId: str(booking.serviceId) || "item-0",
      serviceTypeId: str(booking.serviceTypeId),
      categoryId,
      serviceCategoryId: str(booking.serviceCategoryId),
      serviceId: str(booking.serviceId),
      title: str(booking.serviceName) || undefined,
    },
  ];
}

export type CategoryItemGroup = {
  categoryId: string;
  items: NormalizedBookingItem[];
};

export function groupBookingItemsByCategory(items: NormalizedBookingItem[]): CategoryItemGroup[] {
  const order: string[] = [];
  const map = new Map<string, NormalizedBookingItem[]>();
  for (const item of items) {
    const cid = item.categoryId;
    if (!map.has(cid)) {
      map.set(cid, []);
      order.push(cid);
    }
    map.get(cid)!.push(item);
  }
  return order.map((categoryId) => ({
    categoryId,
    items: map.get(categoryId) || [],
  }));
}
