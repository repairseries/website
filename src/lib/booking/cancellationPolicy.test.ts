import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateCancellation,
  evaluateReschedule,
} from "./cancellationPolicy";

describe("cancellationPolicy", () => {
  const slot = Date.parse("2026-10-06T17:00:00");

  it("free cancel at exactly 2 hours before (inclusive)", () => {
    const r = evaluateCancellation({
      slotStartMs: slot,
      paidAmount: 1650,
      alreadyPaid: true,
      nowMs: Date.parse("2026-10-06T15:00:00"),
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, "FREE");
    assert.equal(r.chargeAmount, 0);
    assert.equal(r.refundAmount, 1650);
  });

  it("5% charge after the 2-hour cutoff", () => {
    const r = evaluateCancellation({
      slotStartMs: slot,
      paidAmount: 1650,
      alreadyPaid: true,
      nowMs: Date.parse("2026-10-06T15:01:00"),
    });
    assert.equal(r.allowed, true);
    assert.equal(r.reason, "LATE_FEE");
    assert.equal(r.chargeAmount, 82.5);
    assert.equal(r.refundAmount, 1567.5);
  });

  it("disables cancel at slot time", () => {
    const r = evaluateCancellation({
      slotStartMs: slot,
      paidAmount: 1650,
      alreadyPaid: true,
      nowMs: slot,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "AT_SLOT");
  });

  it("reschedule uses the same 2-hour gate", () => {
    assert.equal(
      evaluateReschedule({ slotStartMs: slot, nowMs: Date.parse("2026-10-06T15:00:00") }).allowed,
      true,
    );
    assert.equal(
      evaluateReschedule({ slotStartMs: slot, nowMs: Date.parse("2026-10-06T15:01:00") }).allowed,
      false,
    );
  });
});
