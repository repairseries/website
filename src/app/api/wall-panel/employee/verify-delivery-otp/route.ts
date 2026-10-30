import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import { assertAssignedWallPanelEmployee } from "@/lib/wall-panel/access";
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
      if (String(data.status) === "COMPLETED") return;
      if (String(data.status) !== "DELIVERY_OTP_PENDING") {
        throw Object.assign(new Error("Delivery OTP not pending"), { status: 409 });
      }
      const exp = data.deliveryOtpExpiresAt?.toDate?.() as Date | undefined;
      assertOtpValid(String(data.deliveryOtp || ""), body.otp || "", exp);
      tx.update(bookingRef, {
        status: "COMPLETED",
        deliveryOtpVerifiedAt: FieldValue.serverTimestamp(),
        deliveryOtp: FieldValue.delete(),
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return jsonWithCors(req, { ok: true, bookingId, status: "COMPLETED" });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Delivery verification failed") }, { status });
  }
}
