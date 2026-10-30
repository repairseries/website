import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { razorpayCredentials } from "@/lib/payments/razorpay";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

/** Public launch payload for hosted Razorpay checkout (short-lived token). */
export async function GET(req: NextRequest) {
  try {
    const token = String(req.nextUrl.searchParams.get("token") || "").trim();
    if (!token) {
      return jsonWithCors(req, { error: "Missing token" }, { status: 400 });
    }

    const db = getAdminDb();
    const q = await db
      .collection("partnerWalletPayments")
      .where("checkoutToken", "==", token)
      .limit(1)
      .get();
    if (q.empty) {
      return jsonWithCors(req, { error: "Invalid or expired checkout" }, { status: 404 });
    }
    const doc = q.docs[0]!;
    const data = doc.data() || {};
    if (String(data.status) === "PAID") {
      return jsonWithCors(req, { ok: true, alreadyPaid: true, paymentIntentId: doc.id });
    }
    const exp = data.checkoutTokenExpiresAt?.toDate?.() as Date | undefined;
    if (exp && exp.getTime() < Date.now()) {
      return jsonWithCors(req, { error: "Checkout expired — open Pay Now again" }, { status: 410 });
    }

    const { keyId } = razorpayCredentials();
    return jsonWithCors(req, {
      ok: true,
      paymentIntentId: doc.id,
      orderId: String(data.razorpayOrderId || ""),
      amountPaise: Math.round(Number(data.amountPaise) || 0),
      keyId,
      partnerId: String(data.partnerId || ""),
    });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Checkout unavailable") }, { status });
  }
}
