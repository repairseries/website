import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import { assertWallPanelManager } from "@/lib/wall-panel/access";
import { assertWallPanelTransition } from "@/lib/wall-panel/status";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    await assertWallPanelManager(caller);

    const body = (await req.json().catch(() => ({}))) as {
      bookingId?: string;
      employeeId?: string;
    };
    const bookingId = String(body.bookingId || "").trim();
    const employeeId = String(body.employeeId || "").trim();
    if (!bookingId || !employeeId) {
      return jsonWithCors(req, { error: "Missing bookingId or employeeId" }, { status: 400 });
    }

    const db = getAdminDb();
    const empSnap = await db.doc(`wallPanelEmployees/${employeeId}`).get();
    if (!empSnap.exists || empSnap.data()?.active === false) {
      return jsonWithCors(req, { error: "Employee not found or inactive" }, { status: 404 });
    }

    const bookingRef = db.doc(`wallPanelBookings/${bookingId}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(bookingRef);
      if (!snap.exists) throw Object.assign(new Error("Booking not found"), { status: 404 });
      const data = snap.data() || {};
      assertWallPanelTransition(String(data.status), "ASSIGNED");
      tx.update(bookingRef, {
        status: "ASSIGNED",
        assignedEmployeeId: employeeId,
        assignedEmployeeName: String(empSnap.data()?.name || ""),
        assignedAt: FieldValue.serverTimestamp(),
        assignedByAdminId: caller.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return jsonWithCors(req, { ok: true, bookingId });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Assign failed") }, { status });
  }
}
