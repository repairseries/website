import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { assembleInvoiceData, shouldGenerateInvoice } from "./assembleInvoice";
import {
  invoiceDocId,
  shouldSendInvoiceEmail,
  financeFromBooking,
  type FinanceSnapshot,
} from "@/lib/server/finance";
import {
  DOCUMENT_STORAGE_PROVIDER,
  buildInvoiceStoragePath,
  invoiceAccessUrl,
  isCloudinaryUrl,
} from "@/lib/storage/keys";
import { isCloudinaryConfigured, uploadPdfToCloudinary } from "@/lib/storage/cloudinary";
import { downloadInvoicePdfFromRecord, hasStoredInvoiceFile } from "@/lib/storage/invoicePdf";
import { validatePdfBuffer } from "@/lib/storage/validate";

/* eslint-disable @typescript-eslint/no-require-imports */
const { renderInvoicePdf } = require("./renderPdf") as {
  renderInvoicePdf: (invoice: Record<string, unknown>) => Promise<Buffer & { pageCount?: number }>;
};
const { sendInvoiceEmail } = require("./sendEmail") as {
  sendInvoiceEmail: (args: {
    invoice: Record<string, unknown>;
    pdfBuffer: Buffer;
    config: Record<string, unknown>;
  }) => Promise<{ skipped?: boolean; reason?: string; id?: string | null }>;
};

function storedCloudinaryUrl(invoice: Record<string, unknown> | null | undefined): string {
  const stored = String(invoice?.pdfUrl || invoice?.invoicePdfUrl || "").trim();
  return isCloudinaryUrl(stored) ? stored : "";
}

/** Old 2-page / tax / partner invoices must be regenerated — do not reuse them. */
function isCurrentCompanyInvoiceFormat(
  invoice: Record<string, unknown> | null | undefined,
): boolean {
  if (!invoice) return false;
  const pages = Number(invoice.pageCount ?? invoice.invoicePageCount ?? 1);
  if (Number.isFinite(pages) && pages > 1) return false;
  const commercial = invoice.commercial as { lines?: unknown } | undefined;
  if (!commercial || !Array.isArray(commercial.lines)) return false;
  if (Number(invoice.gstAmount || 0) > 0) return false;
  const lineTitles = [
    ...(Array.isArray(invoice.lines) ? invoice.lines : []),
    ...commercial.lines,
  ].map((row) =>
    String(
      (row as { title?: unknown; label?: unknown })?.title ??
        (row as { label?: unknown })?.label ??
        "",
    ),
  );
  return !lineTitles.some((title) =>
    /gst|cgst|sgst|igst|taxable|tax amount|tax invoice|partner invoice/i.test(title),
  );
}

function stripInvoiceGst(finance: FinanceSnapshot): FinanceSnapshot {
  const zeroPage = (page: FinanceSnapshot["page1"] | null | undefined) => {
    if (!page) return page ?? null;
    return {
      ...page,
      taxableValue: 0,
      cgstPercent: 0,
      sgstPercent: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      gstAmount: 0,
    };
  };
  return {
    ...finance,
    gstEnabled: false,
    gstPercent: 0,
    gstTaxableBase: "none",
    taxableCompanyFee: 0,
    taxableValue: 0,
    gstAmount: 0,
    gstCollectedOnCompanyFee: 0,
    serviceGstAmount: 0,
    additionalServiceGstAmount: 0,
    sparePartGstAmount: 0,
    cgstPercent: 0,
    sgstPercent: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    invoicePageCount: 1,
    page1: zeroPage(finance.page1) as FinanceSnapshot["page1"],
    page2: zeroPage(finance.page2) as FinanceSnapshot["page2"],
    page3: null,
  };
}

