import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertWallPanelTransition } from "./status";
import { assertOtpValid } from "./otp";

describe("wall panel status transitions", () => {
  it("allows consultation pending to assigned", () => {
    assert.doesNotThrow(() => assertWallPanelTransition("CONSULTATION_PENDING", "ASSIGNED"));
  });

  it("blocks completed to assigned", () => {
    assert.throws(() => assertWallPanelTransition("COMPLETED", "ASSIGNED"));
  });

  it("allows quotation accept path", () => {
    assert.doesNotThrow(() =>
      assertWallPanelTransition("QUOTATION_PENDING_CUSTOMER", "QUOTATION_ACCEPTED"),
    );
  });
});

describe("wall panel OTP", () => {
  it("rejects invalid OTP", () => {
    assert.throws(() => assertOtpValid("1234", "9999", new Date(Date.now() + 60000)));
  });

  it("accepts valid OTP", () => {
    assert.doesNotThrow(() => assertOtpValid("1234", "1234", new Date(Date.now() + 60000)));
  });
});
