/**
 * Customer checkout types. Amounts come from local `buildLocalCheckoutQuote`
 * — never from /api/checkout/calculate.
 */
export type {
  CheckoutCustomerAmounts,
  CheckoutQuote,
  CheckoutQuoteLine,
  LocalQuoteItem,
} from "@/lib/pricing/buildLocalQuote";
export { buildLocalCheckoutQuote } from "@/lib/pricing/buildLocalQuote";
export type { CartPricingItem } from "@/lib/pricing/cartPricing";

export type CheckoutQuoteItem = {
  lineId?: string;
  serviceId: string;
  variationId?: string;
  quantity?: number;
  categoryId?: string;
  unitPrice?: number;
  price?: number;
};
