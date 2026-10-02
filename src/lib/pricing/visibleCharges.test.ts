import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldShowCharge } from "./visibleCharges";
import { isSecondaryAdditionalType, serviceMatchesBookingCategory } from "../partner/categoryMatch";
import { customerSummaryRows, invoiceDocumentTitle } from "../invoice/server/renderPdf.js";

describe("charge row visibility", () => {
  it("convenience fee > 0 is shown", () => {
    assert.equal(shouldShowCharge(140), true);
  });
  it("convenience fee = 0 is hidden", () => {
    assert.equal(shouldShowCharge(0), false);
  });
  it("GST = 0 is hidden", () => {
    assert.equal(shouldShowCharge(0), false);
  });
  it("GST > 0 is shown", () => {
    assert.equal(shouldShowCharge(18), true);
  });
  it("visiting charge = 0 is hidden", () => {
    assert.equal(shouldShowCharge(0), false);
  });
  it("visiting charge > 0 is shown", () => {
    assert.equal(shouldShowCharge(99), true);
  });
});

describe("partner category and type filters", () => {
  it("AC booking → only AC normal services", () => {
    assert.equal(serviceMatchesBookingCategory({ categoryId: "ac" }, "ac"), true);
    assert.equal(serviceMatchesBookingCategory({ categoryId: "chimney" }, "ac"), false);
  });
  it("AC booking → only AC secondary additional services", () => {
    assert.equal(
      serviceMatchesBookingCategory({ categoryId: "ac", category: "AC" }, "ac", "AC"),
      true,
    );
    assert.equal(serviceMatchesBookingCategory({ categoryId: "ro" }, "ac"), false);
  });
  it("does not treat main additional type as secondary", () => {
    assert.equal(isSecondaryAdditionalType("main"), false);
    assert.equal(isSecondaryAdditionalType("Main"), false);
    assert.equal(isSecondaryAdditionalType("secondary"), true);
    assert.equal(isSecondaryAdditionalType("Secondary"), true);
  });
  it("Chimney booking → only Chimney services", () => {
    assert.equal(
      serviceMatchesBookingCategory({ categoryIds: ["chimney"] }, "chimney"),
      true,
    );
    assert.equal(serviceMatchesBookingCategory({ categoryId: "ac" }, "chimney"), false);
  });
});

describe("invoice display for new bookings", () => {
  it("new booking title is INVOICE not TAX INVOICE", () => {
    assert.equal(invoiceDocumentTitle(), "INVOICE");
  });
  it("new booking does not list GST 0", () => {
    const rows = customerSummaryRows({
      serviceAmount: 2000,
      convenienceFee: 140,
      visitingCharge: 0,
      discount: 0,
      addedServicesAmount: 0,
      sparePartValue: 0,
      finalAmount: 2140,
    });
    assert.equal(
      rows.some((r: [string, number]) => String(r[0]).toLowerCase().includes("gst")),
      false,
    );
  });
  it("new booking lists convenience fee when applicable", () => {
    const rows = customerSummaryRows({
      serviceAmount: 2000,
      convenienceFee: 140,
      visitingCharge: 0,
      discount: 0,
      addedServicesAmount: 0,
      sparePartValue: 0,
      finalAmount: 2140,
    });
    assert.deepEqual(
      rows.find((r: [string, number]) => r[0] === "Convenience Fee"),
      ["Convenience Fee", 140],
    );
  });
  it("visiting charge is not an invoice line", () => {
    const without = customerSummaryRows({
      serviceAmount: 2000,
      convenienceFee: 140,
      visitingCharge: 0,
      discount: 0,
      addedServicesAmount: 0,
      sparePartValue: 0,
      finalAmount: 2140,
    });
    const withVisit = customerSummaryRows({
      serviceAmount: 50,
      convenienceFee: 5,
      visitingCharge: 99,
      discount: 0,
      addedServicesAmount: 0,
      sparePartValue: 0,
      finalAmount: 55,
    });
    assert.equal(
      without.some((r: [string, number]) => r[0] === "Visiting Charge"),
      false,
    );
    assert.equal(
      withVisit.some((r: [string, number]) => r[0] === "Visiting Charge"),
      false,
    );
    assert.equal(withVisit[withVisit.length - 1][1], 55);
  });
  it("invoice total matches commercial charges only", () => {
    const rows = customerSummaryRows({
      serviceAmount: 2000,
      convenienceFee: 140,
      visitingCharge: 99,
      discount: 0,
      addedServicesAmount: 0,
      sparePartValue: 0,
      finalAmount: 2140,
    });
    assert.equal(rows[rows.length - 1][1], 2140);
  });
});
