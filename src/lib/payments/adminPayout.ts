import { FieldValue, type Firestore } from "firebase-admin/firestore";

export type AdminPayoutMethod = "UPI" | "BANK_TRANSFER" | "CASH";

export type RecordAdminPayoutInput = {
  partnerId: string;
  amountPaise: number;
  paymentMethod: AdminPayoutMethod;
  transactionReference?: string;
  notes?: string;
  adminUid: string;
  idempotencyKey: string;
};

function ledgerRef(db: Firestore, id: string) {
  return db.doc(`walletLedger/${id}`);
}

function walletRef(db: Firestore, partnerId: string) {
  return db.doc(`partnerWallets/${partnerId}`);
}

/**
 * Record company → partner settlement payout. Reduces positive wallet balance only.
 * Idempotent on `idempotencyKey`.
 */
export async function recordAdminPartnerPayout(
  db: Firestore,
  input: RecordAdminPayoutInput,
): Promise<{ balancePaise: number; posted: boolean }> {
  const partnerId = String(input.partnerId || "").trim();
  const amountPaise = Math.round(Number(input.amountPaise) || 0);
  const idempotencyKey = String(input.idempotencyKey || "").trim();

  if (!partnerId) throw Object.assign(new Error("Invalid partner"), { status: 400 });
  if (!idempotencyKey) throw Object.assign(new Error("Missing idempotency key"), { status: 400 });
  if (amountPaise <= 0) {
    throw Object.assign(new Error("Payout amount must be greater than zero"), { status: 400 });
  }

  const techSnap = await db.doc(`technicians/${partnerId}`).get();
  if (!techSnap.exists) {
    throw Object.assign(new Error("Partner not found"), { status: 404 });
  }

  let resultBalance = 0;
  let posted = false;

  await db.runTransaction(async (tx) => {
    const eventRef = db.doc(`paymentEvents/${idempotencyKey}`);
    const eventSnap = await tx.get(eventRef);
    if (eventSnap.exists) {
      const walletSnap = await tx.get(walletRef(db, partnerId));
      resultBalance = Math.round(Number(walletSnap.data()?.balancePaise) || 0);
      return;
    }

    const walletSnap = await tx.get(walletRef(db, partnerId));
    const openingPaise = Math.round(Number(walletSnap.data()?.balancePaise) || 0);

    if (openingPaise <= 0) {
      throw Object.assign(new Error("Partner wallet has no positive balance to pay out"), {
        status: 409,
        code: "NO_POSITIVE_BALANCE",
      });
    }
    if (amountPaise > openingPaise) {
      throw Object.assign(
        new Error(`Payout exceeds available balance (₹${(openingPaise / 100).toFixed(2)})`),
        { status: 409, code: "PAYOUT_EXCEEDS_BALANCE" },
      );
    }

    const closingPaise = openingPaise - amountPaise;
    const balanceImpact = -amountPaise;

    tx.set(ledgerRef(db, idempotencyKey), {
      transactionId: idempotencyKey,
      partnerId,
      bookingId: null,
      type: "COMPANY_PAYOUT",
      direction: "DEBIT",
      amountPaise,
      balanceImpact,
      openingBalancePaise: openingPaise,
      closingBalancePaise: closingPaise,
      currency: "INR",
      status: "POSTED",
      settlementStatus: "PAID",
      paymentMethod: input.paymentMethod,
      payoutReference: String(input.transactionReference || "").trim() || null,
      notes: String(input.notes || "").trim() || null,
      sourceType: "ADMIN_PAYOUT",
      sourceId: input.adminUid,
      idempotencyKey,
      createdBy: input.adminUid,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      walletRef(db, partnerId),
      {
        partnerId,
        currency: "INR",
        balancePaise: closingPaise,
        lastPayoutAt: FieldValue.serverTimestamp(),
        lastPayoutMethod: input.paymentMethod,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(eventRef, {
      type: "admin_partner_payout",
      partnerId,
      amountPaise,
      paymentMethod: input.paymentMethod,
      adminUid: input.adminUid,
      processedAt: FieldValue.serverTimestamp(),
    });

    const legacyTxRef = db.doc(`technicians/${partnerId}/transactions/${idempotencyKey}`);
    tx.set(legacyTxRef, {
      type: "payout",
      amount: amountPaise / 100,
      paymentMode: input.paymentMethod.replace("_", " "),
      note: String(input.notes || "").trim() || null,
      walletLedgerId: idempotencyKey,
      createdAt: FieldValue.serverTimestamp(),
    });

    resultBalance = closingPaise;
    posted = true;
  });

  return { balancePaise: resultBalance, posted };
}
