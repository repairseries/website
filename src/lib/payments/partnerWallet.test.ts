import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePaymentWalletAmounts } from "./partnerWallet";

describe("partner wallet amounts", () => {
  it("online credit uses technicianFinalEarning from frozen economics", () => {
    const booking = {
      financeFormulaVersion: "v3",
      servicePrice: 1000,
      customerConvenienceFee: 100,
      visitingCharge: 0,
      quotedFinalAmount: 1100,
      platformFeePercent: 30,
      technicianFinalEarning: 700,
      platformFeeAmount: 300,
      payment: { amount: 1100 },
    };
    const { partnerEarningPaise, companySharePaise, customerTotalPaise } =
      computePaymentWalletAmounts(booking);
    assert.equal(partnerEarningPaise, 70000);
    assert.equal(customerTotalPaise, 110000);
    assert.equal(companySharePaise, 40000);
  });

  it("cash debit uses company share only (total minus partner earning)", () => {
    const booking = {
      financeFormulaVersion: "v3",
      servicePrice: 2000,
      customerConvenienceFee: 0,
      visitingCharge: 0,
      quotedFinalAmount: 2000,
      platformFeePercent: 25,
      technicianFinalEarning: 1500,
      payment: { amount: 2000 },
    };
    const { partnerEarningPaise, companySharePaise } = computePaymentWalletAmounts(booking);
    assert.equal(partnerEarningPaise, 150000);
    assert.equal(companySharePaise, 50000);
  });
});
