import {
  clampNonNegativePaise,
  percentOfPaise,
  toPaise,
  toRupees,
} from "./money";

/**
 * Local pricing formula v3 — synchronous, no network.
 *
 *   serviceAmount          = Σ unitPrice × quantity
 *   per categoryId:        itemCount = Σ quantity
 *                          rate = 1→10%, 2→7%, 3+→5%
 *                          fee  = categorySubtotal × rate (paise-rounded)
 *   customerConvenienceFee = Σ category fees
 *   visitingCharge         = 0 < serviceAmount < 100 ? 99 : 0
 *   customerTotal          = serviceAmount + customerConvenienceFee + visitingCharge
 *   GST / tax              = 0
 */

export const VISITING_CHARGE_RUPEES = 99;
export const VISITING_CHARGE_THRESHOLD_RUPEES = 100;
export const UNCATEGORIZED_CATEGORY_ID = "uncategorized";

export type CartPricingItem = {
  lineId?: string;
  categoryId?: string | null;
  categoryName?: string | null;
  unitPrice: unknown;
  quantity?: unknown;
  serviceId?: string;
  variationId?: string;
};

export type CategoryPricing = {
  categoryId: string;
  categoryName?: string;
  itemCount: number;
  subtotal: number;
  convenienceRate: number;
  convenienceFee: number;
};

export type CartLinePricing = {
  index: number;
  lineId?: string;
  serviceId?: string;
  variationId?: string;
  categoryId: string;
  unitPrice: number;
  quantity: number;
  serviceAmount: number;
  convenienceRate: number;
  convenienceFee: number;
  visitingCharge: number;
  customerTotal: number;
};

export type CartPricing = {
  serviceAmount: number;
  serviceSubtotal: number;
  categoryBreakdown: CategoryPricing[];
  customerConvenienceFee: number;
  convenienceFee: number;
  visitingCharge: number;
  gstAmount: 0;
  taxAmount: 0;
  gst: 0;
  customerTotal: number;
  lines: CartLinePricing[];
};

export function convenienceRateForItemCount(itemCount: number): number {
  const n = Math.max(0, Math.floor(Number(itemCount) || 0));
  if (n <= 0) return 0;
  if (n === 1) return 10;
  if (n === 2) return 7;
  return 5;
}

export function visitingChargeForServicePaise(servicePaise: number): number {
  const p = clampNonNegativePaise(servicePaise);
  if (p <= 0) return 0;
  return p < toPaise(VISITING_CHARGE_THRESHOLD_RUPEES)
    ? toPaise(VISITING_CHARGE_RUPEES)
    : 0;
}

function sanitizeQuantity(raw: unknown): number {
  const n = Number(raw ?? 1);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(99, Math.round(n));
}

function categoryKey(raw: unknown): string {
  const id = raw != null ? String(raw).trim() : "";
  return id || UNCATEGORIZED_CATEGORY_ID;
}

/** Alias matching the requested API name. */
export function calculateBookingCharges(
  items: CartPricingItem[] | null | undefined,
): CartPricing {
  return calculateCartPricing(items);
}

