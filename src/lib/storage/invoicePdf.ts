import { isCloudinaryUrl } from "./keys";
import { downloadCloudinaryPdfAuthenticated } from "./cloudinary";

export function pickStoredCloudinaryInvoiceUrl(
  ...sources: Array<Record<string, unknown> | null | undefined>
): string {
  for (const source of sources) {
    if (!source) continue;
    const nested =
      source.invoice && typeof source.invoice === "object"
        ? (source.invoice as Record<string, unknown>)
        : null;
    const candidates = [
      source.pdfUrl,
      source.invoicePdfUrl,
      source.secure_url,
      nested?.pdfUrl,
      nested?.url,
      source.invoicePDF,
    ];
    for (const candidate of candidates) {
      const url = String(candidate || "").trim();
      if (isCloudinaryUrl(url)) return url;
    }
  }
  return "";
}

export function hasStoredInvoiceFile(
  invoice: Record<string, unknown> | null | undefined,
): boolean {
  return Boolean(pickStoredCloudinaryInvoiceUrl(invoice));
}

export function alternateCloudinaryPdfUrls(url: string): string[] {
  const primary = String(url || "").trim();
  if (!primary) return [];
  const out = [primary];
  if (primary.includes("/raw/upload/")) {
    out.push(primary.replace("/raw/upload/", "/image/upload/"));
  }
  if (primary.includes("/image/upload/")) {
    out.push(primary.replace("/image/upload/", "/raw/upload/"));
  }
  return [...new Set(out)];
}

export async function fetchCloudinaryPdf(url: string): Promise<Buffer | null> {
  for (const candidate of alternateCloudinaryPdfUrls(url)) {
    try {
      const res = await fetch(candidate);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 8) return buf;
    } catch {
      /* try next candidate */
    }
  }
  return downloadCloudinaryPdfAuthenticated(url);
}

export async function downloadInvoicePdfFromRecord(
  invoice: Record<string, unknown> | null | undefined,
): Promise<Buffer | null> {
  const storedUrl = pickStoredCloudinaryInvoiceUrl(invoice);
  if (storedUrl) return fetchCloudinaryPdf(storedUrl);
  return null;
}
