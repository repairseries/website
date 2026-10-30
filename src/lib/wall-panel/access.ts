import { getAdminDb } from "@/lib/firebase/admin";
import type { ApiCaller } from "@/lib/server/auth";
import { assertAdminPanelCaller } from "@/lib/server/adminAccess";

export async function assertWallPanelManager(caller: ApiCaller): Promise<void> {
  if (caller.role === "admin" || caller.role === "internal") return;
  const db = getAdminDb();
  const snap = await db.doc(`adminUsers/${caller.uid}`).get();
  const role = String(snap.data()?.role || "");
  const ok =
    snap.exists &&
    String(snap.data()?.status || "") === "active" &&
    (role === "superAdmin" ||
      role === "bookingManager" ||
      role === "wallPanelManager" ||
      role === "serviceManager");
  if (!ok) throw Object.assign(new Error("Wall Panel manager access required"), { status: 403 });
}

export async function assertWallPanelEmployee(caller: ApiCaller): Promise<{ employeeId: string; name: string }> {
  const db = getAdminDb();
  const empSnap = await db.doc(`wallPanelEmployees/${caller.uid}`).get();
  if (empSnap.exists && empSnap.data()?.active !== false) {
    return {
      employeeId: caller.uid,
      name: String(empSnap.data()?.name || "Employee"),
    };
  }
  await assertAdminPanelCaller(caller);
  return { employeeId: caller.uid, name: "Admin" };
}

export async function assertAssignedWallPanelEmployee(
  caller: ApiCaller,
  assignedEmployeeId: string,
): Promise<void> {
  const { employeeId } = await assertWallPanelEmployee(caller);
  const db = getAdminDb();
  const adminSnap = await db.doc(`adminUsers/${caller.uid}`).get();
  const isManager =
    adminSnap.exists &&
    ["superAdmin", "bookingManager", "wallPanelManager"].includes(String(adminSnap.data()?.role || ""));
  if (isManager) return;
  if (String(assignedEmployeeId || "") !== employeeId) {
    throw Object.assign(new Error("Not assigned to this booking"), { status: 403, code: "FORBIDDEN" });
  }
}

export function assertCustomerOwnsWallPanelBooking(caller: ApiCaller, customerId: string): void {
  if (caller.uid !== String(customerId || "")) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
}
