import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { applyVerifiedPayment } from "@/lib/payments/applyVerifiedPayment";
import { verifyRazorpayWebhookSignature } from "@/lib/payments/razorpay";

export const runtime = "nodejs";

type RazorpayWebhookPayload = {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        amount?: number;
        status?: string;
        notes?: Record<string, string>;
      };
    };
  };
};

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature") || "";
    if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
      return jsonWithCors(req, { error: "Invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(rawBody) as RazorpayWebhookPayload;
    const event = String(body.event || "");
    if (event !== "payment.captured") {
      return jsonWithCors(req, { ok: true, ignored: true });
    }

    const entity = body.payload?.payment?.entity;
    const paymentId = String(entity?.id || "").trim();
    const orderId = String(entity?.order_id || "").trim();
    const status = String(entity?.status || "").toLowerCase();
    if (!paymentId || !orderId || status !== "captured") {
      return jsonWithCors(req, { ok: true, ignored: true });
    }

    const db = getAdminDb();
    let bookingId = String(entity?.notes?.bookingId || "").trim();
    if (!bookingId) {
      const q = await db
        .collection("bookings")
        .where("payment.razorpayOrderId", "==", orderId)
        .limit(1)
        .get();
      bookingId = q.empty ? "" : q.docs[0]!.id;
    }
    if (!bookingId) {
      return jsonWithCors(req, { error: "Booking not mapped" }, { status: 404 });
    }

    const amountRupees = Number(entity?.amount || 0) / 100;
    const result = await applyVerifiedPayment(db, {
      bookingId,
      method: "ONLINE",
      amount: amountRupees,
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      idempotencyKey: `rzp:${paymentId}`,
    });

    return jsonWithCors(req, { ok: true, applied: result.applied, bookingId });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    console.error("razorpay webhook", publicErrorMessage(err, "webhook failed"));
    return jsonWithCors(req, { error: publicErrorMessage(err, "Webhook failed") }, { status });
  }
}
