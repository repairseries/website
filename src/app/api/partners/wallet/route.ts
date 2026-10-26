import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function GET(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    const partnerId = String(caller.uid || "").trim();
    if (!partnerId) {
      return jsonWithCors(req, { error: "Unauthorized" }, { status: 401 });
    }

    const db = getAdminDb();
    const walletSnap = await db.doc(`partnerWallets/${partnerId}`).get();
    const balancePaise = Math.round(Number(walletSnap.data()?.balancePaise) || 0);

    const ledgerSnap = await db
      .collection("walletLedger")
      .where("partnerId", "==", partnerId)
      .orderBy("createdAt", "desc")
      .limit(40)
      .get()
      .catch(async () => {
        const fallback = await db
          .collection("walletLedger")
          .where("partnerId", "==", partnerId)
          .limit(40)
          .get();
        return fallback;
      });

    const entries = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const settlementSnap = await db.doc(`cashSettlements/${partnerId}_${today}`).get();
    const settlement = settlementSnap.exists ? settlementSnap.data() : null;

    return jsonWithCors(req, {
      ok: true,
      partnerId,
      balancePaise,
      balanceRupees: balancePaise / 100,
      ledger: entries,
      todaySettlement: settlement,
    });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Could not load wallet") }, { status });
  }
}
