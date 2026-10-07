import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { jsonWithCors } from "@/lib/api/cors";
import { adminCredentialFailure, requireApiCaller } from "@/lib/server/auth";
import { publicErrorMessage } from "@/lib/server/http";
import { getAdminDb } from "@/lib/firebase/admin";
import { assignPartner } from "@/lib/server/assignment/assignPartner";
import { ASSIGNMENT_STATUS, LIFECYCLE } from "@/lib/booking/lifecycle";

type AssignmentRow = {
  partnerId?: string;
  status?: string;
};

function partnerRowForTech(rows: AssignmentRow[], techId: string): AssignmentRow | null {
  const hit = rows.find((r) => String(r.partnerId || "").trim() === techId);
  return hit || null;
}

export async function handleAssignmentResponsePost(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    const body = (await req.json().catch(() => ({}))) as {
      bookingId?: string;
      action?: string;
    };
    const bookingId = String(body.bookingId || "").trim();
    const action = String(body.action || "").trim().toLowerCase();
    if (!bookingId) {
      throw Object.assign(new Error("Missing bookingId"), { status: 400 });
    }
    if (!["accept", "decline", "timeout"].includes(action)) {
      throw Object.assign(new Error("Invalid action"), { status: 400 });
    }
    if (caller.role !== "technician" && caller.role !== "admin" && caller.role !== "internal") {
      throw Object.assign(new Error("Not allowed"), { status: 403 });
    }

    const db = getAdminDb();
    const bookingRef = db.doc(`bookings/${bookingId}`);

    if (action === "accept") {
      let accepted = false;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(bookingRef);
        if (!snap.exists) {
          throw Object.assign(new Error("Booking not found"), { status: 404 });
        }
        const booking = snap.data() || {};
        const assignmentStatus = String(booking.assignmentStatus || "").toUpperCase();
        if (assignmentStatus === ASSIGNMENT_STATUS.ACCEPTED) {
          accepted = true;
          return;
        }
        if (assignmentStatus !== ASSIGNMENT_STATUS.OFFERED) {
          throw Object.assign(new Error("Assignment is no longer offered"), { status: 409 });
        }

        const techId = String(booking.technicianId || "").trim();
        if (caller.role === "technician" && techId !== caller.uid) {
          const rows = Array.isArray(booking.partnerAssignments)
            ? (booking.partnerAssignments as AssignmentRow[])
            : [];
          if (!partnerRowForTech(rows, caller.uid)) {
            throw Object.assign(new Error("Not allowed"), { status: 403 });
          }
        }

        const actorId =
          caller.role === "technician" ? caller.uid : String(booking.technicianId || "").trim();
        const rows = Array.isArray(booking.partnerAssignments)
          ? [...(booking.partnerAssignments as AssignmentRow[])]
          : [];
        const nextRows = rows.map((row) => {
          if (String(row.partnerId || "").trim() === actorId) {
            return { ...row, status: "ACCEPTED", acceptedAt: new Date().toISOString() };
          }
          return row;
        });

        tx.update(bookingRef, {
          assignmentStatus: ASSIGNMENT_STATUS.ACCEPTED,
          lifecycleStatus: LIFECYCLE.PARTNER_ACCEPTED,
          assignmentRespondedAt: FieldValue.serverTimestamp(),
          partnerAssignments: nextRows.length ? nextRows : FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        accepted = true;
      });
      return jsonWithCors(req, {
        success: true,
        bookingId,
        assignmentStatus: ASSIGNMENT_STATUS.ACCEPTED,
        alreadyAccepted: accepted,
      });
    }

    const snap = await bookingRef.get();
    if (!snap.exists) {
      throw Object.assign(new Error("Booking not found"), { status: 404 });
    }
    const booking = snap.data() || {};
    const techId = String(booking.technicianId || "").trim();
    if (caller.role === "technician" && techId !== caller.uid) {
      throw Object.assign(new Error("Not allowed"), { status: 403 });
    }

    await bookingRef.update({
      assignmentStatus:
        action === "decline" ? ASSIGNMENT_STATUS.DECLINED : ASSIGNMENT_STATUS.UNRESPONDED,
      assignmentRespondedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const excludeIds = new Set<string>(inputExclude(booking, techId, caller));
    try {
      const result = await assignPartner({
        bookingId,
        mode: "nearest",
        caller: { uid: "internal", role: "internal" },
        excludeTechnicianIds: [...excludeIds],
      });
      return jsonWithCors(req, {
        success: true,
        bookingId,
        reassigned: true,
        technicianId: result.technicianId,
      });
    } catch (err) {
      await bookingRef.update({
        technicianId: null,
        technicianName: "",
        lifecycleStatus: LIFECYCLE.FINDING_PARTNER,
        assignmentStatus: ASSIGNMENT_STATUS.SEARCHING,
        findingPartnerSince: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return jsonWithCors(req, {
        success: true,
        bookingId,
        reassigned: false,
        findingPartner: true,
        error: publicErrorMessage(err, "Finding next partner"),
      });
    }
  } catch (err) {
    const serverCreds = adminCredentialFailure(err);
    const status = serverCreds ? 503 : Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(
      req,
      {
        success: false,
        error: publicErrorMessage(err, "Could not record assignment response"),
        code: serverCreds ? "SERVER_CONFIGURATION_ERROR" : (err as { code?: string }).code,
      },
      { status },
    );
  }
}

function inputExclude(
  booking: Record<string, unknown>,
  techId: string,
  caller: { uid: string; role: string },
): string[] {
  const ids: string[] = [];
  if (techId) ids.push(techId);
  if (caller.role === "technician") ids.push(caller.uid);
  const rows = Array.isArray(booking.partnerAssignments)
    ? (booking.partnerAssignments as AssignmentRow[])
    : [];
  for (const row of rows) {
    const pid = String(row.partnerId || "").trim();
    if (pid) ids.push(pid);
  }
  return [...new Set(ids)];
}
