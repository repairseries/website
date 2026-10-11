import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { partnerAssignmentsForFirestore } from "./multiCategoryAssignment";

describe("partnerAssignmentsForFirestore", () => {
  it("never writes serverTimestamp sentinels inside array rows", () => {
    const rows = partnerAssignmentsForFirestore([
      {
        partnerId: "p1",
        categoryId: "c1",
        serviceItems: ["i1"],
        status: "ASSIGNED",
        assignedAt: FieldValue.serverTimestamp() as unknown as Timestamp,
      },
    ]);
    assert.equal(rows.length, 1);
    assert.ok(rows[0]?.assignedAt instanceof Timestamp);
    assert.notEqual(String(rows[0]?.assignedAt), "FieldValue.serverTimestamp");
  });
});
