import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Validation rules mirrored from admin payout (unit-level, no Firestore). */
function validatePayout(openingPaise: number, amountPaise: number) {
  if (amountPaise <= 0) throw new Error("Payout amount must be greater than zero");
  if (openingPaise <= 0) throw new Error("Partner wallet has no positive balance to pay out");
  if (amountPaise > openingPaise) throw new Error("Payout exceeds available balance");
  return openingPaise - amountPaise;
}

describe("admin partner payout validation", () => {
  it("partial payout reduces balance (Test 5)", () => {
    assert.equal(validatePayout(100_000, 50_000), 50_000);
  });

  it("full payout clears positive balance (Test 6)", () => {
    assert.equal(validatePayout(100_000, 100_000), 0);
  });

  it("rejects payout above balance (Test 7)", () => {
    assert.throws(() => validatePayout(50_000, 60_000), /exceeds/);
  });

  it("rejects payout when balance is negative (Test 8)", () => {
    assert.throws(() => validatePayout(-50_000, 10_000), /no positive balance/);
  });
});
