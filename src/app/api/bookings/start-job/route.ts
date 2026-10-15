import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller, requirePartnerBookingAccess } from "@/lib/server/auth";
import { LIFECYCLE } from "@/lib/booking/lifecycle";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);

    const body = (await req.json().catch(() => ({}))) as { bookingId?: string; otp?: string };
    const bookingId = String(body.bookingId || "").trim();
    const entered = String(body.otp || "").replace(/\D/g, "").trim();
    if (!bookingId || entered.length < 4) {
      return jsonWithCors(req, { error: "Missing booking or OTP" }, { status: 400 });
    }

    const db = getAdminDb();
    const bookingRef = db.doc(`bookings/${bookingId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(bookingRef);
      if (!snap.exists) {
        throw Object.assign(new Error("Booking not found"), { status: 404 });
      }
      const booking = snap.data() || {};
      requirePartnerBookingAccess(caller, booking);

      const status = String(booking.status || "");
      if (status === "InProgress" || status === "In Progress" || status === "Completed") {
        return;
      }

      const expected = String(booking.otp ?? "").trim();
      if (!expected) {
        throw Object.assign(new Error("OTP not ready yet"), { status: 409 });
      }
      if (entered !== expected) {
        throw Object.assign(new Error("Invalid OTP"), { status: 403, code: "INVALID_OTP" });
      }

      tx.update(bookingRef, {
        status: "InProgress",
        lifecycleStatus: LIFECYCLE.JOB_STARTED,
        otpVerifiedAt: FieldValue.serverTimestamp(),
        serviceStartedAt: FieldValue.serverTimestamp(),
        otp: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return jsonWithCors(req, { ok: true, bookingId });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Could not start job") }, { status });
  }
}
