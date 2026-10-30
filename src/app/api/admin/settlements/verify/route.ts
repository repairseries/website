import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import { assertAdminPanelCaller } from "@/lib/server/adminAccess";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

/** Verify partner remittance and post settlement-clearing wallet credit. */
export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    await assertAdminPanelCaller(caller);

    const body = (await req.json().catch(() => ({}))) as {
      submissionId?: string;
      approve?: boolean;
      rejectionReason?: string;
    };
    const submissionId = String(body.submissionId || "").trim();
    if (!submissionId) {
      return jsonWithCors(req, { error: "Missing submissionId" }, { status: 400 });
    }

    const db = getAdminDb();
    const subRef = db.doc(`settlementSubmissions/${submissionId}`);
    const subSnap = await subRef.get();
    if (!subSnap.exists) {
      return jsonWithCors(req, { error: "Submission not found" }, { status: 404 });
    }
    const sub = subSnap.data() || {};
    if (String(sub.status) === "VERIFIED") {
      return jsonWithCors(req, { ok: true, alreadyVerified: true });
    }

    if (body.approve === false) {
      await subRef.update({
        status: "REJECTED",
        rejectionReason: String(body.rejectionReason || "").trim(),
        verifiedAt: FieldValue.serverTimestamp(),
        verifiedBy: caller.uid,
      });
      return jsonWithCors(req, { ok: true, rejected: true });
    }

    const partnerId = String(sub.partnerId || "").trim();
    const amountPaise = Math.round(Number(sub.amountPaise) || 0);
    const settlementId = String(sub.settlementId || "").trim();
    const idempotencyKey = `settlement_clear:${submissionId}`;

    await db.runTransaction(async (tx) => {
      const eventRef = db.doc(`paymentEvents/${idempotencyKey}`);
      const eventSnap = await tx.get(eventRef);
      if (eventSnap.exists) return;

      const settlementRef = db.doc(`cashSettlements/${settlementId}`);
      const settlementSnap = await tx.get(settlementRef);
      const settlement = settlementSnap.data() || {};

      const walletRef = db.doc(`partnerWallets/${partnerId}`);
      const walletSnap = await tx.get(walletRef);
      let balancePaise = Math.round(Number(walletSnap.data()?.balancePaise) || 0);
      balancePaise += amountPaise;

      const remitted =
        Math.round(Number(settlement.amountRemittedPaise) || 0) + amountPaise;
      const companyDue = Math.round(Number(settlement.companyShareDuePaise) || 0);
      const outstanding = Math.max(0, companyDue - remitted);

      tx.set(db.doc(`walletLedger/${idempotencyKey}`), {
        transactionId: idempotencyKey,
        partnerId,
        bookingId: null,
        type: "SETTLEMENT_CLEARING",
        direction: "CREDIT",
        amountPaise,
        currency: "INR",
        status: "POSTED",
        sourceType: "SETTLEMENT_VERIFIED",
        sourceId: submissionId,
        idempotencyKey,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(walletRef, {
        partnerId,
        currency: "INR",
        balancePaise,
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(
        settlementRef,
        {
          amountRemittedPaise: remitted,
          amountOutstandingPaise: outstanding,
          status: outstanding > 0 ? "PARTIAL" : "SETTLED",
          verifiedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      tx.update(subRef, {
        status: "VERIFIED",
        verifiedAt: FieldValue.serverTimestamp(),
        verifiedBy: caller.uid,
      });

      tx.set(eventRef, {
        type: "settlement_clearing",
        submissionId,
        partnerId,
        amountPaise,
        processedAt: FieldValue.serverTimestamp(),
      });
    });

    return jsonWithCors(req, { ok: true, verified: true });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Verify failed") }, { status });
  }
}
