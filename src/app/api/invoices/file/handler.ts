import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  assertBookingAccess,
  requireInvoiceCaller,
} from "@/lib/invoice/server/auth";
import { invoiceDocId } from "@/lib/server/finance";
import { apiCorsHeaders, jsonWithCors } from "@/lib/api/cors";
import { isCloudinaryUrl } from "@/lib/storage/keys";
import { fetchCloudinaryPdf } from "@/lib/storage/invoicePdf";

export async function handleInvoiceFileGet(req: NextRequest) {
  const access = await requireInvoiceCaller(req);
  const bookingId = String(
    req.nextUrl.searchParams.get("bookingId") || "",
  ).trim();
  if (!bookingId) {
    return jsonWithCors(req, { error: "Missing bookingId" }, { status: 400 });
  }

  const db = getAdminDb();
  const bookingSnap = await db.doc(`bookings/${bookingId}`).get();
  if (!bookingSnap.exists) {
    return jsonWithCors(req, { error: "Booking not found" }, { status: 404 });
  }
  const booking = (bookingSnap.data() || {}) as Record<string, unknown>;
  await assertBookingAccess(access, booking);

  const invoiceId = String(booking.invoiceId || invoiceDocId(bookingId));
  const invoiceSnap = await db.doc(`invoices/${invoiceId}`).get();
  const invoice = invoiceSnap.exists
    ? ((invoiceSnap.data() || {}) as Record<string, unknown>)
    : {};

  const storedUrl = String(
    invoice.pdfUrl || invoice.invoicePdfUrl || booking.invoicePdfUrl || "",
  ).trim();
  if (isCloudinaryUrl(storedUrl)) {
    const fetched = await fetchCloudinaryPdf(storedUrl);
    if (fetched) {
          return new NextResponse(new Uint8Array(fetched), {
        status: 200,
        headers: {
          ...apiCorsHeaders(req),
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${encodeURIComponent(String(invoice.invoiceNumber || bookingId))}.pdf"`,
          "Cache-Control": "private, max-age=60",
        },
      });
    }
    return jsonWithCors(req, { error: "Invoice PDF could not be delivered" }, { status: 502 });
  }

  return jsonWithCors(req, { error: "Invoice PDF is not ready yet" }, { status: 404 });
}
