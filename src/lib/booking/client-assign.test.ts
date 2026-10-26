import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapBookingAssignError } from "./allocation";
import { buildSlotDocId } from "@/lib/booking/technician-slots";

const here = dirname(fileURLToPath(import.meta.url));
const userAppBookingService = join(
  here,
  "../../../../",
  "repair-series/src/services/bookingService.js",
);

describe("assignment error mapping", () => {
  it("does not disguise permission-denied as slot unavailable", () => {
    const mapped = mapBookingAssignError({
      code: "permission-denied",
      message: "Missing or insufficient permissions.",
    });
    assert.equal(mapped.code, "ASSIGN_PERMISSION_DENIED");
    assert.match(mapped.message, /permission denied/i);
    assert.equal(/no longer available/i.test(mapped.message), false);
  });

  it("keeps ALL_TECHS_BUSY as slot taken", () => {
    const mapped = mapBookingAssignError({
      code: "ALL_TECHS_BUSY",
      message: "ALL_TECHS_BUSY",
    });
    assert.equal(mapped.code, "ALL_TECHS_BUSY");
  });
});

describe("busy slot document ids", () => {
  it("uses YYYY-MM-DD_slotIndex and differs by hour", () => {
    assert.equal(buildSlotDocId("2026-09-17", 1), "2026-09-17_1");
    assert.equal(buildSlotDocId("2026-09-17", 2), "2026-09-17_2");
    assert.notEqual(buildSlotDocId("2026-09-17", 1), buildSlotDocId("2026-09-17", 2));
  });
});

describe("customer booking uses server assign (same as Expo app)", () => {
  it("Website create/reschedule call assign API helpers", () => {
    const create = readFileSync(join(here, "create-booking.ts"), "utf8");
    const reschedule = readFileSync(join(here, "reschedule.ts"), "utf8");
    for (const src of [create, reschedule]) {
      assert.equal(src.includes("assignNearestPartnerForBooking"), true);
      assert.equal(src.includes("firebase-admin"), false);
      assert.equal(src.includes("assignNearestTechnicianAndLockBusySlot"), false);
    }
    assert.equal(reschedule.includes("assignSpecificPartnerForBooking"), true);
  });

  it("User App bookingService uses server assign API after create", () => {
    const src = readFileSync(userAppBookingService, "utf8");
    assert.equal(src.includes("assignPartnerRequest"), true);
    assert.equal(src.includes("assignCreatedBooking"), true);
  });

  it("reschedule releases the old slot after server assign", () => {
    const website = readFileSync(join(here, "reschedule.ts"), "utf8");
    const assignAt = website.indexOf("await assignNearestPartnerForBooking");
    const releaseAt = website.indexOf("await releaseBusySlotForBooking");
    assert.ok(assignAt > -1 && releaseAt > assignAt);
  });
});
