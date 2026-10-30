import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import { assertAssignedWallPanelEmployee } from "@/lib/wall-panel/access";
import { assertWallPanelTransition } from "@/lib/wall-panel/status";
import type { WallPanelQuotationLine } from "@/lib/wall-panel/types";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    const body = (await req.json().catch(() => ({}))) as {
      bookingId?: string;
      lines?: WallPanelQuotationLine[];
      totalRupees?: number;
      notes?: string;
    };
    const bookingId = String(body.bookingId || "").trim();
    if (!bookingId) return jsonWithCors(req, { error: "Missing bookingId" }, { status: 400 });

    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) return jsonWithCors(req, { error: "Add at least one design line" }, { status: 400 });

    let total = 0;
    const normalized = lines.map((line) => {
      const qty = Math.max(1, Math.round(Number(line.quantity) || 1));
      const unit = Math.round(Number(line.unitPriceRupees ?? line.lineTotalRupees) || 0);
      const lineTotal = Math.round(Number(line.lineTotalRupees) || unit * qty);
      total += lineTotal;
      return {
        designId: String(line.designId || "").trim(),
        designName: String(line.designName || "").trim(),
        widthCm: Number(line.widthCm) || null,
        heightCm: Number(line.heightCm) || null,
        quantity: qty,
        unitPriceRupees: unit,
        lineTotalRupees: lineTotal,
      };
    });

    if (body.totalRupees != null && Number.isFinite(Number(body.totalRupees))) {
      total = Math.round(Number(body.totalRupees) * 100) / 100;
    }
    if (total <= 0) return jsonWithCors(req, { error: "Invalid quotation amount" }, { status: 400 });

    const db = getAdminDb();
    const bookingRef = db.doc(`wallPanelBookings/${bookingId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(bookingRef);
      if (!snap.exists) throw Object.assign(new Error("Booking not found"), { status: 404 });
      const data = snap.data() || {};
      await assertAssignedWallPanelEmployee(caller, String(data.assignedEmployeeId || ""));
      assertWallPanelTransition(String(data.status), "QUOTATION_PENDING_CUSTOMER");
      tx.update(bookingRef, {
        status: "QUOTATION_PENDING_CUSTOMER",
        quotation: {
          lines: normalized,
          totalRupees: total,
          notes: String(body.notes || "").trim(),
          submittedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return jsonWithCors(req, { ok: true, bookingId, totalRupees: total });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Could not submit quotation") }, { status });
  }
}
