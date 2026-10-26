import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { assertBookingAccess, requireApiCaller } from "@/lib/server/auth";
import { applyVerifiedPayment } from "@/lib/payments/applyVerifiedPayment";
import { verifyRazorpayPaymentSignature } from "@/lib/payments/razorpay";
import { bookingPayableAmount } from "@/lib/payments/bookingAmount";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

/** Reconcile delayed SDK success — never trust client alone; verify signature when provided. */
export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    const body = (await req.json().catch(() => ({}))) as {
      bookingId?: string;
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
    };

    const bookingId = String(body.bookingId || "").trim();
    if (!bookingId) {
      return jsonWithCors(req, { error: "Missing bookingId" }, { status: 400 });
    }

    const db = getAdminDb();
    const snap = await db.doc(`bookings/${bookingId}`).get();
    if (!snap.exists) {
      return jsonWithCors(req, { error: "Booking not found" }, { status: 404 });
    }
    const booking = (snap.data() || {}) as Record<string, unknown>;
    assertBookingAccess(caller, booking);

    const payment = (booking.payment as Record<string, unknown> | undefined) || {};
    const st = String(payment.status ?? booking.paymentStatus ?? "").toUpperCase();
    if (st === "PAID" || st === "CASH_COLLECTED") {
      return jsonWithCors(req, { ok: true, status: st, alreadyPaid: true });
    }

    const orderId = String(body.razorpayOrderId || payment.razorpayOrderId || "").trim();
    const paymentId = String(body.razorpayPaymentId || "").trim();
    const signature = String(body.razorpaySignature || "").trim();

    if (paymentId && orderId && signature) {
      const valid = verifyRazorpayPaymentSignature({ orderId, paymentId, signature });
      if (!valid) {
        return jsonWithCors(req, { error: "Invalid payment signature" }, { status: 400 });
      }
    } else if (!paymentId) {
      return jsonWithCors(req, {
        ok: true,
        status: "PENDING",
        message: "Awaiting webhook verification",
      });
    }

    const amount = bookingPayableAmount(booking);
    const result = await applyVerifiedPayment(db, {
      bookingId,
      method: "ONLINE",
      amount,
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      idempotencyKey: `rzp:${paymentId}`,
    });

    return jsonWithCors(req, {
      ok: true,
      applied: result.applied,
      status: result.applied ? "PAID" : "PENDING",
    });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Verification failed") }, { status });
  }
}
