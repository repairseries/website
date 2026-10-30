import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";

export const runtime = "nodejs";

const OPEN_STATUSES = new Set(["PENDING", "APPROVED"]);

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
    const amountRupees = Math.round(Number(String(body.amountRupees).replace(/,/g, "")) * 100) / 100;
    if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
      return jsonWithCors(req, { error: "Enter a valid amount greater than ₹0" }, { status: 400 });
    }

    const db = getAdminDb();
    const walletSnap = await db.doc(`partnerWallets/${partnerId}`).get();
    const balancePaise = Math.round(Number(walletSnap.data()?.balancePaise) || 0);
    if (balancePaise <= 0) {
      return jsonWithCors(req, { error: "No positive settlement balance available" }, { status: 400 });
    }

    const allPending = await db.collection(`technicians/${partnerId}/payoutRequests`).get();

    let pendingPaise = 0;
    for (const d of allPending.docs) {
      const st = String(d.data()?.status || "pending").toUpperCase();
      if (!OPEN_STATUSES.has(st)) continue;
      pendingPaise += Math.round(Number(d.data()?.amountPaise ?? (Number(d.data()?.amount) || 0) * 100) || 0);
    }

    const walletPositivePaise = balancePaise;
    const availablePaise = Math.max(0, walletPositivePaise - pendingPaise);
    const amountPaise = Math.round(amountRupees * 100);

    if (amountPaise > availablePaise) {
      return jsonWithCors(
        req,
        {
          error: "Amount exceeds available balance after pending requests",
          availableRupees: availablePaise / 100,
          pendingRupees: pendingPaise / 100,
        },
        { status: 400 },
      );
    }

    const requestRef = db.collection(`technicians/${partnerId}/payoutRequests`).doc();
    const payload = {
      amount: amountRupees,
      amountPaise,
      status: "PENDING",
      partnerId,
      walletBalancePaise: balancePaise,
      availablePayoutPaise: availablePaise - amountPaise,
      createdAt: FieldValue.serverTimestamp(),
    };
    await requestRef.set(payload);

    return jsonWithCors(req, {
      ok: true,
      requestId: requestRef.id,
      status: "PENDING",
      availableRupeesAfter: (availablePaise - amountPaise) / 100,
    });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Could not submit payout request") }, { status });
  }
}
