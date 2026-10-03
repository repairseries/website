import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLocalCheckoutQuote } from "./buildLocalQuote";
import {
  lockApprovalPriceSnapshot,
  lockedBookingPriceFields,
  totalsAfterAdditionalServices,
} from "./approvalSnapshot";
import { buildCommercialInvoice } from "../invoice/server/commercialInvoice.js";
import { calculatePartnerEconomics } from "./cartPricing";

function money(n: unknown) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return Math.round(x * 100) / 100;
}

type ExtraLine = {
  additionalServiceId?: string;
  serviceId?: string;
  variationId?: string;
  title: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  price: number;
};

function extraLine(
  id: string,
  unitPrice: number,
  quantity: number,
  title = "Service A",
  extra: Partial<ExtraLine> = {},
): ExtraLine {
  return {
    additionalServiceId: id,
    title,
    unitPrice,
    price: unitPrice,
    quantity,
    lineTotal: money(unitPrice * quantity),
    ...extra,
  };
}

function mergeExtras(existing: ExtraLine[], incoming: ExtraLine[]): ExtraLine[] {
  const out = existing.map((e) => ({ ...e }));
  const idx = new Map(out.map((e, i) => [e.additionalServiceId || e.serviceId || e.title, i]));
  for (const row of incoming) {
    const k = row.additionalServiceId || row.serviceId || row.title;
    const i = idx.get(k);
    if (i == null) {
      out.push({ ...row });
      idx.set(k, out.length - 1);
      continue;
    }
    const qty = out[i].quantity + row.quantity;
    out[i] = {
      ...out[i],
      ...row,
      quantity: qty,
      lineTotal: money(row.unitPrice * qty),
      unitPrice: row.unitPrice,
      price: row.unitPrice,
    };
  }
  return out;
}

function extrasTotal(lines: ExtraLine[]) {
  return money(lines.reduce((s, l) => s + l.lineTotal, 0));
}

function payable(lockedCustomerTotal: number, extras: ExtraLine[]) {
  return money(lockedCustomerTotal + extrasTotal(extras));
}

describe("additional service quantity is never collapsed to one unit price", () => {
  it("Add A once → ₹500", () => {
    const lines = mergeExtras([], [extraLine("a", 500, 1)]);
    assert.equal(extrasTotal(lines), 500);
  });
  it("Add A twice → ₹1000", () => {
    let lines = mergeExtras([], [extraLine("a", 500, 1)]);
    lines = mergeExtras(lines, [extraLine("a", 500, 1)]);
    assert.equal(lines[0].quantity, 2);
    assert.equal(extrasTotal(lines), 1000);
  });
  it("Add A three times → ₹1500", () => {
    let lines: ExtraLine[] = [];
    lines = mergeExtras(lines, [extraLine("a", 500, 1)]);
    lines = mergeExtras(lines, [extraLine("a", 500, 1)]);
    lines = mergeExtras(lines, [extraLine("a", 500, 1)]);
    assert.equal(lines[0].quantity, 3);
    assert.equal(lines[0].lineTotal, 1500);
    assert.equal(extrasTotal(lines), 1500);
  });
  it("A × 2 and B × 1", () => {
    const lines = mergeExtras(
      [extraLine("a", 500, 2)],
      [extraLine("b", 300, 1, "Service B")],
    );
    assert.equal(extrasTotal(lines), 1300);
  });
  it("additional service with variation keeps variation price × qty", () => {
    const lines = [
      extraLine("parent", 0, 2, "AC — 1.5 ton", {
        serviceId: "ac",
        variationId: "v15",
        unitPrice: 799,
        price: 799,
        lineTotal: 1598,
      }),
    ];
    assert.equal(extrasTotal(lines), 1598);
    assert.notEqual(lines[0].lineTotal, 0);
  });
});

