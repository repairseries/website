import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommercialInvoice,
  commercialInvoiceTableRows,
  invoiceDocumentTitle,
} from "../invoice/server/commercialInvoice.js";

function labels(inv: { lines: Array<{ label: string }> }) {
  return inv.lines.map((line) => line.label);
}

function expectFinal(
  booking: Record<string, unknown>,
  expected: number,
  expectedLabels: string[],
) {
  const inv = buildCommercialInvoice(booking);
  assert.equal(invoiceDocumentTitle(), "INVOICE");
  assert.equal(inv.finalAmount, expected);
  assert.equal(inv.subtotal, expected);
  assert.equal(inv.gstAmount, 0);
  assert.equal(inv.invoicePageCount, 1);
  assert.deepEqual(labels(inv), expectedLabels);
  const rows = commercialInvoiceTableRows(inv);
  assert.equal(
    rows.some(
      (row: [string, number]) =>
        /gst|cgst|sgst|igst|taxable|tax amount|total tax|tax invoice|partner/i.test(String(row[0])),
    ),
    false,
  );
  assert.equal(rows[rows.length - 1][0], "Total Amount");
  assert.equal(rows[rows.length - 1][1], expected);
}

describe("commercial invoice totals", () => {
  it("uses the booking service name", () => {
    expectFinal({ serviceName: "AC Gas Filling", serviceSubtotal: 500 }, 500, ["AC Gas Filling"]);
  });

  it("service + convenience fee only", () => {
    expectFinal(
      { serviceName: "AC Repair", serviceSubtotal: 500, customerConvenienceFee: 50 },
      550,
      ["AC Repair", "Convenience Fee"],
    );
  });

  it("lists additional service quantity on the invoice", () => {
    expectFinal(
      {
        serviceName: "AC Repair",
        serviceSubtotal: 2000,
        customerConvenienceFee: 140,
        additionalServices: [
          { title: "Service A", unitPrice: 500, price: 500, quantity: 3, lineTotal: 1500 },
        ],
      },
      3640,
      ["AC Repair", "Service A × 3", "Convenience Fee"],
    );
  });

  it("ignores spare parts when extra service lines are absent", () => {
    expectFinal(
      {
        serviceName: "Chimney Cleaning",
        serviceSubtotal: 500,
        sparePartValue: 1200,
        addedServicesAmount: 300,
        customerConvenienceFee: 50,
      },
      550,
      ["Chimney Cleaning", "Convenience Fee"],
    );
  });

  it("hides convenience fee when zero", () => {
    expectFinal({ serviceSubtotal: 500, customerConvenienceFee: 0 }, 500, ["Service"]);
  });

  it("locked snapshot invoice includes visiting when it was on approval", () => {
    const inv = buildCommercialInvoice({
      serviceName: "Quick Fix",
      approvalPriceSnapshot: {
        serviceAmount: 80,
        convenienceFee: 8,
        visitingCharge: 99,
        customerTotal: 187,
      },
      addedServicesAmount: 50,
    });
    assert.equal(inv.finalAmount, 187);
    assert.deepEqual(labels(inv), ["Quick Fix", "Convenience Fee", "Visiting Charge"]);
  });

  it("ignores historical GST fields on old bookings", () => {
    const inv = buildCommercialInvoice({
      serviceName: "RO Service",
      serviceSubtotal: 500,
      customerConvenienceFee: 50,
      gstAmount: 99,
      gstPercent: 18,
      visitingCharge: 99,
      finalBookingAmount: 649,
    });
    assert.equal(inv.finalAmount, 649);
    assert.equal(inv.gstAmount, 0);
    assert.deepEqual(labels(inv), ["RO Service", "Convenience Fee", "Visiting Charge"]);
  });

  it("uses the stored committed booking total when extras are approved", () => {
    expectFinal(
      {
        serviceName: "AC Repair",
        serviceSubtotal: 1249,
        customerConvenienceFee: 299,
        finalBookingAmount: 2271,
        additionalServices: [{ title: "Gas top-up", price: 723, quantity: 1 }],
      },
      2271,
      ["AC Repair", "Gas top-up", "Convenience Fee"],
    );
  });
});
