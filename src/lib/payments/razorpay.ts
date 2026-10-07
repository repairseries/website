import crypto from "crypto";

export function razorpayCredentials() {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  return { keyId, keySecret, webhookSecret };
}

export async function createRazorpayOrder(params: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}) {
  const { keyId, keySecret } = razorpayCredentials();
  if (!keyId || !keySecret) {
    throw Object.assign(new Error("Razorpay is not configured"), { status: 503, code: "RAZORPAY_CONFIG" });
  }
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: Math.max(100, Math.round(params.amountPaise)),
      currency: "INR",
      receipt: params.receipt.slice(0, 40),
      notes: params.notes || {},
    }),
  });
  const json = (await response.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
  if (!response.ok || !json.id) {
    throw Object.assign(new Error(json.error?.description || "Could not create Razorpay order"), {
      status: 502,
      code: "RAZORPAY_ORDER_FAILED",
    });
  }
  return { orderId: json.id, keyId };
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string): boolean {
  const { webhookSecret } = razorpayCredentials();
  if (!webhookSecret || !signature) return false;
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function verifyRazorpayPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const { keySecret } = razorpayCredentials();
  if (!keySecret) return false;
  const payload = `${params.orderId}|${params.paymentId}`;
  const expected = crypto.createHmac("sha256", keySecret).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(params.signature));
  } catch {
    return false;
  }
}
