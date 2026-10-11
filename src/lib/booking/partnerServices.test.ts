import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { technicianMatchesPartnerServices } from "./partnerServices";

describe("technicianMatchesPartnerServices", () => {
  it("matches by category when booking serviceTypeId differs from partner block", () => {
    const tech = {
      services: [
        {
          serviceTypeId: "partner-type-id",
          categories: [{ categoryId: "cat1", serviceCategoryIds: ["sc1"] }],
        },
      ],
    };
    assert.equal(technicianMatchesPartnerServices(tech, "cat1", "booking-type-id", "sc1"), true);
  });

  it("treats empty serviceCategoryIds as all service categories under approved category", () => {
    const tech = {
      services: [
        {
          serviceTypeId: "st1",
          categories: [{ categoryId: "cat1", serviceCategoryIds: [] }],
        },
      ],
    };
    assert.equal(technicianMatchesPartnerServices(tech, "cat1", "st1", "sc-any"), true);
    assert.equal(technicianMatchesPartnerServices(tech, "cat1", "st1", ""), true);
    assert.equal(technicianMatchesPartnerServices(tech, "cat-other", "st1", "sc-any"), false);
  });
});
