import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import { assertAssignedWallPanelEmployee } from "@/lib/wall-panel/access";
import { assertWallPanelTransition } from "@/lib/wall-panel/status";
import { assertOtpValid } from "@/lib/wall-panel/otp";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    const body = (await req.json().catch(() => ({}))) as { bookingId?: string; otp?: string };
    const bookingId = String(body.bookingId || "").trim();
    if (!bookingId) return jsonWithCors(req, { error: "Missing bookingId" }, { status: 400 });

    const db = getAdminDb();
    const bookingRef = db.doc(`wallPanelBookings/${bookingId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(bookingRef);
      if (!snap.exists) throw Object.assign(new Error("Booking not found"), { status: 404 });
      const data = snap.data() || {};
      await assertAssignedWallPanelEmployee(caller, String(data.assignedEmployeeId || ""));
      if (String(data.status) === "CONSULTATION_IN_PROGRESS") return;
      assertWallPanelTransition(String(data.status), "CONSULTATION_IN_PROGRESS");
      const exp = data.consultationOtpExpiresAt?.toDate?.() as Date | undefined;
      assertOtpValid(String(data.consultationOtp || ""), body.otp || "", exp);
      tx.update(bookingRef, {
        status: "CONSULTATION_IN_PROGRESS",
        consultationOtpVerifiedAt: FieldValue.serverTimestamp(),
        consultationOtp: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return jsonWithCors(req, { ok: true, bookingId });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "OTP verification failed") }, { status });
  }
}
