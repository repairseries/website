import {
  FieldValue,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
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

type LedgerWrite = {
  idempotencyKey: string;
  entry: PlannedEntry;
};

type SettlementWrite = {
  settlementId: string;
  settlementRef: DocumentReference;
  obligationRef: DocumentReference;
  settlementPayload: Record<string, unknown>;
  obligationPayload: Record<string, unknown>;
};

/** All Firestore reads for wallet + cash settlement (must run before any tx writes). */
export type PartnerWalletPlan = {
  partnerId: string;
  bookingId: string;
  paymentEventKey: string;
  summaryRef: DocumentReference;
  ledgerWrites: LedgerWrite[];
  balancePaiseAfter: number;
  settlementWrite: SettlementWrite | null;
};

/**
 * Read wallet / settlement docs and build write plan. No writes.
 * Call before booking payment writes in the same transaction.
 */
export async function readPartnerWalletPlan(
  db: Firestore,
  tx: Transaction,
  input: WalletPostInput,
): Promise<PartnerWalletPlan | null> {
  const partnerId = String(input.partnerId || "").trim();
  if (!partnerId) return null;

  const { partnerEarningPaise, companySharePaise, customerTotalPaise } =
    computePaymentWalletAmounts(input.booking);
  const planned = planWalletEntries(input.method, partnerEarningPaise, companySharePaise);

  const summaryRef = walletSummaryRef(db, partnerId);
  const summarySnap = await tx.get(summaryRef);
  let balancePaise = Number(summarySnap.data()?.balancePaise);
  if (!Number.isFinite(balancePaise)) balancePaise = 0;

  const ledgerWrites: LedgerWrite[] = [];
  if (planned.length) {
    const ledgerKeys = planned.map((e) => `wallet:${input.paymentEventKey}:${e.suffix}`);
    const ledgerSnaps = await Promise.all(ledgerKeys.map((k) => tx.get(ledgerRef(db, k))));
    for (let i = 0; i < planned.length; i += 1) {
      if (ledgerSnaps[i]?.exists) continue;
      const entry = planned[i]!;
      const idempotencyKey = ledgerKeys[i]!;
      ledgerWrites.push({ idempotencyKey, entry });
      balancePaise = applyBalanceDelta(balancePaise, entry.direction, entry.amountPaise);
    }
  }

  let settlementWrite: SettlementWrite | null = null;
  if (input.method === "CASH" && companySharePaise > 0) {
    const obligationEventRef = db.doc(`paymentEvents/cash_obligation:${input.paymentEventKey}`);
    const obligationSnap = await tx.get(obligationEventRef);
    if (!obligationSnap.exists) {
      const settlementDate = istDateKey();
      const settlementId = `${partnerId}_${settlementDate}`;
      const settlementRef = db.doc(`cashSettlements/${settlementId}`);
      const settlementSnap = await tx.get(settlementRef);
      const prev = settlementSnap.data() || {};
      const bookingIds = Array.isArray(prev.cashBookingIds) ? [...prev.cashBookingIds] : [];
      if (!bookingIds.includes(input.bookingId)) bookingIds.push(input.bookingId);

      const totalCash =
        Math.round(Number(prev.totalCashCollectedPaise) || 0) + customerTotalPaise;
      const companyDue =
        Math.round(Number(prev.companyShareDuePaise) || 0) + companySharePaise;
      const remitted = Math.round(Number(prev.amountRemittedPaise) || 0);
      const outstanding = Math.max(0, companyDue - remitted);

      settlementWrite = {
        settlementId,
        settlementRef,
        obligationRef: obligationEventRef,
        settlementPayload: {
          settlementId,
          partnerId,
          settlementDate,
          cashBookingIds: bookingIds,
          totalCashCollectedPaise: totalCash,
          companyShareDuePaise: companyDue,
          amountRemittedPaise: remitted,
          amountOutstandingPaise: outstanding,
          status: outstanding > 0 ? "PENDING" : "SETTLED",
          updatedAt: FieldValue.serverTimestamp(),
        },
        obligationPayload: {
          type: "cash_settlement_obligation",
          partnerId,
          bookingId: input.bookingId,
          settlementId,
          processedAt: FieldValue.serverTimestamp(),
        },
      };
    }
  }

  if (!ledgerWrites.length && !settlementWrite) return null;

  return {
    partnerId,
    bookingId: input.bookingId,
    paymentEventKey: input.paymentEventKey,
    summaryRef,
    ledgerWrites,
    balancePaiseAfter: balancePaise,
    settlementWrite,
  };
}

/** Apply a plan from {@link readPartnerWalletPlan} — writes only. */
export function commitPartnerWalletPlan(
  db: Firestore,
  tx: Transaction,
  plan: PartnerWalletPlan,
): { posted: boolean } {
  let posted = false;
  for (const { idempotencyKey, entry } of plan.ledgerWrites) {
    tx.set(ledgerRef(db, idempotencyKey), {
      transactionId: idempotencyKey,
      partnerId: plan.partnerId,
      bookingId: plan.bookingId,
      type: entry.type,
      direction: entry.direction,
      amountPaise: entry.amountPaise,
      currency: "INR",
      status: "POSTED",
      sourceType: entry.sourceType,
      sourceId: plan.paymentEventKey,
      idempotencyKey,
      createdAt: FieldValue.serverTimestamp(),
    });
    posted = true;
  }

  if (plan.ledgerWrites.length) {
    tx.set(
      plan.summaryRef,
      {
        partnerId: plan.partnerId,
        currency: "INR",
        balancePaise: plan.balancePaiseAfter,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  if (plan.settlementWrite) {
    const sw = plan.settlementWrite;
    tx.set(sw.settlementRef, sw.settlementPayload, { merge: true });
    tx.set(sw.obligationRef, sw.obligationPayload);
    posted = true;
  }

  return { posted };
}

/**
 * Idempotent wallet updates inside a transaction (reads then writes in order).
 * Prefer {@link readPartnerWalletPlan} before other writes in the same transaction.
 */
export async function postPartnerWalletInTransaction(
  db: Firestore,
  tx: Transaction,
  input: WalletPostInput,
): Promise<{ posted: boolean }> {
  const plan = await readPartnerWalletPlan(db, tx, input);
  if (!plan) return { posted: false };
  return commitPartnerWalletPlan(db, tx, plan);
}

export function istDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
