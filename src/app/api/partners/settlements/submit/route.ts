import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import { istDateKey } from "@/lib/payments/partnerWallet";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

/** Partner submits remittance proof — admin must verify before clearing obligations. */
export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    const partnerId = String(caller.uid || "").trim();
    const body = (await req.json().catch(() => ({}))) as {
      settlementDate?: string;
      amountPaise?: number;
      paymentReference?: string;
      proofUrl?: string;
    };

    const settlementDate = String(body.settlementDate || istDateKey()).trim();
    const amountPaise = Math.max(0, Math.round(Number(body.amountPaise) || 0));
    if (amountPaise <= 0) {
      return jsonWithCors(req, { error: "Invalid amount" }, { status: 400 });
    }

    const db = getAdminDb();
    const settlementId = `${partnerId}_${settlementDate}`;
    const ref = db.doc(`cashSettlements/${settlementId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      return jsonWithCors(req, { error: "No settlement record for this date" }, { status: 404 });
    }

    const submissionId = `${settlementId}_${Date.now()}`;
    await db.doc(`settlementSubmissions/${submissionId}`).set({
      submissionId,
      settlementId,
      partnerId,
      settlementDate,
      amountPaise,
      paymentReference: String(body.paymentReference || "").trim(),
      proofUrl: String(body.proofUrl || "").trim(),
      status: "SUBMITTED",
      submittedAt: FieldValue.serverTimestamp(),
    });

    await ref.set(
      {
        lastSubmissionId: submissionId,
        submissionStatus: "SUBMITTED",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return jsonWithCors(req, { ok: true, submissionId });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Submit failed") }, { status });
  }
}
