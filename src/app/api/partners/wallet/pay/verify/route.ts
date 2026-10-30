import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import { applyPartnerWalletPayment } from "@/lib/payments/applyPartnerWalletPayment";
import { verifyRazorpayPaymentSignature } from "@/lib/payments/razorpay";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    const partnerId = String(caller.uid || "").trim();
    const body = (await req.json().catch(() => ({}))) as {
      paymentIntentId?: string;
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
    };

    const paymentIntentId = String(body.paymentIntentId || "").trim();
    if (!paymentIntentId) {
      return jsonWithCors(req, { error: "Missing paymentIntentId" }, { status: 400 });
    }

    const db = getAdminDb();
    const intentRef = db.doc(`partnerWalletPayments/${paymentIntentId}`);
    const intentSnap = await intentRef.get();
    if (!intentSnap.exists) {
      return jsonWithCors(req, { error: "Payment not found" }, { status: 404 });
    }
    const intent = intentSnap.data() || {};
    if (String(intent.partnerId) !== partnerId) {
      return jsonWithCors(req, { error: "Forbidden" }, { status: 403 });
    }
    if (String(intent.status) === "PAID") {
      return jsonWithCors(req, { ok: true, alreadyPaid: true });
    }

    const orderId = String(body.razorpayOrderId || intent.razorpayOrderId || "").trim();
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
        message: "Awaiting payment confirmation",
      });
    }

    const amountPaise = Math.round(Number(intent.amountPaise) || 0);
    const result = await applyPartnerWalletPayment(db, {
      partnerId,
      amountPaise,
      paymentIntentId,
      idempotencyKey: `partner_wallet_pay:${paymentId}`,
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      sourceType: "RAZORPAY",
    });

    return jsonWithCors(req, { ok: true, applied: result.applied, status: result.applied ? "PAID" : "PENDING" });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Verification failed") }, { status });
  }
}
