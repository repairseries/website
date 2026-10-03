import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickStoredCloudinaryInvoiceUrl } from "./invoicePdf";
import { isCloudinaryUrl, invoiceAccessUrl } from "./keys";
import { adminCredentialFailure } from "../server/auth";

describe("invoice Cloudinary URL selection", () => {
  it("uses the stored Cloudinary delivery URL", () => {
    assert.equal(
      pickStoredCloudinaryInvoiceUrl({
        invoicePdfUrl: "https://res.cloudinary.com/demo/raw/upload/invoices/a.pdf",
      }),
      "https://res.cloudinary.com/demo/raw/upload/invoices/a.pdf",
    );
  });

  it("ignores the Admin-backed /api/invoices/file access URL", () => {
    const access = invoiceAccessUrl("booking123");
    assert.equal(isCloudinaryUrl(access), false);
    assert.equal(
      pickStoredCloudinaryInvoiceUrl({
        invoicePdfUrl: access,
        accessUrl: access,
        pdfUrl: "https://res.cloudinary.com/demo/image/upload/inv.pdf",
      }),
      "https://res.cloudinary.com/demo/image/upload/inv.pdf",
    );
  });

  it("does not treat empty or Drive URLs as an invoice PDF", () => {
    assert.equal(pickStoredCloudinaryInvoiceUrl({ invoicePdfUrl: "" }), "");
    assert.equal(
      pickStoredCloudinaryInvoiceUrl({
        invoicePdfUrl: "https://drive.google.com/file/d/abc",
      }),
      "",
    );
  });
});

describe("invoice Admin credential errors", () => {
  it("classifies 16 UNAUTHENTICATED OAuth errors as Admin credential failure", () => {
    const err = new Error(
      "16 UNAUTHENTICATED: Request had invalid authentication credentials. Expected OAuth 2 access token.",
    );
    assert.equal(adminCredentialFailure(err), true);
  });
});
