import { isCloudinaryUrl } from "./keys";

export function hasStoredInvoiceFile(
  invoice: Record<string, unknown> | null | undefined,
): boolean {
  const row = invoice || {};
  const storedUrl = String(row.pdfUrl || row.invoicePdfUrl || "").trim();
  return isCloudinaryUrl(storedUrl);
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
  return null;
}

export async function downloadInvoicePdfFromRecord(
  invoice: Record<string, unknown> | null | undefined,
): Promise<Buffer | null> {
  const row = invoice || {};
  const storedUrl = String(row.pdfUrl || row.invoicePdfUrl || "").trim();
  if (isCloudinaryUrl(storedUrl)) {
    return fetchCloudinaryPdf(storedUrl);
  }
  return null;
}
