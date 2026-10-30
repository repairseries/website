import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { recordAdminPartnerPayout, type AdminPayoutMethod } from "@/lib/payments/adminPayout";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import { assertAdminPanelCaller } from "@/lib/server/adminAccess";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

function normalizeMethod(raw: unknown): AdminPayoutMethod {
  const v = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (v === "UPI") return "UPI";
  if (v === "BANK_TRANSFER" || v === "BANK") return "BANK_TRANSFER";
  if (v === "CASH") return "CASH";
  throw Object.assign(new Error("Invalid payment method"), { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    await assertAdminPanelCaller(caller);

    const body = (await req.json().catch(() => ({}))) as {
      partnerId?: string;
      amountRupees?: number;
      amountPaise?: number;
      paymentMethod?: string;
      transactionReference?: string;
      notes?: string;
      idempotencyKey?: string;
    };

    const partnerId = String(body.partnerId || "").trim();
    const amountPaise =
      body.amountPaise != null
        ? Math.round(Number(body.amountPaise))
        : Math.round(Number(body.amountRupees || 0) * 100);

    const paymentMethod = normalizeMethod(body.paymentMethod);
    const idempotencyKey =
      String(body.idempotencyKey || "").trim() ||
      `admin_payout:${partnerId}:${caller.uid}:${amountPaise}:${paymentMethod}:${Date.now()}`;

    const db = getAdminDb();
    const result = await recordAdminPartnerPayout(db, {
      partnerId,
      amountPaise,
      paymentMethod,
      transactionReference: body.transactionReference,
      notes: body.notes,
      adminUid: caller.uid,
      idempotencyKey,
    });

    return jsonWithCors(req, {
      ok: true,
      partnerId,
      balancePaise: result.balancePaise,
      balanceRupees: result.balancePaise / 100,
      posted: result.posted,
    });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Payout failed") }, { status });
  }
}
