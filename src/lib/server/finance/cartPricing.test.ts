import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateCartPricing,
  calculateTransactionFinance,
  convenienceRateForItemCount,
  financeFromBooking,
  bookingEconomicsPatch,
} from "./index";

const item = (categoryId: string | undefined, unitPrice: unknown, quantity: unknown = 1) => ({
  categoryId,
  unitPrice,
  quantity,
});

function v3(service: number, fee: number, visit = 0, extra: Record<string, unknown> = {}) {
  return calculateTransactionFinance({
    formulaVersion: "v3",
    serviceAmount: service,
    customerConvenienceFee: fee,
    visitingCharge: visit,
    platformFeePercent: 30,
    addonFeePercent: 10,
    gstPercent: 0,
    ...extra,
  });
}

describe("cart pricing v3 — required tests", () => {
  it("TEST 1: one item ₹1000 → fee 10% = ₹100", () => {
    const p = calculateCartPricing([item("chimney", 1000)]);
    assert.equal(p.categoryBreakdown[0].convenienceRate, 10);
    assert.equal(p.customerConvenienceFee, 100);
    assert.equal(p.customerTotal, 1100);
  });

  it("TEST 2: same category ₹500 + ₹1500 → 7% of 2000 = ₹140", () => {
    const p = calculateCartPricing([item("chimney", 500), item("chimney", 1500)]);
    assert.equal(p.categoryBreakdown.length, 1);
    assert.equal(p.categoryBreakdown[0].itemCount, 2);
    assert.equal(p.categoryBreakdown[0].convenienceRate, 7);
    assert.equal(p.customerConvenienceFee, 140);
  });

  it("TEST 3: same category ₹500 + ₹700 + ₹800 → 5% of 2000 = ₹100", () => {
    const p = calculateCartPricing([item("ac", 500), item("ac", 700), item("ac", 800)]);
    assert.equal(p.categoryBreakdown[0].convenienceRate, 5);
    assert.equal(p.customerConvenienceFee, 100);
  });

  it("TEST 4: one service ₹500 × 2 → item count 2, 7% of 1000 = ₹70", () => {
    const p = calculateCartPricing([item("ac", 500, 2)]);
    assert.equal(p.categoryBreakdown[0].itemCount, 2);
    assert.equal(p.serviceAmount, 1000);
    assert.equal(p.customerConvenienceFee, 70);
  });

  it("TEST 5: Chimney 500+1500 and AC 1000 → fee 140 + 100 = 240, total 3240", () => {
    const p = calculateCartPricing([
      item("chimney", 500),
      item("chimney", 1500),
      item("ac", 1000),
    ]);
    const chimney = p.categoryBreakdown.find((c) => c.categoryId === "chimney")!;
    const ac = p.categoryBreakdown.find((c) => c.categoryId === "ac")!;
    assert.equal(chimney.convenienceFee, 140);
    assert.equal(ac.convenienceFee, 100);
    assert.equal(p.serviceAmount, 3000);
    assert.equal(p.customerConvenienceFee, 240);
    assert.equal(p.visitingCharge, 0);
    assert.equal(p.customerTotal, 3240);
  });

  it("TEST 6: service ₹80 → visiting charge ₹99", () => {
    assert.equal(calculateCartPricing([item("x", 80)]).visitingCharge, 99);
  });

  it("TEST 7: service ₹99 → visiting charge ₹99", () => {
    assert.equal(calculateCartPricing([item("x", 99)]).visitingCharge, 99);
  });

  it("TEST 8: service ₹100 → visiting charge ₹0", () => {
    assert.equal(calculateCartPricing([item("x", 100)]).visitingCharge, 0);
  });

  it("TEST 9: GST and tax are always 0", () => {
    const p = calculateCartPricing([item("x", 1000)]);
    assert.equal(p.gstAmount, 0);
    assert.equal(p.taxAmount, 0);
    const snap = v3(1000, 100);
    assert.equal(snap.gstAmount, 0);
    assert.equal(snap.cgstAmount, 0);
    assert.equal(snap.sgstAmount, 0);
    assert.equal(snap.gstEnabled, false);
    assert.equal(snap.page1.gstAmount, 0);
  });

  it("TEST 10: service ₹1000 @ 30% → commission ₹300, payout ₹700", () => {
    const snap = v3(1000, 100);
    assert.equal(snap.platformFeeAmount, 300);
    assert.equal(snap.technicianFinalEarning, 700);
  });

  it("TEST 11: commission is not calculated from customerTotal", () => {
    const snap = v3(80, 8, 99);
    assert.equal(snap.finalAmount, 187);
    assert.equal(snap.platformFeeAmount, 24);
    assert.equal(snap.technicianFinalEarning, 56);
    assert.notEqual(snap.platformFeeAmount, Math.round(187 * 0.3 * 100) / 100);
    assert.equal(snap.companyEarnings, 24 + 8 + 99);
  });

  it("TEST 12: one global rate is never applied to the whole cart", () => {
    const p = calculateCartPricing([
      item("chimney", 500),
      item("chimney", 1500),
      item("ac", 1000),
    ]);
    const globalRate5 = 3000 * 0.05;
    assert.notEqual(p.customerConvenienceFee, globalRate5);
    assert.equal(p.customerConvenienceFee, 240);
  });

  it("TEST 13: 3+ items in one category always use 5%", () => {
    for (const n of [3, 4, 5, 10, 25]) assert.equal(convenienceRateForItemCount(n), 5);
    const ten = calculateCartPricing(Array.from({ length: 10 }, () => item("ac", 100)));
    assert.equal(ten.categoryBreakdown[0].convenienceRate, 5);
    assert.equal(ten.customerConvenienceFee, 50);
    assert.equal(calculateCartPricing([item("ac", 300, 3)]).customerConvenienceFee, 45);
  });

  it("TEST 14: old booking with GST still loads without crashing", () => {
    const oldV2 = financeFromBooking({
      booking: {
        financeFormulaVersion: "v2",
        servicePrice: 1000,
        customerPlatformFee: 149,
        customerPlatformFeeValue: 149,
        gstEnabled: true,
        gstPercent: 18,
        platformFeePercent: 30,
      },
    });
    assert.equal(oldV2.formulaVersion, "v2");
    assert.equal(oldV2.gstAmount, 26.82);
    assert.equal(oldV2.technicianFinalEarning, 700);

    const oldV1 = financeFromBooking({
      booking: { servicePrice: 500, visitingCharge: 99, gstPercent: 18, platformFeePercent: 30 },
    });
    assert.equal(oldV1.formulaVersion, "v1");
    assert.ok(Number.isFinite(oldV1.finalAmount));
    assert.ok(oldV1.gstAmount > 0);
  });
});

