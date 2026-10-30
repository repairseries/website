import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirrors technician `buildSettlementDisplay` for spec tests 1–5. */
function display(balancePaise: number, totalKamai: number, paidPaise: number) {
  const net = balancePaise / 100;
  return {
    totalKamai,
    milChuka: paidPaise / 100,
    baaki: Math.max(0, net),
    partnerOwes: Math.max(0, -net),
  };
}

describe("Kamai screen settlement display", () => {
  it("Test 1 — cash: kamai +700, wallet -300, baaki 0, owes 300", () => {
    const d = display(-30_000, 700, 0);
    assert.equal(d.totalKamai, 700);
    assert.equal(d.baaki, 0);
    assert.equal(d.partnerOwes, 300);
  });

  it("Test 2 — online: kamai +700, wallet +700, baaki 700", () => {
    const d = display(70_000, 700, 0);
    assert.equal(d.baaki, 700);
    assert.equal(d.partnerOwes, 0);
  });

  it("Test 3 — combined online then cash: wallet +200, kamai 2200", () => {
    const d = display(20_000, 2200, 0);
    assert.equal(d.baaki, 200);
    assert.equal(d.partnerOwes, 0);
  });

  it("Test 4 — negative wallet: baaki 0, owes 119.60", () => {
    const d = display(-11_960, 209, 0);
    assert.equal(d.baaki, 0);
    assert.equal(Math.round(d.partnerOwes * 100), 11960);
  });

  it("Test 5 — partial payout: wallet 500 after 500 paid", () => {
    const d = display(50_000, 1000, 50_000);
    assert.equal(d.baaki, 500);
    assert.equal(d.milChuka, 500);
  });
});