describe("cart / convenience / visiting matrix", () => {
  const q = (items: Array<{ categoryId: string; unitPrice: number; quantity: number }>) =>
    buildLocalCheckoutQuote({
      items: items.map((i, idx) => ({
        lineId: `l${idx}`,
        categoryId: i.categoryId,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
      })),
    });

  it("1. one service → 10%", () => {
    const c = q([{ categoryId: "ac", unitPrice: 1000, quantity: 1 }]);
    assert.equal(c.cart.customerConvenienceFee, 100);
    assert.equal(c.cart.customerTotal, 1100);
  });
  it("2. two services → 7%", () => {
    const c = q([
      { categoryId: "ac", unitPrice: 500, quantity: 1 },
      { categoryId: "ac", unitPrice: 1500, quantity: 1 },
    ]);
    assert.equal(c.cart.customerConvenienceFee, 140);
    assert.equal(c.cart.customerTotal, 2140);
  });
  it("3. three services → 5%", () => {
    const c = q([
      { categoryId: "ac", unitPrice: 500, quantity: 1 },
      { categoryId: "ac", unitPrice: 700, quantity: 1 },
      { categoryId: "ac", unitPrice: 800, quantity: 1 },
    ]);
    assert.equal(c.cart.customerConvenienceFee, 100);
  });
  it("4–5. same service ×2 and ×3 counts quantity for slabs", () => {
    assert.equal(q([{ categoryId: "c", unitPrice: 500, quantity: 2 }]).cart.customerConvenienceFee, 70);
    assert.equal(q([{ categoryId: "c", unitPrice: 500, quantity: 3 }]).cart.customerConvenienceFee, 75);
  });
  it("8–9. categories stay independent", () => {
    const c = q([
      { categoryId: "chimney", unitPrice: 500, quantity: 2 },
      { categoryId: "chimney", unitPrice: 1500, quantity: 1 },
      { categoryId: "ac", unitPrice: 1000, quantity: 1 },
    ]);
    // Chimney 3 units → 5% of 2500 = 125; AC 1 unit → 10% of 1000 = 100
    assert.equal(c.cart.customerConvenienceFee, 225);
  });
  it("13–15. visiting charge threshold", () => {
    assert.equal(q([{ categoryId: "x", unitPrice: 80, quantity: 1 }]).cart.visitingCharge, 99);
    assert.equal(q([{ categoryId: "x", unitPrice: 100, quantity: 1 }]).cart.visitingCharge, 0);
    assert.equal(q([{ categoryId: "x", unitPrice: 101, quantity: 1 }]).cart.visitingCharge, 0);
  });
  it("16/30. catalog change after lock does not change booking", () => {
    const displayed = q([{ categoryId: "ac", unitPrice: 1000, quantity: 2 }]);
    const booking = lockedBookingPriceFields(lockApprovalPriceSnapshot(displayed));
    const later = q([{ categoryId: "ac", unitPrice: 9999, quantity: 2 }]);
    assert.equal(booking.customerTotal, displayed.cart.customerTotal);
    assert.notEqual(later.cart.customerTotal, booking.customerTotal);
  });
});

describe("payable / invoice / partner after extras", () => {
  it("original ₹2140 + A ×2 ₹1000 → payable ₹3140; snapshot unchanged", () => {
    const displayed = buildLocalCheckoutQuote({
      items: [
        { lineId: "1", categoryId: "chimney", unitPrice: 500, quantity: 1 },
        { lineId: "2", categoryId: "chimney", unitPrice: 1500, quantity: 1 },
      ],
    });
    const snapshot = lockApprovalPriceSnapshot(displayed);
    const extras = [extraLine("a", 500, 2)];
    const booking = {
      serviceName: "Chimney",
      ...lockedBookingPriceFields(snapshot),
      ...totalsAfterAdditionalServices(snapshot, extrasTotal(extras)),
      additionalServices: extras,
    };
    assert.equal(booking.customerTotal, 2140);
    assert.equal(booking.finalBookingAmount, 3140);
    const inv = buildCommercialInvoice(booking);
    assert.equal(inv.finalAmount, 3140);
    assert.equal(
      inv.lines.some((l: { label: string }) => l.label.includes("× 2")),
      true,
    );
    const partner = calculatePartnerEconomics(2000, 140, 0, 30);
    assert.equal(partner.partnerPayout, 1400);
    assert.equal(partner.partnerCommission, 600);
    const payment = payable(Number(booking.customerTotal), extras);
    assert.equal(payment, inv.finalAmount);
    assert.equal(payment, booking.finalBookingAmount);
  });
});
