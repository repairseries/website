import { NextRequest } from "next/server";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import {
  calculateCartPricing,
  calculateTransactionFinance,
  resolveFinancialSettings,
} from "@/lib/server/finance";
import { resolveCatalogServicePriceFromData } from "@/lib/server/finance/catalogPrice";
import { evaluateCouponData } from "@/lib/server/finance/loadCoupon";
import {
  getDocumentWithUserToken,
  queryFirstByCodeWithUserToken,
} from "@/lib/server/userFirestore";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

/**
 * Optional diagnostic endpoint. Customer Website and User App calculate
 * convenience fee locally and must not call this for checkout.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    if (caller.role === "internal") {
      throw Object.assign(new Error("Not allowed"), { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      items?: Array<{ lineId?: string; serviceId?: string; variationId?: string; quantity?: unknown }>;
      serviceId?: string;
      variationId?: string;
      quantity?: unknown;
      serviceAmount?: unknown;
      addedServicesAmount?: unknown;
      sparePartsAmount?: unknown;
      discountAmount?: unknown;
      couponCode?: string;
      spareParts?: Array<{ title?: string; quantity?: number; rate?: number; amount?: number }>;
    };

    const header = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const idToken = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim() || "";
    if (!idToken) {
      throw Object.assign(new Error("Sign in required"), { status: 401, code: "UNAUTHENTICATED" });
    }

    console.info("[Checkout] loading catalog with user token", {
      uid: caller.uid,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "repair-series",
    });
    const [general, invoice] = await Promise.all([
      getDocumentWithUserToken(idToken, "settings/general"),
      getDocumentWithUserToken(idToken, "settings/invoice"),
    ]);
    const settings = resolveFinancialSettings(general || {}, invoice || {}, {
      financeFormulaVersion: "v3",
    });

    type RequestLine = { lineId?: string; serviceId?: string; variationId?: string; quantity?: unknown };
    const requestLines: RequestLine[] =
      Array.isArray(body.items) && body.items.length > 0
        ? body.items.slice(0, 50)
        : [{ serviceId: body.serviceId, variationId: body.variationId, quantity: body.quantity }];

    const serviceDocs = new Map<string, Record<string, unknown>>();
    const pricedLines: Array<{
      lineId?: string;
      variationId: string;
      categoryId: string;
      catalog: ReturnType<typeof resolveCatalogServicePriceFromData> | null;
      unitPrice: number;
      quantity: number;
    }> = [];
    for (const line of requestLines) {
      const serviceId = String(line?.serviceId || "").trim();
      const variationId = String(line?.variationId || "").trim();
      if (serviceId) {
        if (!serviceDocs.has(serviceId)) {
          const doc = await getDocumentWithUserToken(idToken, `services/${serviceId}`);
          if (!doc) throw Object.assign(new Error("Service not found"), { status: 404 });
          serviceDocs.set(serviceId, doc);
        }
        const doc = serviceDocs.get(serviceId)!;
        const catalog = resolveCatalogServicePriceFromData(serviceId, doc, {
          variationId,
          quantity: line.quantity,
        });
        pricedLines.push({
          lineId: line.lineId ? String(line.lineId) : undefined,
          variationId,
          categoryId: String(doc.categoryId ?? doc.category_id ?? "").trim(),
          catalog,
          unitPrice: catalog.unitPrice,
          quantity: catalog.quantity,
        });
      } else if (caller.role === "admin" && requestLines.length === 1) {
        const serviceAmount = Number(body.serviceAmount || 0);
        if (!Number.isFinite(serviceAmount) || serviceAmount < 0) {
          throw Object.assign(new Error("Invalid service amount"), { status: 400 });
        }
        pricedLines.push({ variationId, categoryId: "", catalog: null, unitPrice: serviceAmount, quantity: 1 });
      } else {
        throw Object.assign(new Error("serviceId is required"), { status: 400 });
      }
    }

    const cart = calculateCartPricing(
      pricedLines.map((l) => ({
        lineId: l.lineId,
        categoryId: l.categoryId,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
      })),
    );

    const addedServicesAmount = Math.max(0, Number(body.addedServicesAmount || 0) || 0);
    const sparePartsAmount = Math.max(0, Number(body.sparePartsAmount || 0) || 0);

    // Existing coupon rule: applied to the first booking's service + convenience fee.
    let coupon = null;
    const couponCode = String(body.couponCode || "").trim();
    if (couponCode) {
      const first = cart.lines[0];
      const checkoutSubtotal = (first?.serviceAmount || 0) + (first?.convenienceFee || 0);
      const couponDoc =
        (await queryFirstByCodeWithUserToken(idToken, "coupons", couponCode.toUpperCase())) ||
        (await queryFirstByCodeWithUserToken(idToken, "offers", couponCode.toUpperCase()));
      coupon = evaluateCouponData(couponCode.toUpperCase(), couponDoc, checkoutSubtotal);
      if (!coupon.valid) {
        return jsonWithCors(req, { ok: false, error: coupon.message, coupon }, { status: 400 });
      }
    }

    const spareParts = Array.isArray(body.spareParts)
      ? body.spareParts.map((p) => ({
          title: String(p.title || "Spare part"),
          quantity: Number(p.quantity) || 1,
          rate: Number(p.rate) || 0,
          amount: Number(p.amount) || 0,
        }))
      : [];

    const lineSnaps = cart.lines.map((priced, i) =>
      calculateTransactionFinance({
        formulaVersion: "v3",
        serviceAmount: priced.serviceAmount,
        customerConvenienceFee: priced.convenienceFee,
        visitingCharge: priced.visitingCharge,
        addedServicesAmount: i === 0 ? addedServicesAmount : 0,
        sparePartsAmount: i === 0 ? sparePartsAmount : 0,
        discountAmount: i === 0 ? (coupon ? undefined : body.discountAmount) : undefined,
        coupon: i === 0 ? coupon : null,
        platformFeePercent: settings.serviceCommissionPercent,
        addonFeePercent: settings.additionalServiceCommissionPercent,
        sparePartCommissionPercent: settings.sparePartCommissionPercent,
        gstPercent: 0,
        spareParts: i === 0 ? spareParts : [],
      }),
    );

    const sum = (pick: (s: (typeof lineSnaps)[number]) => number) =>
      Math.round(lineSnaps.reduce((acc, s) => acc + Math.round(pick(s) * 100), 0)) / 100;
    const snap = lineSnaps[0];

    const customerView = (s: typeof snap) => ({
      serviceAmount: s.serviceAmount,
      serviceSubtotal: s.serviceAmount,
      serviceCharges: s.serviceAmount,
      customerConvenienceFee: s.convenienceFee,
      convenienceAndPlatformFee: s.convenienceFee,
      platformFee: s.convenienceFee,
      visitingCharge: s.visitingCharge,
      additionalServiceValue: s.addedServicesAmount,
      sparePartValue: s.sparePartValue,
      discount: s.discount,
      discountOnService: s.discountOnService,
      discountOnCompanyFee: s.discountOnCompanyFee,
      gstAmount: 0,
      taxAmount: 0,
      totalTax: 0,
      totalGst: 0,
      customerTotal: s.finalAmount,
      finalPayable: s.finalAmount,
    });

    return jsonWithCors(req, {
      ok: true,
      formulaVersion: "v3",
      catalog: pricedLines[0]?.catalog ?? null,
      settings: {
        gstEnabled: false,
        gstPercent: 0,
        serviceCommissionPercent: settings.serviceCommissionPercent,
        additionalServiceCommissionPercent: settings.additionalServiceCommissionPercent,
        sparePartCommissionPercent: settings.sparePartCommissionPercent,
      },
      cart: {
        serviceAmount: cart.serviceAmount,
        categoryBreakdown: cart.categoryBreakdown,
        customerConvenienceFee: cart.customerConvenienceFee,
        visitingCharge: cart.visitingCharge,
        discount: sum((s) => s.discount),
        gstAmount: 0,
        taxAmount: 0,
        customerTotal: sum((s) => s.finalAmount),
      },
      customer: {
        ...customerView(snap),
        serviceAmount: sum((s) => s.serviceAmount),
        serviceSubtotal: sum((s) => s.serviceAmount),
        serviceCharges: sum((s) => s.serviceAmount),
        customerConvenienceFee: sum((s) => s.convenienceFee),
        convenienceAndPlatformFee: sum((s) => s.convenienceFee),
        platformFee: sum((s) => s.convenienceFee),
        visitingCharge: sum((s) => s.visitingCharge),
        discount: sum((s) => s.discount),
        customerTotal: sum((s) => s.finalAmount),
        finalPayable: sum((s) => s.finalAmount),
      },
      lines: lineSnaps.map((s, i) => ({
        lineId: pricedLines[i].lineId,
        serviceId: pricedLines[i].catalog?.serviceId,
        variationId: pricedLines[i].variationId,
        categoryId: cart.lines[i].categoryId,
        quantity: cart.lines[i].quantity,
        convenienceRate: cart.lines[i].convenienceRate,
        customer: customerView(s),
        snapshot: s,
      })),
      partner: {
        serviceValue: sum((s) => s.serviceAmount),
        serviceCompanyCommission: sum((s) => s.platformFeeAmount),
        servicePartnerEarning: sum((s) => s.technicianServiceEarning),
        totalPartnerEarning: sum((s) => s.technicianFinalEarning),
      },
      company: {
        convenienceFeeRevenue: sum((s) => s.convenienceFee),
        visitingChargeRevenue: sum((s) => s.visitingCharge),
        serviceCommissionRevenue: sum((s) => s.platformFeeAmount),
        totalCompanyRevenue: sum((s) => s.companyEarnings),
      },
      invoicePageCount: snap.invoicePageCount,
      snapshot: snap,
    });
  } catch (err) {
    const raw = String((err as Error)?.message || "");
    const adminAuthFailure = /16\s*UNAUTHENTICATED|OAuth 2 access token|invalid authentication credentials/i.test(
      raw,
    );
    const status = adminAuthFailure
      ? 503
      : Number((err as { status?: number })?.status || 500);
    const message = adminAuthFailure
      ? "Server authentication is not configured"
      : publicErrorMessage(err, "Could not calculate checkout");
    console.info("[Checkout] failed", {
      status,
      code: String((err as { code?: string }).code || ""),
      message: message.slice(0, 160),
    });
    if (status >= 500) console.error("api/checkout/calculate", message);
    return jsonWithCors(req, { error: message }, { status });
  }
}