export function calculateCartPricing(
  items: CartPricingItem[] | null | undefined,
): CartPricing {
  const rows = (Array.isArray(items) ? items : []).map((item, index) => {
    const quantity = sanitizeQuantity(item?.quantity);
    const unitPaise = toPaise(item?.unitPrice);
    const categoryId = categoryKey(item?.categoryId);
    const categoryName =
      item?.categoryName != null ? String(item.categoryName).trim() : "";
    return {
      index,
      lineId: item?.lineId,
      serviceId: item?.serviceId,
      variationId: item?.variationId,
      categoryId,
      categoryName,
      unitPaise,
      quantity,
      subtotalPaise: unitPaise * quantity,
    };
  });

  const order: string[] = [];
  const groups = new Map<string, typeof rows>();
  const categoryNames = new Map<string, string>();
  for (const row of rows) {
    if (row.quantity <= 0) continue;
    if (!groups.has(row.categoryId)) {
      groups.set(row.categoryId, []);
      order.push(row.categoryId);
    }
    groups.get(row.categoryId)!.push(row);
    if (row.categoryName && !categoryNames.has(row.categoryId)) {
      categoryNames.set(row.categoryId, row.categoryName);
    }
  }

  const lineFeePaise = new Map<number, number>();
  const lineRate = new Map<number, number>();
  const categoryBreakdown: CategoryPricing[] = [];
  let feeTotalPaise = 0;

  for (const categoryId of order) {
    const group = groups.get(categoryId)!;
    const itemCount = group.reduce((sum, r) => sum + r.quantity, 0);
    const subtotalPaise = group.reduce((sum, r) => sum + r.subtotalPaise, 0);
    const rate = convenienceRateForItemCount(itemCount);
    const feePaise = percentOfPaise(subtotalPaise, rate);
    feeTotalPaise += feePaise;
    categoryBreakdown.push({
      categoryId,
      categoryName: categoryNames.get(categoryId),
      itemCount,
      subtotal: toRupees(subtotalPaise),
      convenienceRate: rate,
      convenienceFee: toRupees(feePaise),
    });

    let allocated = 0;
    group.forEach((r, i) => {
      const share =
        i === group.length - 1
          ? feePaise - allocated
          : subtotalPaise > 0
            ? Math.floor((feePaise * r.subtotalPaise) / subtotalPaise)
            : 0;
      allocated += share;
      lineFeePaise.set(r.index, share);
      lineRate.set(r.index, rate);
    });
  }

  const servicePaise = rows.reduce(
    (sum, r) => sum + (r.quantity > 0 ? r.subtotalPaise : 0),
    0,
  );
  const visitingPaise = visitingChargeForServicePaise(servicePaise);
  const firstBillable = rows.find((r) => r.quantity > 0);

  const lines: CartLinePricing[] = rows.map((r) => {
    const fee = lineFeePaise.get(r.index) ?? 0;
    const visit =
      firstBillable && r.index === firstBillable.index ? visitingPaise : 0;
    const service = r.quantity > 0 ? r.subtotalPaise : 0;
    return {
      index: r.index,
      lineId: r.lineId,
      serviceId: r.serviceId,
      variationId: r.variationId,
      categoryId: r.categoryId,
      unitPrice: toRupees(r.unitPaise),
      quantity: r.quantity,
      serviceAmount: toRupees(service),
      convenienceRate: lineRate.get(r.index) ?? 0,
      convenienceFee: toRupees(fee),
      visitingCharge: toRupees(visit),
      customerTotal: toRupees(service + fee + visit),
    };
  });

  const serviceAmount = toRupees(servicePaise);
  const customerConvenienceFee = toRupees(feeTotalPaise);
  const visitingCharge = toRupees(visitingPaise);

  return {
    serviceAmount,
    serviceSubtotal: serviceAmount,
    categoryBreakdown,
    customerConvenienceFee,
    convenienceFee: customerConvenienceFee,
    visitingCharge,
    gstAmount: 0,
    taxAmount: 0,
    gst: 0,
    customerTotal: toRupees(servicePaise + feeTotalPaise + visitingPaise),
    lines,
  };
}

/** Partner split is only on service subtotal. Convenience + visiting are company revenue. */
export function calculatePartnerEconomics(
  serviceSubtotal: number,
  convenienceFee: number,
  visitingCharge: number,
  commissionRatePercent = 30,
) {
  const svc = toPaise(serviceSubtotal);
  const fee = toPaise(convenienceFee);
  const visit = toPaise(visitingCharge);
  const rate = Math.min(100, Math.max(0, Number(commissionRatePercent) || 0));
  const commissionPaise = percentOfPaise(svc, rate);
  const companyFeePaise = fee + visit;
  return {
    partnerCommissionRate: rate,
    partnerCommission: toRupees(commissionPaise),
    partnerPayout: toRupees(svc - commissionPaise),
    companyCustomerFeeRevenue: toRupees(companyFeePaise),
    companyPartnerCommissionRevenue: toRupees(commissionPaise),
    companyTotalRevenue: toRupees(companyFeePaise + commissionPaise),
  };
}
