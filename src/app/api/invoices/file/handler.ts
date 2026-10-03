import { NextRequest, NextResponse } from "next/server";
import {
  assertBookingAccess,
  loadBookingForInvoice,
  loadInvoiceRecordForBooking,
  requireInvoiceCaller,
} from "@/lib/invoice/server/auth";
import { invoiceDocId } from "@/lib/server/finance";
import { apiCorsHeaders, jsonWithCors } from "@/lib/api/cors";
import { fetchCloudinaryPdf, pickStoredCloudinaryInvoiceUrl } from "@/lib/storage/invoicePdf";

export async function handleInvoiceFileGet(req: NextRequest) {
  const access = await requireInvoiceCaller(req);
  const bookingId = String(req.nextUrl.searchParams.get("bookingId") || "").trim();
  if (!bookingId) {
    return jsonWithCors(req, { error: "Missing bookingId" }, { status: 400 });
  }

  const booking = await loadBookingForInvoice(access, bookingId);
  await assertBookingAccess(access, booking);

  const invoiceId = String(booking.invoiceId || invoiceDocId(bookingId));
  const invoice = await loadInvoiceRecordForBooking(access, invoiceId);
  const pdfUrl = pickStoredCloudinaryInvoiceUrl(booking, invoice);
  if (!pdfUrl) {
    return jsonWithCors(req, { error: "Invoice PDF is not ready yet" }, { status: 404 });
  }

  const accept = String(req.headers.get("accept") || "");
  if (accept.includes("application/json") || req.nextUrl.searchParams.get("format") === "json") {
    return jsonWithCors(req, { ok: true, pdfUrl, invoicePdfUrl: pdfUrl });
  }

  if (req.nextUrl.searchParams.get("proxy") === "1") {
    const fetched = await fetchCloudinaryPdf(pdfUrl);
    if (fetched) {
      return new NextResponse(new Uint8Array(fetched), {
        status: 200,
        headers: {
          ...apiCorsHeaders(req),
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${encodeURIComponent(String(invoice?.invoiceNumber || booking.invoiceNumber || bookingId))}.pdf"`,
          "Cache-Control": "private, max-age=60",
        },
      });
    }
    return jsonWithCors(req, { error: "Invoice PDF could not be delivered" }, { status: 502 });
  }

  return NextResponse.redirect(pdfUrl, {
    status: 302,
    headers: apiCorsHeaders(req),
  });
}
