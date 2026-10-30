import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import { createRazorpayOrder } from "@/lib/payments/razorpay";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    const partnerId = String(caller.uid || "").trim();
    if (!partnerId) {
      return jsonWithCors(req, { error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { amountRupees?: number };
    const db = getAdminDb();
    const walletSnap = await db.doc(`partnerWallets/${partnerId}`).get();
    const balancePaise = Math.round(Number(walletSnap.data()?.balancePaise) || 0);
    if (balancePaise >= 0) {
      return jsonWithCors(req, { error: "No outstanding amount owed to Repair Series" }, { status: 400 });
    }

    const debtPaise = Math.abs(balancePaise);
    let amountPaise = debtPaise;
    if (body.amountRupees != null && Number.isFinite(Number(body.amountRupees))) {
      amountPaise = Math.round(Number(body.amountRupees) * 100);
    }
    if (amountPaise <= 0 || amountPaise > debtPaise) {
      return jsonWithCors(
        req,
        { error: "Amount must be between ₹0.01 and outstanding balance" },
        { status: 400 },
      );
    }

    const paymentIntentId = db.collection("partnerWalletPayments").doc().id;
    const checkoutToken = crypto.randomBytes(24).toString("hex");
    const tokenExpiresAt = new Date(Date.now() + 20 * 60 * 1000);

    const { orderId, keyId } = await createRazorpayOrder({
      amountPaise,
      receipt: paymentIntentId.slice(0, 36),
      notes: {
        purpose: "partner_wallet_settlement",
        partnerId,
        paymentIntentId,
      },
    });

    await db.doc(`partnerWalletPayments/${paymentIntentId}`).set({
      paymentIntentId,
      partnerId,
      amountPaise,
      amountRupees: amountPaise / 100,
      status: "PENDING",
      razorpayOrderId: orderId,
      checkoutToken,
      checkoutTokenExpiresAt: tokenExpiresAt,
      createdAt: FieldValue.serverTimestamp(),
    });

    const site = String(process.env.NEXT_PUBLIC_SITE_URL || "https://www.repairseries.in")
      .trim()
      .replace(/\/$/, "");
    const checkoutUrl = `${site}/partners/wallet-pay?token=${encodeURIComponent(checkoutToken)}`;

    return jsonWithCors(req, {
      ok: true,
      paymentIntentId,
      orderId,
      keyId,
      amountPaise,
      amountRupees: amountPaise / 100,
      checkoutUrl,
    });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Could not start payment") }, { status });
  }
}
