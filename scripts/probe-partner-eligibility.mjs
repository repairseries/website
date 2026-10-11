/**
 * Lists assignable technicians for a category/service type (read-only).
 * Usage: tsx scripts/probe-partner-eligibility.mjs [categoryId] [serviceTypeId] [serviceCategoryId]
 */
import { getAdminDbVerified } from "../src/lib/firebase/admin.ts";
import {
  fetchTechniciansMatchingCategory,
  isPartnerAssignable,
  rankPartnersByDistance,
} from "../src/lib/booking/slot-allocation.ts";

const categoryId = process.argv[2] || "";
const serviceTypeId = process.argv[3] || "";
const serviceCategoryId = process.argv[4] || "";
const userLat = Number(process.argv[5] || 28.6139);
const userLng = Number(process.argv[6] || 77.209);

const db = await getAdminDbVerified();
const snap = await db.collection("technicians").get();
const technicians = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

const matching = fetchTechniciansMatchingCategory(
  technicians,
  categoryId,
  serviceTypeId,
  serviceCategoryId,
);
const ranked = rankPartnersByDistance(matching, userLat, userLng);
const assignable = technicians.filter((t) => isPartnerAssignable(t));

console.log(
  JSON.stringify(
    {
      categoryId: categoryId || "(any)",
      serviceTypeId: serviceTypeId || "(empty)",
      serviceCategoryId: serviceCategoryId || "(empty)",
      totalTechnicians: technicians.length,
      assignableByKyc: assignable.length,
      matchingCategoryAndServices: matching.length,
      rankedEligible: ranked.length,
      sampleIds: ranked.slice(0, 5).map((t) => t.id),
    },
    null,
    2,
  ),
);