describe("cart pricing v3 — edge cases", () => {
  it("empty cart → all zeros", () => {
    for (const input of [[], null, undefined]) {
      const p = calculateCartPricing(input as never);
      assert.deepEqual(
        [p.serviceAmount, p.customerConvenienceFee, p.visitingCharge, p.customerTotal],
        [0, 0, 0, 0],
      );
      assert.equal(p.categoryBreakdown.length, 0);
    }
  });

  it("₹99.99 → visiting ₹99; decimals rounded to paise", () => {
    const p = calculateCartPricing([item("x", 99.99)]);
    assert.equal(p.visitingCharge, 99);
    assert.equal(p.customerConvenienceFee, 10);
    assert.equal(p.customerTotal, 208.99);
    const d = calculateCartPricing([item("x", 333.33)]);
    assert.equal(d.customerConvenienceFee, 33.33);
    assert.equal(d.customerTotal, 366.66);
  });

  it("visiting charge is based on service subtotal, not subtotal + fee", () => {
    const p = calculateCartPricing([item("x", 95)]);
    assert.equal(p.customerConvenienceFee, 9.5);
    assert.equal(p.visitingCharge, 99);
    assert.equal(calculateCartPricing([item("x", 50), item("y", 50)]).visitingCharge, 0);
  });

  it("zero / invalid price and invalid quantity never produce NaN", () => {
    const p = calculateCartPricing([
      item("x", 0),
      item("x", "abc"),
      item("x", -50),
      item("x", 200, "zz"),
      item("x", 200, 0),
      item("x", Number.NaN, 2),
    ]);
    for (const v of [p.serviceAmount, p.customerConvenienceFee, p.visitingCharge, p.customerTotal]) {
      assert.ok(Number.isFinite(v));
    }
    for (const line of p.lines) {
      for (const v of Object.values(line)) {
        if (typeof v === "number") assert.ok(Number.isFinite(v));
      }
    }
    assert.equal(p.lines[4].serviceAmount, 0);
    assert.equal(p.lines[4].convenienceFee, 0);
  });

  it("missing categoryId groups under one fallback category (never undefined)", () => {
    const p = calculateCartPricing([item(undefined, 500), item("", 500)]);
    assert.equal(p.categoryBreakdown.length, 1);
    assert.equal(p.categoryBreakdown[0].categoryId, "uncategorized");
    assert.equal(p.categoryBreakdown[0].convenienceRate, 7);
    assert.equal(p.customerConvenienceFee, 70);
  });

  it("per-line allocation sums exactly to category fee and cart total", () => {
    const p = calculateCartPricing([
      item("a", 333.33),
      item("a", 333.33),
      item("a", 333.34),
      item("b", 45),
    ]);
    const feeSum = p.lines.reduce((s, l) => s + Math.round(l.convenienceFee * 100), 0) / 100;
    const totalSum = p.lines.reduce((s, l) => s + Math.round(l.customerTotal * 100), 0) / 100;
    assert.equal(feeSum, p.customerConvenienceFee);
    assert.equal(totalSum, p.customerTotal);
    assert.equal(p.lines.filter((l) => l.visitingCharge > 0).length, 0);
  });

  it("visiting charge lands on exactly one booking line", () => {
    const p = calculateCartPricing([item("a", 40), item("b", 30)]);
    assert.equal(p.visitingCharge, 99);
    assert.deepEqual(
      p.lines.map((l) => l.visitingCharge),
      [99, 0],
    );
  });
});

