import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { financeFromBooking } from "@/lib/server/finance/fromBooking";
import { bookingPayableAmount } from "@/lib/payments/bookingAmount";

export type WalletLedgerType =
  | "PARTNER_EARNING"
  | "COMPANY_SHARE_DEBIT"
  | "SETTLEMENT_CLEARING"
  | "APPROVED_ADJUSTMENT"
  | "REVERSAL";

export type WalletDirection = "CREDIT" | "DEBIT";

function rupeesToPaise(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100);
}

export function resolvePartnerIdFromBooking(booking: Record<string, unknown>): string {
  return String(
    booking.technicianId ||
      booking.assignedTechnicianId ||
      booking.partnerId ||
      "",
  ).trim();
}

export function computePaymentWalletAmounts(booking: Record<string, unknown>): {
  partnerEarningPaise: number;
  companySharePaise: number;
  customerTotalPaise: number;
} {
  const finance = financeFromBooking({ booking });
  const partnerEarningPaise = rupeesToPaise(finance.technicianFinalEarning);
  const customerTotalPaise = rupeesToPaise(bookingPayableAmount(booking));
  const companySharePaise = Math.max(0, customerTotalPaise - partnerEarningPaise);
  return { partnerEarningPaise, companySharePaise, customerTotalPaise };
}

function ledgerRef(db: Firestore, idempotencyKey: string) {
  return db.doc(`walletLedger/${idempotencyKey}`);
}

function walletSummaryRef(db: Firestore, partnerId: string) {
  return db.doc(`partnerWallets/${partnerId}`);
}

function applyBalanceDelta(currentPaise: number, direction: WalletDirection, amountPaise: number) {
  const amt = Math.max(0, Math.round(amountPaise));
  if (amt <= 0) return currentPaise;
  return direction === "CREDIT" ? currentPaise + amt : currentPaise - amt;
}

export type WalletPostInput = {
  partnerId: string;
  bookingId: string;
  method: "ONLINE" | "CASH";
  paymentEventKey: string;
  booking: Record<string, unknown>;
};

type PlannedEntry = {
  type: WalletLedgerType;
  direction: WalletDirection;
  amountPaise: number;
  sourceType: string;
  suffix: string;
};

function planWalletEntries(
  method: "ONLINE" | "CASH",
  partnerEarningPaise: number,
  companySharePaise: number,
): PlannedEntry[] {
  if (method === "ONLINE" && partnerEarningPaise > 0) {
    return [
      {
        type: "PARTNER_EARNING",
        direction: "CREDIT",
        amountPaise: partnerEarningPaise,
        sourceType: "ONLINE_PAYMENT",
        suffix: "earning",
      },
    ];
  }
  if (method === "CASH" && companySharePaise > 0) {
    return [
      {
        type: "COMPANY_SHARE_DEBIT",
        direction: "DEBIT",
        amountPaise: companySharePaise,
        sourceType: "CASH_COLLECTION",
        suffix: "company_share",
      },
    ];
  }
  return [];
}

/**
 * Idempotent wallet updates — call inside a Firestore transaction after reads complete.
 */
export async function postPartnerWalletInTransaction(
  db: Firestore,
  tx: Transaction,
  input: WalletPostInput,
): Promise<{ posted: boolean }> {
  const partnerId = String(input.partnerId || "").trim();
  if (!partnerId) return { posted: false };

  const { partnerEarningPaise, companySharePaise, customerTotalPaise } =
    computePaymentWalletAmounts(input.booking);
  const planned = planWalletEntries(input.method, partnerEarningPaise, companySharePaise);
  if (!planned.length) return { posted: false };

  const ledgerKeys = planned.map((e) => `wallet:${input.paymentEventKey}:${e.suffix}`);
  const ledgerSnaps = await Promise.all(ledgerKeys.map((k) => tx.get(ledgerRef(db, k))));
  const summaryRef = walletSummaryRef(db, partnerId);
  const summarySnap = await tx.get(summaryRef);

  let balancePaise = Number(summarySnap.data()?.balancePaise);
  if (!Number.isFinite(balancePaise)) balancePaise = 0;

  let posted = false;
  for (let i = 0; i < planned.length; i += 1) {
    if (ledgerSnaps[i]?.exists) continue;
    const entry = planned[i]!;
    const idempotencyKey = ledgerKeys[i]!;
    tx.set(ledgerRef(db, idempotencyKey), {
      transactionId: idempotencyKey,
      partnerId,
      bookingId: input.bookingId,
      type: entry.type,
      direction: entry.direction,
      amountPaise: entry.amountPaise,
      currency: "INR",
      status: "POSTED",
      sourceType: entry.sourceType,
      sourceId: input.paymentEventKey,
      idempotencyKey,
      createdAt: FieldValue.serverTimestamp(),
    });
    balancePaise = applyBalanceDelta(balancePaise, entry.direction, entry.amountPaise);
    posted = true;
  }

  if (posted) {
    tx.set(
      summaryRef,
      {
        partnerId,
        currency: "INR",
        balancePaise,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  if (input.method === "CASH" && companySharePaise > 0) {
    await upsertCashSettlementObligationInTransaction(db, tx, {
      partnerId,
      bookingId: input.bookingId,
      settlementDate: istDateKey(),
      cashCollectedPaise: customerTotalPaise,
      companyShareDuePaise: companySharePaise,
      paymentEventKey: input.paymentEventKey,
    });
  }

  return { posted };
}

export async function upsertCashSettlementObligationInTransaction(
  db: Firestore,
  tx: Transaction,
  input: {
    partnerId: string;
    bookingId: string;
    settlementDate: string;
    cashCollectedPaise: number;
    companyShareDuePaise: number;
    paymentEventKey: string;
  },
): Promise<void> {
  const partnerId = String(input.partnerId || "").trim();
  if (!partnerId || input.companyShareDuePaise <= 0) return;

  const obligationEventRef = db.doc(`paymentEvents/cash_obligation:${input.paymentEventKey}`);
  const obligationSnap = await tx.get(obligationEventRef);
  if (obligationSnap.exists) return;

  const settlementId = `${partnerId}_${input.settlementDate}`;
  const ref = db.doc(`cashSettlements/${settlementId}`);
  const snap = await tx.get(ref);
  const prev = snap.data() || {};
  const bookingIds = Array.isArray(prev.cashBookingIds) ? [...prev.cashBookingIds] : [];
  if (!bookingIds.includes(input.bookingId)) bookingIds.push(input.bookingId);

  const totalCash =
    Math.round(Number(prev.totalCashCollectedPaise) || 0) + input.cashCollectedPaise;
  const companyDue =
    Math.round(Number(prev.companyShareDuePaise) || 0) + input.companyShareDuePaise;
  const remitted = Math.round(Number(prev.amountRemittedPaise) || 0);
  const outstanding = Math.max(0, companyDue - remitted);

  tx.set(
    ref,
    {
      settlementId,
      partnerId,
      settlementDate: input.settlementDate,
      cashBookingIds: bookingIds,
      totalCashCollectedPaise: totalCash,
      companyShareDuePaise: companyDue,
      amountRemittedPaise: remitted,
      amountOutstandingPaise: outstanding,
      status: outstanding > 0 ? "PENDING" : "SETTLED",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  tx.set(obligationEventRef, {
    type: "cash_settlement_obligation",
    partnerId,
    bookingId: input.bookingId,
    settlementId,
    processedAt: FieldValue.serverTimestamp(),
  });
}

export function istDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
