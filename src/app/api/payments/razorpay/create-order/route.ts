import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { assertBookingAccess, requireApiCaller } from "@/lib/server/auth";
import { bookingPayableAmount } from "@/lib/payments/bookingAmount";
import { createRazorpayOrder } from "@/lib/payments/razorpay";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
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
    assertBookingAccess(caller, booking);

    const payment = (booking.payment as Record<string, unknown> | undefined) || {};
    const st = String(payment.status ?? booking.paymentStatus ?? "").toUpperCase();
    if (st === "PAID" || st === "CASH_COLLECTED") {
      return jsonWithCors(req, { error: "Already paid" }, { status: 400 });
    }

    const amount = bookingPayableAmount(booking);
    if (amount <= 0) {
      return jsonWithCors(req, { error: "Nothing to pay" }, { status: 400 });
    }

    const existingOrder = String(payment.razorpayOrderId ?? "").trim();
    if (existingOrder) {
      return jsonWithCors(req, {
        orderId: existingOrder,
        amount,
        amountPaise: Math.round(amount * 100),
        keyId: String(process.env.RAZORPAY_KEY_ID || "").trim(),
        bookingId,
      });
    }

    const { orderId, keyId } = await createRazorpayOrder({
      amountPaise: Math.round(amount * 100),
      receipt: bookingId,
      notes: { bookingId, bookingCode: String(booking.bookingCode || "") },
    });

    await bookingRef.update({
      payment: {
        ...payment,
        status: "PENDING",
        method: "ONLINE",
        amount,
        razorpayOrderId: orderId,
        razorpayPaymentId: payment.razorpayPaymentId ?? null,
        paidAt: payment.paidAt ?? null,
        verifiedAt: payment.verifiedAt ?? null,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    return jsonWithCors(req, {
      orderId,
      amount,
      amountPaise: Math.round(amount * 100),
      keyId,
      bookingId,
    });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Could not start payment") }, { status });
  }
}
