import { calculateTransactionFinanceV2 } from "./calculateTransaction.v2";
import { toPaise, toRupees } from "./money";
import type { FinanceInput, FinanceSnapshot } from "./financeTypes";

/**
 * Formula version v3 (no GST).
 *
 * The caller passes the already-allocated convenience fee for this booking
 * (from calculateCartPricing) as customerConvenienceFee, plus visitingCharge.
 *
 *   customerTotal = service + additional + spare + convenienceFee + visitingCharge − discount
 *   discount      = existing coupon rule on service + convenience fee (visiting charge excluded)
 *   partner commission = % of SERVICE VALUE only
 *   company revenue    = commissions + convenience fee + visiting charge
 */
export function calculateTransactionFinanceV3(input: FinanceInput): FinanceSnapshot {
  const base = calculateTransactionFinanceV2({
    ...input,
    customerPlatformFeeType: "fixed",
    customerPlatformFeeValue: input.customerConvenienceFee ?? input.customerPlatformFeeValue ?? 0,
    gstEnabled: false,
    gstPercent: 0,
  });

  const visitPaise = toPaise(input.visitingCharge);
  const add = (rupees: number) => toRupees(toPaise(rupees) + visitPaise);
  const visitingCharge = toRupees(visitPaise);

  const page1 = {
    ...base.page1,
    itemLabel: "Convenience Fee",
    extraItems: visitPaise > 0 ? [{ label: "Visiting Charge", amount: visitingCharge }] : undefined,
    grossAmount: add(base.page1.grossAmount),
    taxableValue: base.page1.taxableValue,
    totalAmount: add(base.page1.totalAmount),
  };

  return {
    ...base,
    formulaVersion: "v3",
    visitingCharge,
    grossAmount: add(base.grossAmount),
    finalAmount: add(base.finalAmount),
    companyEarnings: add(base.companyEarnings),
    gstEnabled: false,
    gstPercent: 0,
    gstTaxableBase: "none",
    taxableCompanyFee: 0,
    taxableValue: 0,
    gstAmount: 0,
    gstCollectedOnCompanyFee: 0,
    cgstPercent: 0,
    sgstPercent: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    page1,
  };
}
