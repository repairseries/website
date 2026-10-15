import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  callerIsAssignedPartner,
  requirePartnerBookingAccess,
  type ApiCaller,
} from "./auth";

describe("requirePartnerBookingAccess", () => {
  const booking = {
    technicianId: "tech-1",
    partnerAssignments: [{ partnerId: "tech-2", status: "ACCEPTED" }],
  };

  it("allows assigned primary partner with customer role (dual profile)", () => {
    const caller: ApiCaller = { uid: "tech-1", role: "customer" };
    assert.equal(callerIsAssignedPartner(caller, booking), true);
    requirePartnerBookingAccess(caller, booking);
  });

  it("allows secondary partner on multi-assign row", () => {
    const caller: ApiCaller = { uid: "tech-2", role: "customer" };
    requirePartnerBookingAccess(caller, booking);
  });

  it("denies unrelated customer", () => {
    const caller: ApiCaller = { uid: "other", role: "customer" };
    assert.throws(
      () => requirePartnerBookingAccess(caller, booking),
      (e: Error & { status?: number }) => e.status === 403,
    );
  });
});
