import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateBookingCharges,
  calculateCartPricing,
  calculatePartnerEconomics,
  convenienceRateForItemCount,
} from "./cartPricing";
import { buildLocalCheckoutQuote } from "./buildLocalQuote";

const item = (categoryId: string | undefined, unitPrice: unknown, quantity: unknown = 1) => ({
  categoryId,
  unitPrice,
  quantity,
});

describe("local calculateBookingCharges (no network)", () => {
  it("TEST 1: ₹1000 → fee ₹100, total ₹1100", () => {
    const p = calculateBookingCharges([item("c", 1000)]);
    assert.equal(p.convenienceFee, 100);
    assert.equal(p.customerTotal, 1100);
    assert.equal(p.gst, 0);
  });

  it("TEST 2: ₹500 + ₹1500 same category → ₹140 fee, total ₹2140", () => {
    const p = calculateCartPricing([item("chimney", 500), item("chimney", 1500)]);
    assert.equal(p.customerConvenienceFee, 140);
    assert.equal(p.customerTotal, 2140);
  });

  it("TEST 3: three items same category → 5%", () => {
    const p = calculateCartPricing([item("ac", 500), item("ac", 700), item("ac", 800)]);
    assert.equal(p.customerConvenienceFee, 100);
    assert.equal(p.customerTotal, 2100);
  });

  it("TEST 4: quantity 2 counts as two items", () => {
    const p = calculateCartPricing([item("chimney", 500, 2)]);
    assert.equal(p.categoryBreakdown[0].itemCount, 2);
    assert.equal(p.customerConvenienceFee, 70);
  });

  it("TEST 5: two categories independently", () => {
    const p = calculateCartPricing([
      item("chimney", 500),
      item("chimney", 1500),
      item("ac", 1000),
    ]);
    assert.equal(p.serviceAmount, 3000);
    assert.equal(p.customerConvenienceFee, 240);
    assert.equal(p.customerTotal, 3240);
  });

  it("TEST 6–8: visiting charge on service subtotal", () => {
    assert.equal(calculateCartPricing([item("x", 80)]).visitingCharge, 99);
    assert.equal(calculateCartPricing([item("x", 99)]).visitingCharge, 99);
    assert.equal(calculateCartPricing([item("x", 100)]).visitingCharge, 0);
  });

  it("TEST 9: GST is 0", () => {
    const p = calculateBookingCharges([item("x", 1000)]);
    assert.equal(p.gstAmount, 0);
    assert.equal(p.taxAmount, 0);
  });

  it("TEST 10: partner commission is not part of customer total", () => {
    const q = buildLocalCheckoutQuote({
      items: [item("x", 1000)],
      platformFeePercent: 30,
    });
    assert.equal(q.cart.customerTotal, 1100);
    assert.equal(q.lines[0].snapshot.platformFeeAmount, 300);
    assert.equal(q.lines[0].snapshot.technicianFinalEarning, 700);
  });

  it("TEST 11–12: partner payout and company revenue on service subtotal only", () => {
    const eco = calculatePartnerEconomics(2000, 140, 0, 30);
    assert.equal(eco.partnerCommission, 600);
    assert.equal(eco.partnerPayout, 1400);
    assert.equal(eco.companyCustomerFeeRevenue, 140);
    assert.equal(eco.companyPartnerCommissionRevenue, 600);
    assert.equal(eco.companyTotalRevenue, 740);
  });

  it("convenience fee does not change visiting threshold", () => {
    const p = calculateCartPricing([item("x", 90)]);
    assert.equal(p.visitingCharge, 99);
    assert.equal(p.customerConvenienceFee, 9);
    assert.equal(p.customerTotal, 198);
  });

  it("convenienceRateForItemCount slabs", () => {
    assert.equal(convenienceRateForItemCount(1), 10);
    assert.equal(convenienceRateForItemCount(2), 7);
    assert.equal(convenienceRateForItemCount(3), 5);
  });
});
