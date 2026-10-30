import { getAdminDb } from "@/lib/firebase/admin";
import type { ApiCaller } from "@/lib/server/auth";

/** Active admin panel user (superAdmin, technicianManager, bookingManager). */
export async function assertAdminPanelCaller(caller: ApiCaller): Promise<void> {
  if (caller.role === "admin" || caller.role === "internal") return;
  const db = getAdminDb();
  const snap = await db.doc(`adminUsers/${caller.uid}`).get();
  const role = String(snap.data()?.role || "").toLowerCase();
  const ok =
    snap.exists &&
    String(snap.data()?.status || "") === "active" &&
    (role === "superadmin" || role === "technicianmanager" || role === "bookingmanager");
  if (!ok) throw Object.assign(new Error("Admin only"), { status: 403, code: "FORBIDDEN" });
}
