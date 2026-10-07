import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { assertBookingAccess, requireApiCaller } from "@/lib/server/auth";
import { applyVerifiedPayment } from "@/lib/payments/applyVerifiedPayment";
import { bookingPayableAmount } from "@/lib/payments/bookingAmount";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    if (caller.role !== "technician" && caller.role !== "admin" && caller.role !== "internal") {
      throw Object.assign(new Error("Not allowed"), { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { bookingId?: string };
    const bookingId = String(body.bookingId || "").trim();
    if (!bookingId) {
      return jsonWithCors(req, { error: "Missing bookingId" }, { status: 400 });
    }

    const db = getAdminDb();
    const bookingRef = db.doc(`bookings/${bookingId}`);
    const snap = await bookingRef.get();
    if (!snap.exists) {
      return jsonWithCors(req, { error: "Booking not found" }, { status: 404 });
    }
    const booking = (snap.data() || {}) as Record<string, unknown>;

    if (caller.role === "technician") {
      const techId = String(booking.technicianId || "").trim();
      const rows = Array.isArray(booking.partnerAssignments) ? booking.partnerAssignments : [];
      const allowed =
        techId === caller.uid ||
        rows.some((r) => String((r as { partnerId?: string }).partnerId || "") === caller.uid);
      if (!allowed) {
        throw Object.assign(new Error("Not allowed"), { status: 403 });
      }
    } else {
      assertBookingAccess(caller, booking);
    }

    const amount = bookingPayableAmount(booking);
    const result = await applyVerifiedPayment(db, {
      bookingId,
      method: "CASH",
      amount,
      idempotencyKey: `cash:${bookingId}:${caller.uid}`,
    });

    const photo = booking.completionPhoto as { url?: string } | undefined;
    const workDone = Boolean(String(photo?.url ?? "").trim());
    const status = String(booking.status || "");
    if (workDone && status !== "Completed") {
      await bookingRef.update({
        status: "Completed",
        lifecycleStatus: "COMPLETED",
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return jsonWithCors(req, { ok: true, applied: result.applied, bookingId });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Cash collection failed") }, { status });
  }
}
