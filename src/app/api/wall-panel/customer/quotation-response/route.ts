import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import { assertCustomerOwnsWallPanelBooking } from "@/lib/wall-panel/access";
import { assertWallPanelTransition } from "@/lib/wall-panel/status";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    const body = (await req.json().catch(() => ({}))) as {
      bookingId?: string;
      decision?: "ACCEPT" | "REJECT";
    };
    const bookingId = String(body.bookingId || "").trim();
    const decision = body.decision === "REJECT" ? "REJECT" : body.decision === "ACCEPT" ? "ACCEPT" : null;
    if (!bookingId || !decision) {
      return jsonWithCors(req, { error: "Missing bookingId or decision" }, { status: 400 });
    }

    const db = getAdminDb();
    const bookingRef = db.doc(`wallPanelBookings/${bookingId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(bookingRef);
      if (!snap.exists) throw Object.assign(new Error("Booking not found"), { status: 404 });
      const data = snap.data() || {};
      assertCustomerOwnsWallPanelBooking(caller, String(data.customerId || ""));
      if (String(data.status) !== "QUOTATION_PENDING_CUSTOMER") {
        throw Object.assign(new Error("Quotation is not awaiting your response"), { status: 409 });
      }
      const next = decision === "ACCEPT" ? "QUOTATION_ACCEPTED" : "QUOTATION_REJECTED";
      assertWallPanelTransition(String(data.status), next);
      const quotation = (data.quotation as Record<string, unknown>) || {};
      tx.update(bookingRef, {
        status: next,
        quotation: {
          ...quotation,
          customerDecision: decision,
          customerRespondedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return jsonWithCors(req, { ok: true, bookingId, status: decision === "ACCEPT" ? "QUOTATION_ACCEPTED" : "QUOTATION_REJECTED" });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Could not record response") }, { status });
  }
}
