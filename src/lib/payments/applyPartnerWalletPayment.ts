import { FieldValue, type Firestore } from "firebase-admin/firestore";

export type ApplyPartnerWalletPaymentInput = {
  partnerId: string;
  amountPaise: number;
  idempotencyKey: string;
  paymentIntentId: string;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  sourceType?: string;
};

/**
 * Partner remits outstanding negative wallet balance (Razorpay or verified admin).
 * Credits wallet toward zero — idempotent on idempotencyKey.
 */
export async function applyPartnerWalletPayment(
  db: Firestore,
  input: ApplyPartnerWalletPaymentInput,
): Promise<{ applied: boolean }> {
  const partnerId = String(input.partnerId || "").trim();
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  const paymentIntentId = String(input.paymentIntentId || "").trim();
  let amountPaise = Math.round(Number(input.amountPaise) || 0);

  if (!partnerId || !idempotencyKey || amountPaise <= 0) {
    throw Object.assign(new Error("Invalid partner wallet payment"), { status: 400 });
  }

  let applied = false;
  await db.runTransaction(async (tx) => {
    const eventRef = db.doc(`paymentEvents/${idempotencyKey}`);
    const eventSnap = await tx.get(eventRef);
    if (eventSnap.exists) return;

    const walletRef = db.doc(`partnerWallets/${partnerId}`);
    const walletSnap = await tx.get(walletRef);
    let balancePaise = Math.round(Number(walletSnap.data()?.balancePaise) || 0);

    if (balancePaise >= 0) {
      tx.set(eventRef, {
        type: "partner_wallet_payment_skipped",
        partnerId,
        reason: "non_negative_balance",
        processedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const debtPaise = Math.abs(balancePaise);
    amountPaise = Math.min(amountPaise, debtPaise);
    if (amountPaise <= 0) return;

    const openingBalancePaise = balancePaise;
    balancePaise += amountPaise;

    tx.set(db.doc(`walletLedger/${idempotencyKey}`), {
      transactionId: idempotencyKey,
      partnerId,
      bookingId: null,
      type: "PARTNER_TO_COMPANY_PAYMENT",
      direction: "CREDIT",
      amountPaise,
      currency: "INR",
      status: "POSTED",
      sourceType: input.sourceType || "RAZORPAY",
      sourceId: paymentIntentId,
      idempotencyKey,
      razorpayOrderId: input.razorpayOrderId ?? null,
      razorpayPaymentId: input.razorpayPaymentId ?? null,
      openingBalancePaise,
      closingBalancePaise: balancePaise,
      balanceImpact: amountPaise,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      walletRef,
      {
        partnerId,
        currency: "INR",
        balancePaise,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (paymentIntentId) {
      const intentRef = db.doc(`partnerWalletPayments/${paymentIntentId}`);
      tx.set(
        intentRef,
        {
          status: "PAID",
          paidAt: FieldValue.serverTimestamp(),
          razorpayPaymentId: input.razorpayPaymentId ?? null,
          appliedAmountPaise: amountPaise,
        },
        { merge: true },
      );
    }

    tx.set(eventRef, {
      type: "partner_wallet_payment",
      partnerId,
      paymentIntentId,
      amountPaise,
      processedAt: FieldValue.serverTimestamp(),
    });
    applied = true;
  });

  return { applied };
}
