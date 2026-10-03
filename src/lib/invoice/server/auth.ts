import { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { adminCredentialFailure } from "@/lib/server/auth";
import {
  getDocumentWithUserToken,
  verifyIdTokenWithApiKey,
} from "@/lib/server/userFirestore";

export type InvoiceAccess = {
  uid: string;
  role: "customer" | "admin" | "technician" | "internal";
  idToken: string;
};

export function invoiceCallerToken(req: NextRequest): string {
  const header = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match?.[1]) return match[1].trim();
  return String(req.nextUrl.searchParams.get("access_token") || "").trim();
}

export async function requireInvoiceCaller(req: NextRequest): Promise<InvoiceAccess> {
  const token = invoiceCallerToken(req);
  if (!token) {
    throw Object.assign(new Error("Sign in required"), { status: 401 });
  }

  const internalSecrets = [
    process.env.NOTIFY_INTERNAL_SECRET,
    process.env.NOTIFY_SECRET,
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  if (internalSecrets.includes(token)) {
    return { uid: "internal", role: "internal", idToken: token };
  }

  let uid = "";
  try {
    const decoded = await (await getAdminAuth()).verifyIdToken(token);
    uid = String(decoded.uid || "");
  } catch (err) {
    if (!adminCredentialFailure(err)) {
      throw Object.assign(new Error("Invalid or expired session"), { status: 401 });
    }
    const fallback = await verifyIdTokenWithApiKey(token);
    uid = fallback.uid;
  }
  if (!uid) {
    throw Object.assign(new Error("Sign in required"), { status: 401 });
  }

  try {
    const db = getAdminDb();
    const adminSnap = await db.doc(`adminUsers/${uid}`).get();
    if (adminSnap.exists && String(adminSnap.data()?.status ?? "") === "active") {
      return { uid, role: "admin", idToken: token };
    }
    const techSnap = await db.doc(`technicians/${uid}`).get();
    if (techSnap.exists) {
      return { uid, role: "technician", idToken: token };
    }
  } catch (err) {
    if (!adminCredentialFailure(err)) throw err;
    try {
      const adminDoc = await getDocumentWithUserToken(token, `adminUsers/${uid}`);
      if (adminDoc && String(adminDoc.status ?? "") === "active") {
        return { uid, role: "admin", idToken: token };
      }
    } catch {
      /* customer cannot read adminUsers */
    }
    try {
      const techDoc = await getDocumentWithUserToken(token, `technicians/${uid}`);
      if (techDoc) return { uid, role: "technician", idToken: token };
    } catch {
      /* not a technician */
    }
  }

  return { uid, role: "customer", idToken: token };
}

export async function assertBookingAccess(
  access: InvoiceAccess,
  booking: Record<string, unknown>,
): Promise<void> {
  if (access.role === "admin" || access.role === "internal") return;
  if (access.role === "customer" && String(booking.customerId ?? "") === String(access.uid)) {
    return;
  }
  if (
    access.role === "technician" &&
    String(booking.technicianId ?? "") === String(access.uid)
  ) {
    return;
  }
  throw Object.assign(new Error("Not allowed"), { status: 403 });
}

export async function loadBookingForInvoice(
  access: InvoiceAccess,
  bookingId: string,
): Promise<Record<string, unknown>> {
  try {
    const db = getAdminDb();
    const snap = await db.doc(`bookings/${bookingId}`).get();
    if (!snap.exists) {
      throw Object.assign(new Error("Booking not found"), { status: 404 });
    }
    return (snap.data() || {}) as Record<string, unknown>;
  } catch (err) {
    if (Number((err as { status?: number }).status) === 404) throw err;
    if (!adminCredentialFailure(err)) throw err;
    const data = await getDocumentWithUserToken(access.idToken, `bookings/${bookingId}`);
    if (!data) {
      throw Object.assign(new Error("Booking not found"), { status: 404 });
    }
    return data;
  }
}

export async function loadInvoiceRecordForBooking(
  access: InvoiceAccess,
  invoiceId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const db = getAdminDb();
    const snap = await db.doc(`invoices/${invoiceId}`).get();
    if (!snap.exists) return null;
    return (snap.data() || {}) as Record<string, unknown>;
  } catch (err) {
    if (!adminCredentialFailure(err)) throw err;
    try {
      return await getDocumentWithUserToken(access.idToken, `invoices/${invoiceId}`);
    } catch {
      return null;
    }
  }
}
