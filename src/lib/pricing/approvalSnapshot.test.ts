import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLocalCheckoutQuote } from "./buildLocalQuote";
import {
  lockApprovalPriceSnapshot,
  snapshotFromQuoteLine,
  lockedBookingPriceFields,
  totalsAfterAdditionalServices,
} from "./approvalSnapshot";
import { buildCommercialInvoice } from "../invoice/server/commercialInvoice.js";

function quoteAtApproval(unitPrice: number, quantity = 1, categoryId = "ac") {
  return buildLocalCheckoutQuote({
    items: [
      {
        lineId: "line-1",
        serviceId: "svc-1",
        variationId: "var-1",
        categoryId,
        unitPrice,
        quantity,
      },
    ],
  });
}

/** Matches the review example: ₹2000 service, 7% convenience (2 items), ₹0 visiting. */
function quoteReviewExample() {
  return quoteAtApproval(1000, 2);
}

describe("approval amount locks as final booking amount", () => {
  it("Approval amount = final booking amount (₹2000 + ₹140 + ₹0 = ₹2140)", () => {
    const displayed = quoteReviewExample();
    assert.equal(displayed.cart.serviceAmount, 2000);
    assert.equal(displayed.cart.customerConvenienceFee, 140);
    assert.equal(displayed.cart.visitingCharge, 0);
    assert.equal(displayed.cart.customerTotal, 2140);

    const snapshot = snapshotFromQuoteLine(displayed.lines[0]!);
    const booking = lockedBookingPriceFields(snapshot);
    assert.equal(booking.customerTotal, 2140);
    assert.equal(booking.quotedFinalAmount, 2140);
    assert.equal(booking.serviceAmount, 2000);
    assert.equal(booking.convenienceFee, 140);
    assert.equal(booking.visitingCharge, 0);
    assert.equal(snapshot.customerTotal, displayed.cart.customerTotal);
  });

  it("Website approval amount = booking amount", () => {
    const displayed = quoteReviewExample();
    const snapshot = lockApprovalPriceSnapshot(displayed);
    const booking = lockedBookingPriceFields(snapshot);
    assert.equal(booking.customerTotal, displayed.cart.customerTotal);
    assert.deepEqual(
      [booking.serviceAmount, booking.convenienceFee, booking.visitingCharge],
      [
        displayed.cart.serviceAmount,
        displayed.cart.customerConvenienceFee,
        displayed.cart.visitingCharge,
      ],
    );
  });

  it("User App approval amount = booking amount (same local formula)", () => {
    const displayed = quoteAtApproval(80, 1);
    assert.equal(displayed.cart.visitingCharge, 99);
    const snapshot = snapshotFromQuoteLine(displayed.lines[0]!);
    assert.equal(lockedBookingPriceFields(snapshot).customerTotal, displayed.customer.customerTotal);
  });

  it("Convenience fee remains unchanged after confirmation", () => {
    const displayed = quoteReviewExample();
    const booking = lockedBookingPriceFields(lockApprovalPriceSnapshot(displayed));
    const laterCatalogQuote = quoteAtApproval(2500, 1);
    assert.equal(booking.convenienceFee, 140);
    assert.notEqual(laterCatalogQuote.cart.customerConvenienceFee, 140);
    assert.equal(booking.convenienceFee, displayed.cart.customerConvenienceFee);
  });

  it("Visiting charge remains unchanged after confirmation", () => {
    const displayed = quoteAtApproval(80);
    const booking = lockedBookingPriceFields(lockApprovalPriceSnapshot(displayed));
    assert.equal(booking.visitingCharge, 99);
    const later = quoteAtApproval(2000);
    assert.equal(later.cart.visitingCharge, 0);
    assert.equal(booking.visitingCharge, displayed.cart.visitingCharge);
  });

  it("Service price changes after booking do not change existing booking amount", () => {
    const displayed = quoteReviewExample();
    const snapshot = lockApprovalPriceSnapshot(displayed);
    const liveNow = quoteAtApproval(9999, 1);
    const booking = lockedBookingPriceFields(snapshot);
    assert.equal(booking.customerTotal, 2140);
    assert.notEqual(liveNow.cart.customerTotal, booking.customerTotal);
  });

  it("Additional service changes only the post-booking additional-service amount", () => {
    const snapshot = lockApprovalPriceSnapshot(quoteReviewExample());
    const booking = {
      ...lockedBookingPriceFields(snapshot),
      ...totalsAfterAdditionalServices(snapshot, 300),
    };
    assert.equal(booking.customerTotal, 2140);
    assert.equal(booking.quotedFinalAmount, 2140);
    assert.equal(booking.convenienceFee, 140);
    assert.equal(booking.visitingCharge, 0);
    assert.equal(booking.addedServicesAmount, 300);
    assert.equal(booking.finalBookingAmount, 2440);
    assert.equal(booking.approvalPriceSnapshot.customerTotal, 2140);
  });

  it("Invoice uses the locked booking amount", () => {
    const snapshot = lockApprovalPriceSnapshot(quoteReviewExample());
    const booking = {
      serviceName: "AC Repair",
      ...lockedBookingPriceFields(snapshot),
      addedServicesAmount: 400,
      sparePartValue: 900,
    };
    const inv = buildCommercialInvoice(booking);
    assert.equal(inv.finalAmount, 2140);
    assert.equal(inv.serviceAmount, 2000);
    assert.equal(inv.convenienceFee, 140);
  });
});
