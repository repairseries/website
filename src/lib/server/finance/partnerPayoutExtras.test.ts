import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateTransactionFinance } from "./calculateTransaction";
import { financeFromBooking } from "./fromBooking";

function payout(opts: {
  serviceAmount: number;
  addedServicesAmount: number;
  platformFeePercent: number;
  addonFeePercent: number;
}) {
  return calculateTransactionFinance({
    formulaVersion: "v3",
    serviceAmount: opts.serviceAmount,
    addedServicesAmount: opts.addedServicesAmount,
    customerConvenienceFee: 0,
    visitingCharge: 0,
    customerPlatformFeeType: "fixed",
    customerPlatformFeeValue: 0,
    platformFeePercent: opts.platformFeePercent,
    addonFeePercent: opts.addonFeePercent,
    gstEnabled: false,
    gstPercent: 0,
  });
}

describe("partner payout includes additional services", () => {
  it("no additional service: payout stays base service − company commission", () => {
    const snap = payout({
      serviceAmount: 1000,
      addedServicesAmount: 0,
      platformFeePercent: 30,
      addonFeePercent: 10,
    });
    assert.equal(snap.technicianServiceEarning, 700);
    assert.equal(snap.technicianAddonEarning, 0);
    assert.equal(snap.addonFeeAmount, 0);
    assert.equal(snap.technicianFinalEarning, 700);
  });

  it("one additional service: remaining after additional commission is added to payout", () => {
    const snap = payout({
      serviceAmount: 1000,
      addedServicesAmount: 200,
      platformFeePercent: 30,
      addonFeePercent: 10,
    });
    assert.equal(snap.technicianServiceEarning, 700);
    assert.equal(snap.addonFeeAmount, 20);
    assert.equal(snap.technicianAddonEarning, 180);
    assert.equal(snap.technicianFinalEarning, 880);
  });

  it("multiple additional services are summed then commission is applied", () => {
    const snap = payout({
      serviceAmount: 1000,
      addedServicesAmount: 200 + 300,
      platformFeePercent: 30,
      addonFeePercent: 10,
    });
    assert.equal(snap.addedServicesAmount, 500);
    assert.equal(snap.addonFeeAmount, 50);
    assert.equal(snap.technicianAddonEarning, 450);
    assert.equal(snap.technicianFinalEarning, 1150);
  });

  it("same additional service with quantity 3 uses line total, not one unit", () => {
    const snap = financeFromBooking({
      booking: {
        financeFormulaVersion: "v3",
        servicePrice: 1000,
        customerConvenienceFee: 0,
        visitingCharge: 0,
        platformFeePercent: 30,
        addonFeePercent: 10,
        additionalServices: [
          {
            title: "Gas top-up",
            unitPrice: 500,
            price: 500,
            quantity: 3,
            lineTotal: 1500,
          },
        ],
      },
    });
    assert.equal(snap.addedServicesAmount, 1500);
    assert.equal(snap.addonFeeAmount, 150);
    assert.equal(snap.technicianAddonEarning, 1350);
    assert.equal(snap.technicianFinalEarning, 2050);
  });

  it("additional service uses Company Commission on Additional Services %, not service %", () => {
    const snap = payout({
      serviceAmount: 1000,
      addedServicesAmount: 200,
      platformFeePercent: 30,
      addonFeePercent: 20,
    });
    assert.equal(snap.platformFeeAmount, 300);
    assert.equal(snap.addonFeeAmount, 40);
    assert.equal(snap.technicianFinalEarning, 860);
  });

  it("base + additional combined payout matches formula", () => {
    const snap = payout({
      serviceAmount: 1249,
      addedServicesAmount: 723,
      platformFeePercent: 30,
      addonFeePercent: 10,
    });
    const basePayout = 1249 - snap.platformFeeAmount;
    const extraPayout = 723 - snap.addonFeeAmount;
    assert.equal(snap.technicianFinalEarning, Math.round((basePayout + extraPayout) * 100) / 100);
    assert.ok(snap.technicianFinalEarning > basePayout);
  });

  it("completed snapshot keeps stored payout even if extras would change it", () => {
    const snap = financeFromBooking({
      booking: {
        economicsSnapshotAt: "2026-01-01T00:00:00.000Z",
        financeSnapshot: {
          formulaVersion: "v3",
          finalAmount: 1548,
          technicianFinalEarning: 874,
          spareParts: [],
          serviceAmount: 1249,
          visitingCharge: 0,
          convenienceFee: 299,
          addedServicesAmount: 0,
          sparePartValue: 0,
          grossAmount: 1548,
          discount: 0,
          platformFeePercent: 30,
          addonFeePercent: 10,
          sparePartCommissionPercent: 10,
          platformFeeType: "fixed",
          platformFeeValue: 299,
          platformFeeAmount: 375,
          addonFeeAmount: 0,
          sparePartFeeAmount: 0,
          technicianServiceEarning: 874,
          technicianAddonEarning: 0,
          technicianSpareEarning: 0,
          companyEarnings: 674,
          gstEnabled: false,
          gstPercent: 0,
          gstTaxableBase: "none",
          taxableCompanyFee: 0,
          taxableValue: 0,
          gstAmount: 0,
          gstCollectedOnCompanyFee: 0,
          serviceGstAmount: 0,
          additionalServiceGstAmount: 0,
          sparePartGstAmount: 0,
          cgstPercent: 0,
          sgstPercent: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          page1: {
            itemLabel: "Convenience Fee",
            grossAmount: 299,
            discount: 0,
            taxableValue: 0,
            cgstPercent: 0,
            sgstPercent: 0,
            cgstAmount: 0,
            sgstAmount: 0,
            gstAmount: 0,
            totalAmount: 299,
          },
          page2: {
            itemLabel: "Service Charges",
            grossAmount: 1249,
            discount: 0,
            taxableValue: 0,
            cgstPercent: 0,
            sgstPercent: 0,
            cgstAmount: 0,
            sgstAmount: 0,
            gstAmount: 0,
            totalAmount: 1249,
          },
          page3: null,
          hasSpareParts: false,
          invoicePageCount: 2,
          calculatedAt: "2026-01-01T00:00:00.000Z",
        },
        additionalServices: [{ title: "Later extra", price: 500, quantity: 1 }],
      },
    });
    assert.equal(snap.technicianFinalEarning, 874);
    assert.equal(snap.finalAmount, 1548);
  });
});
