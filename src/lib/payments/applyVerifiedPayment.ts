import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { bookingPayableAmount } from "@/lib/payments/bookingAmount";
import {
  commitPartnerWalletPlan,
  readPartnerWalletPlan,
  resolvePartnerIdFromBooking,
} from "@/lib/payments/partnerWallet";

function money(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export type ApplyPaymentInput = {
  bookingId: string;
  method: "ONLINE" | "CASH";
  amount: number;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  idempotencyKey: string;
};

/**
 * Idempotent payment confirmation inside a transaction.
 * Returns `{ applied: false }` when already paid or duplicate event.
 */
export async function applyVerifiedPayment(
  db: Firestore,
  input: ApplyPaymentInput,
): Promise<{ applied: boolean; bookingId: string }> {
  const bookingRef = db.doc(`bookings/${input.bookingId}`);
  const eventRef = db.doc(`paymentEvents/${input.idempotencyKey}`);

  let applied = false;
  await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef);
    if (eventSnap.exists) {
      return;
    }

    const snap = await tx.get(bookingRef);
    if (!snap.exists) {
      throw Object.assign(new Error("Booking not found"), { status: 404 });
    }
    const data = snap.data() || {};
    const payment = (data.payment as Record<string, unknown> | undefined) || {};
    const current = String(payment.status ?? data.paymentStatus ?? "").toUpperCase();
    if (current === "PAID" || current === "CASH_COLLECTED") {
      tx.set(eventRef, {
        bookingId: input.bookingId,
        duplicate: true,
        processedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const expected = bookingPayableAmount(data);
    const paid = money(input.amount);
    if (expected > 0 && Math.abs(expected - paid) > 0.01) {
      throw Object.assign(new Error("Payment amount mismatch"), { status: 409, code: "AMOUNT_MISMATCH" });
    }

    const status = input.method === "CASH" ? "CASH_COLLECTED" : "PAID";
    const paymentPatch = {
      ...payment,
      status,
      method: input.method,
      amount: paid || expected,
      razorpayOrderId: input.razorpayOrderId ?? payment.razorpayOrderId ?? null,
      razorpayPaymentId: input.razorpayPaymentId ?? payment.razorpayPaymentId ?? null,
      paidAt: FieldValue.serverTimestamp(),
      verifiedAt: FieldValue.serverTimestamp(),
    };

    const mergedBooking = {
      ...data,
      payment: paymentPatch,
      paymentStatus: input.method === "CASH" ? "cash_collected" : "paid",
    };

    const partnerId = resolvePartnerIdFromBooking(data);
    const walletPlan = partnerId
      ? await readPartnerWalletPlan(db, tx, {
          partnerId,
          bookingId: input.bookingId,
          method: input.method,
          paymentEventKey: input.idempotencyKey,
          booking: mergedBooking,
        })
      : null;

    tx.update(bookingRef, {
      payment: paymentPatch,
      paymentStatus: input.method === "CASH" ? "cash_collected" : "paid",
      paymentRequired: false,
      paymentMethod: input.method === "CASH" ? "cash" : "online",
      paidAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(eventRef, {
      bookingId: input.bookingId,
      method: input.method,
      amount: paid || expected,
      razorpayPaymentId: input.razorpayPaymentId || null,
      processedAt: FieldValue.serverTimestamp(),
    });
    applied = true;

    if (walletPlan) {
      commitPartnerWalletPlan(db, tx, walletPlan);
    }
  });

  return { applied, bookingId: input.bookingId };
}
