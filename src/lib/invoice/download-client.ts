"use client";

export async function downloadOwnInvoicePdf(options: {
  bookingId: string;
  token: string;
  fileName?: string;
  pdfUrl?: string;
}) {
  const bookingId = String(options.bookingId || "").trim();
  if (!bookingId) throw new Error("Missing bookingId");
  if (!options.token) throw new Error("Sign in required");

  const stored = String(options.pdfUrl || "").trim();
  if (/res\.cloudinary\.com/i.test(stored)) {
    window.open(stored, "_blank", "noopener,noreferrer");
    return;
  }

  const response = await fetch(
    `/api/invoices/file?bookingId=${encodeURIComponent(bookingId)}&format=json`,
    { headers: { Authorization: `Bearer ${options.token}`, Accept: "application/json" } },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    pdfUrl?: string;
    invoicePdfUrl?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Could not download invoice");
  }
  const pdfUrl = String(payload.pdfUrl || payload.invoicePdfUrl || "").trim();
  if (/res\.cloudinary\.com/i.test(pdfUrl)) {
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
    return;
  }
  throw new Error("Invoice PDF is not ready yet");
}
