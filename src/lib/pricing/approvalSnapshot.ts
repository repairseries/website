import type { CheckoutQuote, CheckoutQuoteLine } from "./buildLocalQuote";

function money(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export type ApprovalPriceItem = {
  lineId: string;
  serviceId: string;
  variationId: string;
  quantity: number;
  unitPrice: number;
  serviceAmount: number;
  convenienceFee: number;
  visitingCharge: number;
  customerTotal: number;
};

/** Exact amounts shown on Review/Confirm — never recompute after lock. */
export type ApprovalPriceSnapshot = {
  formulaVersion: "v3";
  serviceAmount: number;
  convenienceFee: number;
  visitingCharge: number;
  discountAmount: number;
  customerTotal: number;
  items: ApprovalPriceItem[];
  lockedAt: string;
};

export function itemFromQuoteLine(line: CheckoutQuoteLine): ApprovalPriceItem {
  const quantity = Math.max(1, Math.round(Number(line.quantity) || 1));
  const serviceAmount = money(line.customer.serviceAmount);
  return {
    lineId: String(line.lineId || ""),
    serviceId: String(line.serviceId || ""),
    variationId: String(line.variationId || ""),
    quantity,
    unitPrice: money(serviceAmount / quantity),
    serviceAmount,
    convenienceFee: money(line.customer.customerConvenienceFee),
    visitingCharge: money(line.customer.visitingCharge),
    customerTotal: money(line.customer.customerTotal),
  };
}

export function lockApprovalPriceSnapshot(
  quote: CheckoutQuote,
  lockedAt = new Date().toISOString(),
): ApprovalPriceSnapshot {
  const cart = quote.cart;
  return {
    formulaVersion: "v3",
    serviceAmount: money(cart.serviceAmount),
    convenienceFee: money(cart.customerConvenienceFee),
    visitingCharge: money(cart.visitingCharge),
    discountAmount: money(cart.discount),
    customerTotal: money(cart.customerTotal),
    items: (quote.lines || []).map(itemFromQuoteLine),
    lockedAt,
  };
}

export function snapshotFromQuoteLine(
  line: CheckoutQuoteLine,
  lockedAt = new Date().toISOString(),
): ApprovalPriceSnapshot {
  const item = itemFromQuoteLine(line);
  return {
    formulaVersion: "v3",
    serviceAmount: item.serviceAmount,
    convenienceFee: item.convenienceFee,
    visitingCharge: item.visitingCharge,
    discountAmount: money(line.customer.discount),
    customerTotal: item.customerTotal,
    items: [item],
    lockedAt,
  };
}

/** Firestore price fields written at confirm. Customer totals come only from the snapshot. */
export type LockedBookingPriceFields = {
  financeFormulaVersion: "v3";
  amount: number;
  servicePrice: number;
  serviceAmount: number;
  serviceSubtotal: number;
  customerConvenienceFee: number;
  convenienceFee: number;
  quotedConvenienceFee: number;
  visitingCharge: number;
  gst: 0;
  customerTotal: number;
  quotedFinalAmount: number;
  originalCustomerTotal: number;
  originalConvenienceFee: number;
  originalVisitingCharge: number;
  originalBookingAmount: number;
  discountAmount?: number;
  approvalPriceSnapshot: ApprovalPriceSnapshot;
};

/** Firestore price fields written at confirm. Customer totals come only from the snapshot. */
export function lockedBookingPriceFields(
  snapshot: ApprovalPriceSnapshot,
): LockedBookingPriceFields {
  return {
    financeFormulaVersion: "v3",
    amount: snapshot.serviceAmount,
    servicePrice: snapshot.serviceAmount,
    serviceAmount: snapshot.serviceAmount,
    serviceSubtotal: snapshot.serviceAmount,
    customerConvenienceFee: snapshot.convenienceFee,
    convenienceFee: snapshot.convenienceFee,
    quotedConvenienceFee: snapshot.convenienceFee,
    visitingCharge: snapshot.visitingCharge,
    gst: 0,
    customerTotal: snapshot.customerTotal,
    quotedFinalAmount: snapshot.customerTotal,
    originalCustomerTotal: snapshot.customerTotal,
    originalConvenienceFee: snapshot.convenienceFee,
    originalVisitingCharge: snapshot.visitingCharge,
    originalBookingAmount: snapshot.serviceAmount,
    ...(snapshot.discountAmount > 0 ? { discountAmount: snapshot.discountAmount } : {}),
    approvalPriceSnapshot: snapshot,
  };
}

export function totalsAfterAdditionalServices(
  snapshot: ApprovalPriceSnapshot,
  addedServicesAmount: unknown,
): { addedServicesAmount: number; finalBookingAmount: number; totalAmount: number } {
  const added = money(addedServicesAmount);
  const finalBookingAmount = money(snapshot.customerTotal + added);
  return {
    addedServicesAmount: added,
    finalBookingAmount,
    totalAmount: finalBookingAmount,
  };
}
