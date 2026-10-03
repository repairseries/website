import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  assertBookingAccess,
  loadBookingForInvoice,
  loadInvoiceRecordForBooking,
  requireInvoiceCaller,
  type InvoiceAccess,
} from "@/lib/invoice/server/auth";
import { jsonWithCors } from "@/lib/api/cors";
import { invoiceDocId } from "@/lib/server/finance";
import { pickStoredCloudinaryInvoiceUrl } from "@/lib/storage/invoicePdf";

export async function handleGeneratePost(req: NextRequest) {
  console.info("[Invoice API] Authentication status", "checking");
  let access: InvoiceAccess;
  try {
    access = await requireInvoiceCaller(req);
    console.info("[Invoice API] Authentication result", { ok: true, role: access.role });
  } catch (err) {
    console.info("[Invoice API] Authentication result", { ok: false });
    throw err;
  }

  const body = (await req.json().catch(() => ({}))) as {
    bookingId?: string;
    force?: boolean;
    sendEmail?: boolean;
  };

  const bookingId = String(body.bookingId || "").trim();
  if (!bookingId) {
    return jsonWithCors(req, { error: "Missing bookingId" }, { status: 400 });
  }

  const booking = await loadBookingForInvoice(access, bookingId);
  try {
    await assertBookingAccess(access, booking);
    console.info("[Invoice API] Authorization result", { ok: true, role: access.role });
  } catch (err) {
    console.info("[Invoice API] Authorization result", { ok: false, role: access.role });
    throw err;
  }

  const existingInvoice = await loadInvoiceRecordForBooking(
    access,
    String(booking.invoiceId || invoiceDocId(bookingId)),
  );
  const existingPdfUrl = pickStoredCloudinaryInvoiceUrl(booking, existingInvoice);
  const force = access.role === "admin" ? Boolean(body.force) : false;
  if (existingPdfUrl && !force) {
    console.info("[Invoice API] Reusing Cloudinary invoice URL", { bookingId });
    return jsonWithCors(req, {
      ok: true,
      success: true,
      reused: true,
      pdfUrl: existingPdfUrl,
      invoicePdfUrl: existingPdfUrl,
      invoiceId: booking.invoiceId || invoiceDocId(bookingId),
      invoiceNumber: booking.invoiceNumber || existingInvoice?.invoiceNumber || "",
    });
  }

  console.info("[Invoice API] Invoice generation started", { bookingId });
  let generateAndStoreInvoice: typeof import("@/lib/invoice/server").generateAndStoreInvoice;
  let invoiceSecretsFromEnv: typeof import("@/lib/invoice/server").invoiceSecretsFromEnv;
  try {
    ({ generateAndStoreInvoice, invoiceSecretsFromEnv } = await import(
      "@/lib/invoice/server"
    ));
  } catch (err) {
    throw Object.assign(
      new Error(
        `Invoice generator failed to load: ${String((err as Error)?.message || err)}`,
      ),
      { status: 503 },
    );
  }

  let db = null;
  try {
    db = getAdminDb();
  } catch (err) {
    console.info("[Invoice API] Admin Firestore unavailable; generating PDF without Admin writes", {
      message: String((err as Error)?.message || err).slice(0, 160),
    });
  }

  const result = await generateAndStoreInvoice(db, {
    bookingId,
    booking,
    existingInvoice,
    idToken: access.idToken,
    force,
    sendEmail: access.role === "admin" ? body.sendEmail !== false : true,
    secrets: invoiceSecretsFromEnv(),
  });
  console.info("[Invoice API] Invoice generation completed", {
    bookingId,
    pdfUrl: result.pdfUrl || "",
    publicId: result.publicId || result.fileKey || "",
    reused: Boolean(result.reused),
  });

  return jsonWithCors(req, { ...result, ok: true, success: true });
}