describe("v3 transaction snapshot", () => {
  it("customerTotal = service + fee + visiting; stored economics fields", () => {
    const snap = v3(80, 8, 99);
    const patch = bookingEconomicsPatch(snap);
    assert.equal(patch.financeFormulaVersion, "v3");
    assert.equal(patch.serviceAmount, 80);
    assert.equal(patch.customerConvenienceFee, 8);
    assert.equal(patch.visitingCharge, 99);
    assert.equal(patch.customerTotal, 187);
    assert.equal(patch.gstAmount, 0);
    assert.equal(snap.page1.totalAmount, 107);
    assert.equal(snap.page2.totalAmount, 80);
  });

  it("coupon discount reduces service then fee, never visiting charge", () => {
    const snap = v3(80, 8, 99, { discountAmount: 85 });
    assert.equal(snap.discount, 85);
    assert.equal(snap.finalAmount, 102);
    assert.equal(snap.platformFeeAmount, 24);
  });

  it("financeFromBooking recomputes a stored v3 booking identically", () => {
    const snap = financeFromBooking({
      booking: {
        financeFormulaVersion: "v3",
        servicePrice: 2000,
        customerConvenienceFee: 140,
        customerPlatformFee: 140,
        visitingCharge: 0,
        customerTotal: 2140,
        quotedFinalAmount: 2140,
        platformFeePercent: 30,
        gstEnabled: false,
        gstPercent: 0,
      },
    });
    assert.equal(snap.formulaVersion, "v3");
    assert.equal(snap.finalAmount, 2140);
    assert.equal(snap.platformFeeAmount, 600);
    assert.equal(snap.technicianFinalEarning, 1400);
    assert.equal(snap.gstAmount, 0);
  });

  it("v3 booking as stored by clients (no customerPlatformFee / GST keys) recomputes", () => {
    const snap = financeFromBooking({
      booking: {
        financeFormulaVersion: "v3",
        servicePrice: 80,
        amount: 80,
        serviceAmount: 80,
        customerConvenienceFee: 8,
        quotedConvenienceFee: 8,
        visitingCharge: 99,
        customerTotal: 187,
        quotedFinalAmount: 187,
        platformFeePercent: 30,
        addonFeePercent: 10,
      },
      settingsInvoice: { gstEnabled: true, gstPercent: 18 },
    });
    assert.equal(snap.finalAmount, 187);
    assert.equal(snap.gstAmount, 0);
    assert.equal(snap.technicianFinalEarning, 56);
    assert.equal(snap.companyEarnings, 131);
  });

  it("v3 booking without servicePrice derives service = total − fee − visiting", () => {
    const snap = financeFromBooking({
      booking: {
        financeFormulaVersion: "v3",
        customerConvenienceFee: 8,
        visitingCharge: 99,
        quotedFinalAmount: 187,
        platformFeePercent: 30,
      },
    });
    assert.equal(snap.serviceAmount, 80);
    assert.equal(snap.platformFeeAmount, 24);
  });
});
