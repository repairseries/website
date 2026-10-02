import { calculateCartPricing, type CartPricingItem } from "./cartPricing";
import { toPaise, toRupees } from "./money";

export const DEFAULT_PLATFORM_COMMISSION_PERCENT = 30;
export const DEFAULT_ADDON_FEE_PERCENT = 10;

export type CheckoutCustomerAmounts = {
  serviceAmount: number;
  serviceSubtotal: number;
  customerConvenienceFee: number;
  platformFee: number;
  visitingCharge: number;
  discount: number;
  gstAmount: 0;
  taxAmount: 0;
  totalTax: 0;
  customerTotal: number;
  finalPayable: number;
};

export type CheckoutQuoteLine = {
  lineId?: string;
  serviceId?: string;
  variationId?: string;
  categoryId: string;
  quantity: number;
  convenienceRate: number;
  customer: CheckoutCustomerAmounts;
  snapshot: Record<string, unknown>;
};

export type CheckoutQuote = {
  ok: true;
  formulaVersion: "v3";
  catalog: {
    serviceId: string;
    serviceName: string;
    unitPrice: number;
    quantity: number;
    amount: number;
  } | null;
  settings: {
    gstEnabled: false;
    gstPercent: 0;
    serviceCommissionPercent: number;
    additionalServiceCommissionPercent: number;
    sparePartCommissionPercent: number;
  };
  cart: {
    serviceAmount: number;
    categoryBreakdown: Array<{
      categoryId: string;
      categoryName?: string;
      itemCount: number;
      subtotal: number;
      convenienceRate: number;
      convenienceFee: number;
    }>;
    customerConvenienceFee: number;
    visitingCharge: number;
    discount: number;
    gstAmount: 0;
    taxAmount: 0;
    customerTotal: number;
  };
  customer: CheckoutCustomerAmounts;
  lines: CheckoutQuoteLine[];
  snapshot: Record<string, unknown>;
};

export type LocalQuoteItem = CartPricingItem & {
  serviceName?: string;
};

function customerView(
  serviceAmount: number,
  convenienceFee: number,
  visitingCharge: number,
  discount: number,
): CheckoutCustomerAmounts {
  const customerTotal = Math.max(
    0,
    Math.round((serviceAmount + convenienceFee + visitingCharge - discount) * 100) / 100,
  );
  return {
    serviceAmount,
    serviceSubtotal: serviceAmount,
    customerConvenienceFee: convenienceFee,
    platformFee: convenienceFee,
    visitingCharge,
    discount,
    gstAmount: 0,
    taxAmount: 0,
    totalTax: 0,
    customerTotal,
    finalPayable: customerTotal,
  };
}

/**
 * Synchronous local checkout quote — no HTTP / Firebase / API.
 * Discount applies to service + convenience fee only (visiting excluded), on first line.
 */
export function buildLocalCheckoutQuote(input: {
  items: LocalQuoteItem[];
  discountAmount?: number;
  platformFeePercent?: number;
  addonFeePercent?: number;
  sparePartCommissionPercent?: number;
}): CheckoutQuote {
  const pricing = calculateCartPricing(input.items);
  const platformFeePercent =
    Number.isFinite(Number(input.platformFeePercent)) && Number(input.platformFeePercent) >= 0
      ? Math.min(100, Number(input.platformFeePercent))
      : DEFAULT_PLATFORM_COMMISSION_PERCENT;
  const addonFeePercent =
    Number.isFinite(Number(input.addonFeePercent)) && Number(input.addonFeePercent) >= 0
      ? Math.min(100, Number(input.addonFeePercent))
      : DEFAULT_ADDON_FEE_PERCENT;
  const sparePartCommissionPercent =
    Number.isFinite(Number(input.sparePartCommissionPercent)) &&
    Number(input.sparePartCommissionPercent) >= 0
      ? Math.min(100, Number(input.sparePartCommissionPercent))
      : addonFeePercent;

  const first = pricing.lines.find((l) => l.quantity > 0);
  const discountablePaise = first
    ? toPaise(first.serviceAmount) + toPaise(first.convenienceFee)
    : 0;
  const requestedDiscountPaise = toPaise(input.discountAmount);
  const discountPaise = Math.min(discountablePaise, requestedDiscountPaise);
  const discount = toRupees(discountPaise);

  const lines: CheckoutQuoteLine[] = pricing.lines.map((priced, i) => {
    const lineDiscount =
      first && priced.index === first.index ? discount : 0;
    const customer = customerView(
      priced.serviceAmount,
      priced.convenienceFee,
      priced.visitingCharge,
      lineDiscount,
    );
    const snapshot = {
      formulaVersion: "v3",
      serviceAmount: priced.serviceAmount,
      convenienceFee: priced.convenienceFee,
      visitingCharge: priced.visitingCharge,
      discount: lineDiscount,
      gstAmount: 0,
      finalAmount: customer.customerTotal,
      platformFeePercent,
      addonFeePercent,
      sparePartCommissionPercent,
      platformFeeAmount:
        Math.round(priced.serviceAmount * (platformFeePercent / 100) * 100) / 100,
      technicianFinalEarning:
        Math.round(
          (priced.serviceAmount -
            priced.serviceAmount * (platformFeePercent / 100)) *
            100,
        ) / 100,
    };
    return {
      lineId: priced.lineId ?? input.items[i]?.lineId,
      serviceId: priced.serviceId ?? input.items[i]?.serviceId,
      variationId: priced.variationId ?? input.items[i]?.variationId,
      categoryId: priced.categoryId,
      quantity: priced.quantity,
      convenienceRate: priced.convenienceRate,
      customer,
      snapshot,
    };
  });

  const cartDiscount = discount;
  const cartCustomerTotal = Math.max(
    0,
    Math.round((pricing.customerTotal - cartDiscount) * 100) / 100,
  );
  const cartCustomer = customerView(
    pricing.serviceAmount,
    pricing.customerConvenienceFee,
    pricing.visitingCharge,
    cartDiscount,
  );

  const firstItem = input.items[0];
  const catalog =
    firstItem?.serviceId && first
      ? {
          serviceId: String(firstItem.serviceId),
          serviceName: String(firstItem.serviceName || "Service"),
          unitPrice: first.unitPrice,
          quantity: first.quantity,
          amount: first.serviceAmount,
        }
      : null;

  return {
    ok: true,
    formulaVersion: "v3",
    catalog,
    settings: {
      gstEnabled: false,
      gstPercent: 0,
      serviceCommissionPercent: platformFeePercent,
      additionalServiceCommissionPercent: addonFeePercent,
      sparePartCommissionPercent,
    },
    cart: {
      serviceAmount: pricing.serviceAmount,
      categoryBreakdown: pricing.categoryBreakdown,
      customerConvenienceFee: pricing.customerConvenienceFee,
      visitingCharge: pricing.visitingCharge,
      discount: cartDiscount,
      gstAmount: 0,
      taxAmount: 0,
      customerTotal: cartCustomerTotal,
    },
    customer: cartCustomer,
    lines,
    snapshot: lines[0]?.snapshot ?? {},
  };
}