async function recordInvoiceJob(
  db: Firestore,
  bookingId: string,
  patch: {
    status: "issued" | "failed";
    lastError?: string | null;
    cloudinaryPublicId?: string | null;
  },
) {
  const bookingRef = db.doc(`bookings/${bookingId}`);
  const snap = await bookingRef.get();
  const prev = (snap.data()?.invoiceJob || {}) as Record<string, unknown>;
  const attempts = Number(prev.attemptCount || 0) + 1;
  await bookingRef.set(
    {
      invoiceJob: {
        operationType: "generate",
        status: patch.status,
        attemptCount: attempts,
        lastError: patch.status === "failed" ? String(patch.lastError || "").slice(0, 500) : null,
        cloudinaryPublicId: patch.cloudinaryPublicId || prev.cloudinaryPublicId || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function generateAndStoreInvoiceInner(
  db: Firestore,
  options: {
    bookingId: string;
    booking?: Record<string, unknown>;
    force?: boolean;
    sendEmail?: boolean;
    secrets?: {
      resend?: Record<string, string>;
    };
  },
) {
  const bookingId = String(options.bookingId || "").trim();
  if (!bookingId) throw new Error("bookingId is required");

  const bookingRef = db.doc(`bookings/${bookingId}`);
  const bookingSnap = options.booking ? null : await bookingRef.get();
  const booking =
    options.booking ||
    (bookingSnap?.exists ? (bookingSnap.data() as Record<string, unknown>) : null);
  if (!booking) throw new Error("Booking not found");

  const invoiceId = invoiceDocId(bookingId);
  const invoiceRef = db.doc(`invoices/${invoiceId}`);
  const existingSnap = await invoiceRef.get();
  const existing = existingSnap.exists
    ? (existingSnap.data() as Record<string, unknown>)
    : null;
  const accessUrl = invoiceAccessUrl(bookingId);
  const existingPdfUrl = storedCloudinaryUrl(existing);

  if (
    hasStoredInvoiceFile(existing) &&
    existingPdfUrl &&
    !options.force &&
    isCurrentCompanyInvoiceFormat(existing)
  ) {
    if (!booking.invoicePdfUrl || !booking.invoiceId) {
      await bookingRef.set(
        {
          invoiceId,
          invoiceNumber: existing?.invoiceNumber || "",
          invoicePdfUrl: existingPdfUrl,
          invoiceStatus: existing?.status || "issued",
          invoiceCreatedAt: existing?.createdAt || FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    let emailResult: Record<string, unknown> = {
      skipped: true,
      reason: "already_exists",
    };
    if (options.sendEmail !== false && shouldSendInvoiceEmail(existing)) {
      const pdfBuffer = await downloadInvoicePdfFromRecord(existing);
      if (pdfBuffer) {
        try {
          const sent = await sendInvoiceEmail({
            invoice: { ...existing, pdfUrl: existingPdfUrl },
            pdfBuffer,
            config: options.secrets?.resend || {},
          });
          emailResult = sent as Record<string, unknown>;
          const now = FieldValue.serverTimestamp();
          await invoiceRef.set(
            {
              emailSentAt: sent.skipped ? existing?.emailSentAt || null : now,
              emailStatus: sent.skipped ? sent.reason || "skipped" : "sent",
              emailSkipReason: sent.skipped ? sent.reason || null : null,
              emailId: sent.id || null,
              invoiceEmailStatus: sent.skipped ? "failed" : "sent",
              invoiceEmailSentAt: sent.skipped ? null : now,
              updatedAt: now,
            },
            { merge: true },
          );
        } catch (err) {
          emailResult = { skipped: false, error: String((err as Error)?.message || err) };
          await invoiceRef.set(
            {
              emailStatus: "failed",
              invoiceEmailStatus: "failed",
              emailError: emailResult.error,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
      }
    }

    return {
      ok: true,
      success: true,
      reused: true,
      invoiceId,
      invoiceNumber: existing?.invoiceNumber || "",
      pdfUrl: existingPdfUrl,
      invoicePdfUrl: existingPdfUrl,
      publicId: String(existing?.cloudinaryPublicId || existing?.fileKey || existing?.pdfFileKey || "") || null,
      fileKey: String(existing?.cloudinaryPublicId || existing?.fileKey || existing?.pdfFileKey || "") || null,
      storageProvider: existing?.storageProvider || DOCUMENT_STORAGE_PROVIDER,
      accessUrl,
      email: emailResult,
    };
  }

  if (!isCloudinaryConfigured()) {
    throw Object.assign(
      new Error("Cloudinary is not configured for invoice storage"),
      { status: 503 },
    );
  }

  const [settingsSnap, generalSnap, techSnap] = await Promise.all([
    db.doc("settings/invoice").get(),
    db.doc("settings/general").get(),
    booking.technicianId
      ? db.doc(`technicians/${String(booking.technicianId)}`).get()
      : Promise.resolve(null),
  ]);
  const settingsRaw = settingsSnap.exists
    ? (settingsSnap.data() as Record<string, unknown>)
    : {};
  const settingsGeneral = generalSnap.exists
    ? (generalSnap.data() as Record<string, unknown>)
    : {};
  const technician =
    techSnap && "exists" in techSnap && techSnap.exists
      ? (techSnap.data() as Record<string, unknown>)
      : null;

  const finance = stripInvoiceGst(
    financeFromBooking({
      booking,
      settingsGeneral,
      settingsInvoice: {
        gstEnabled: false,
        gstPercent: 0,
      },
    }),
  );

  const invoiceData = assembleInvoiceData({
    booking,
    bookingId,
    settingsRaw,
    technician,
    finance,
    forceInvoiceNumber:
      options.force && existing?.invoiceNumber
        ? String(existing.invoiceNumber)
        : undefined,
  });

  const pdfBuffer = await renderInvoicePdf(invoiceData as unknown as Record<string, unknown>);
  validatePdfBuffer(pdfBuffer);

  const storagePath = buildInvoiceStoragePath({
    invoiceNumber: invoiceData.invoiceNumber,
    bookingId,
  });
  let uploaded: Awaited<ReturnType<typeof uploadPdfToCloudinary>>;
  try {
    uploaded = await uploadPdfToCloudinary({
      body: pdfBuffer,
      folder: storagePath.folder,
      publicId: storagePath.publicId,
      fileName: storagePath.fileName,
    });
  } catch (err) {
    throw Object.assign(
      new Error(
        `Invoice PDF was generated but Cloudinary upload failed: ${
          (err as Error)?.message || err
        }`,
      ),
      { status: 502 },
    );
  }

  const now = FieldValue.serverTimestamp();
  const customerId = invoiceData.customerId;
  const partnerId = invoiceData.technicianId;
  const pdfUrl = uploaded.url;
  const persistWarning: string[] = [];
  const firestoreInvoice: Record<string, unknown> = {
    bookingId,
    bookingCode: invoiceData.bookingCode,
    invoiceNumber: invoiceData.invoiceNumber,
    customerId,
    technicianId: partnerId,
    partnerId,
    customerName: invoiceData.customerName,
    customerPhone: invoiceData.customerPhone,
    customerEmail: invoiceData.customerEmail,
    customerAddress: invoiceData.customerAddress,
    serviceName: invoiceData.serviceName,
    technicianName: invoiceData.technicianName,
    partnerName: invoiceData.partnerName,
    partnerAddress: invoiceData.partnerAddress,
    partnerState: invoiceData.partnerState,
    partnerGstin: "",
    bookingDate: invoiceData.bookingDate,
    serviceDate: invoiceData.serviceDate,
    invoiceDate: invoiceData.invoiceDate,
    paymentDate: invoiceData.paymentDate,
    paymentMethod: invoiceData.paymentMethod,
    paymentStatus: invoiceData.paymentStatus,
    paymentId: invoiceData.paymentId,
    finance,
    commercial: invoiceData.commercial,
    lines: invoiceData.lines,
    subtotal: invoiceData.subtotal,
    discount: 0,
    gstPercent: 0,
    gstAmount: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    grandTotal: invoiceData.grandTotal,
    amountInWords: invoiceData.amountInWords,
    currency: "INR",
    isRevisit: invoiceData.isRevisit,
    status: "issued",
    invoiceStatus: "issued",
    source: "vercel_api",
    storageProvider: DOCUMENT_STORAGE_PROVIDER,
    companyName: invoiceData.companyName,
    companyAddress: invoiceData.companyAddress,
    companyPhone: invoiceData.companyPhone,
    companyEmail: invoiceData.companyEmail,
    companyWebsite: invoiceData.companyWebsite,
    udyamNumber: invoiceData.udyamNumber,
    gstin: invoiceData.gstin,
    gstNumber: invoiceData.gstin,
    upiId: invoiceData.upiId,
    terms: invoiceData.terms,
    thankYouMessage: invoiceData.thankYouMessage,
    logoUrl: invoiceData.logoUrl,
    signatureUrl: invoiceData.signatureUrl,
    pdfUrl,
    invoicePdfUrl: pdfUrl,
    pdfFileKey: uploaded.publicId,
    fileKey: uploaded.publicId,
    cloudinaryPublicId: uploaded.publicId,
    pdfBytes: uploaded.bytes,
    fileName: storagePath.fileName,
    mimeType: "application/pdf",
    pageCount: 1,
    generatedAt: now,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    invoiceEmailStatus: "pending",
    ...(options.force ? { regeneratedAt: now } : {}),
  };

  try {
    await invoiceRef.set(firestoreInvoice, { merge: true });
  } catch (err) {
    persistWarning.push(`invoice_doc:${String((err as Error)?.message || err)}`);
  }
  try {
    await bookingRef.set(
      {
        invoiceId,
        invoiceNumber: invoiceData.invoiceNumber,
        invoicePdfUrl: pdfUrl,
        invoiceStatus: "issued",
        invoiceCreatedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  } catch (err) {
    persistWarning.push(`booking_doc:${String((err as Error)?.message || err)}`);
  }

  try {
    const { sendBookingNotification } = await import("@/lib/notifications/send");
    await sendBookingNotification({
      eventType: "invoice_generated",
      bookingId,
      audience: "customer",
      title: "Invoice ready",
      body: `Your invoice ${invoiceData.invoiceNumber || ""} is ready.`,
    });
  } catch {
    /* invoice exists even if notify fails */
  }

  const invoiceForEmail = { ...invoiceData, pdfUrl };
  let emailResult: Record<string, unknown> = { skipped: true, reason: "send_disabled" };
  if (options.sendEmail !== false && shouldSendInvoiceEmail(existing)) {
    try {
      emailResult = (await sendInvoiceEmail({
        invoice: invoiceForEmail,
        pdfBuffer,
        config: options.secrets?.resend || {},
      })) as Record<string, unknown>;
      await invoiceRef.set(
        {
          emailSentAt: emailResult.skipped ? null : now,
          emailStatus: emailResult.skipped ? "skipped" : "sent",
          emailSkipReason: emailResult.skipped ? emailResult.reason || null : null,
          emailId: emailResult.id || null,
          invoiceEmailStatus: emailResult.skipped ? "failed" : "sent",
          invoiceEmailSentAt: emailResult.skipped ? null : now,
          updatedAt: now,
        },
        { merge: true },
      ).catch(() => {});
    } catch (err) {
      emailResult = { skipped: true, error: String((err as Error)?.message || err) };
    }
  }

  return {
    ok: true,
    success: true,
    reused: false,
    invoiceId,
    invoiceNumber: invoiceData.invoiceNumber,
    pdfUrl,
    invoicePdfUrl: pdfUrl,
    publicId: uploaded.publicId,
    fileKey: uploaded.publicId,
    storageProvider: DOCUMENT_STORAGE_PROVIDER,
    accessUrl,
    pageCount: 1,
    email: emailResult,
    ...(persistWarning.length ? { persistWarning: persistWarning.join("; ") } : {}),
  };
}

export async function generateAndStoreInvoice(
  db: Firestore,
  options: {
    bookingId: string;
    booking?: Record<string, unknown>;
    force?: boolean;
    sendEmail?: boolean;
    secrets?: {
      resend?: Record<string, string>;
    };
  },
) {
  const bookingId = String(options.bookingId || "").trim();
  try {
    const result = await generateAndStoreInvoiceInner(db, options);
    if (bookingId) {
      await recordInvoiceJob(db, bookingId, {
        status: "issued",
        cloudinaryPublicId: String(result.fileKey || "") || null,
      }).catch(() => {});
    }
    return result;
  } catch (err) {
    if (bookingId) {
      await recordInvoiceJob(db, bookingId, {
        status: "failed",
        lastError: String((err as Error)?.message || err),
      }).catch(() => {});
    }
    throw err;
  }
}

export { shouldGenerateInvoice };
