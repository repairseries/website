"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export default function PartnerWalletPayPage() {
  const params = useSearchParams();
  const token = String(params.get("token") || "").trim();
  const [message, setMessage] = useState("Loading secure checkout…");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setMessage("Invalid checkout link.");
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/partners/wallet/pay/checkout?token=${encodeURIComponent(token)}`);
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          alreadyPaid?: boolean;
          orderId?: string;
          amountPaise?: number;
          keyId?: string;
          paymentIntentId?: string;
        };
        if (!res.ok) {
          setMessage(json.error || "Checkout unavailable");
          return;
        }
        if (json.alreadyPaid) {
          setDone(true);
          setMessage("Payment already recorded. You can close this window.");
          return;
        }

        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        script.onload = () => {
          if (cancelled || !window.Razorpay) return;
          const amountPaise = Math.round(Number(json.amountPaise) || 0);
          const rzp = new window.Razorpay({
            key: json.keyId,
            amount: amountPaise,
            currency: "INR",
            name: "Repair Series",
            description: "Settlement wallet payment",
            order_id: json.orderId,
            handler: () => {
              setDone(true);
              setMessage("Payment submitted. Return to the Partner app to refresh your wallet.");
            },
            theme: { color: "#C45508" },
          });
          rzp.open();
          setMessage("Complete payment in the Razorpay window.");
        };
        script.onerror = () => setMessage("Could not load Razorpay checkout.");
        document.body.appendChild(script);
      } catch {
        setMessage("Network error. Try again from the Partner app.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="mb-3 text-xl font-bold text-neutral-900">Repair Series settlement</h1>
      <p className={`text-sm ${done ? "text-green-700" : "text-neutral-600"}`}>{message}</p>
    </main>
  );
}
