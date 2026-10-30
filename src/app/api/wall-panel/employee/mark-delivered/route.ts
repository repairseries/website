import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import { assertAssignedWallPanelEmployee } from "@/lib/wall-panel/access";
import { generateWallPanelOtp, otpExpiryDate } from "@/lib/wall-panel/otp";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    const body = (await req.json().catch(() => ({}))) as { bookingId?: string };
    const bookingId = String(body.bookingId || "").trim();
    if (!bookingId) return jsonWithCors(req, { error: "Missing bookingId" }, { status: 400 });

    const db = getAdminDb();
    const bookingRef = db.doc(`wallPanelBookings/${bookingId}`);
    const otp = generateWallPanelOtp();
    const expires = otpExpiryDate(30);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(bookingRef);
      if (!snap.exists) throw Object.assign(new Error("Booking not found"), { status: 404 });
      const data = snap.data() || {};
      await assertAssignedWallPanelEmployee(caller, String(data.assignedEmployeeId || ""));
      const status = String(data.status || "");
      if (status !== "QUOTATION_ACCEPTED" && status !== "DELIVERY_IN_PROGRESS" && status !== "DELIVERY_OTP_PENDING") {
        throw Object.assign(new Error("Booking is not ready for delivery confirmation"), { status: 409 });
      }
      tx.update(bookingRef, {
        status: "DELIVERY_OTP_PENDING",
        deliveryOtp: otp,
        deliveryOtpExpiresAt: Timestamp.fromDate(expires),
        deliveryMarkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return jsonWithCors(req, { ok: true, bookingId, message: "Delivery OTP sent to customer" });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Could not mark delivered") }, { status });
  }
}
