/** Spec lifecycle. Firestore `status` stays New/Assigned/InProgress/Completed for compatibility. */

export const LIFECYCLE = {
  BOOKING_CREATED: "BOOKING_CREATED",
  FINDING_PARTNER: "FINDING_PARTNER",
  PARTNER_ASSIGNED: "PARTNER_ASSIGNED",
  PARTNER_ACCEPTED: "PARTNER_ACCEPTED",
  PARTNER_ON_THE_WAY: "PARTNER_ON_THE_WAY",
  PARTNER_ARRIVED: "PARTNER_ARRIVED",
  JOB_STARTED: "JOB_STARTED",
  DIAGNOSIS: "DIAGNOSIS",
  ADDITIONAL_APPROVAL: "ADDITIONAL_APPROVAL",
  WORK_IN_PROGRESS: "WORK_IN_PROGRESS",
  WORK_COMPLETED: "WORK_COMPLETED",
  INVOICE_GENERATED: "INVOICE_GENERATED",
  COMPLETED: "COMPLETED",
  RATED: "RATED",
} as const;

export const ASSIGNMENT_STATUS = {
  SEARCHING: "SEARCHING",
  OFFERED: "OFFERED",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  UNRESPONDED: "UNRESPONDED",
} as const;

export function findingPartnerPatch() {
  return {
    lifecycleStatus: LIFECYCLE.FINDING_PARTNER,
    assignmentStatus: ASSIGNMENT_STATUS.SEARCHING,
    findingPartnerSince: new Date().toISOString(),
  };
}

export function partnerOfferedPatch(opts: {
  partnerId: string;
  categoryId: string;
  serviceItemIds?: string[];
}) {
  return {
    lifecycleStatus: LIFECYCLE.PARTNER_ASSIGNED,
    assignmentStatus: ASSIGNMENT_STATUS.OFFERED,
    assignmentOfferedAt: new Date().toISOString(),
    partnerAssignments: [
      {
        partnerId: opts.partnerId,
        categoryId: opts.categoryId,
        serviceItems: opts.serviceItemIds || [],
        status: "ASSIGNED",
      },
    ],
  };
}

/** Assignment is auto-accepted when a partner is locked (no manual accept step). */
export function partnerAutoAcceptedLifecycleFields() {
  return {
    lifecycleStatus: LIFECYCLE.PARTNER_ACCEPTED,
    assignmentStatus: ASSIGNMENT_STATUS.ACCEPTED,
  };
}
