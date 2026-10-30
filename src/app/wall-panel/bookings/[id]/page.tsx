"use client";

import { doc, onSnapshot } from "firebase/firestore";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Container } from "@/components/container";
import { getDb } from "@/lib/firebase/firestore";
import { getAuthClient } from "@/lib/firebase/auth";

export default function WallPanelBookingDetailPage() {
  const params = useParams();
  const id = String(params?.id || "");
  const [booking, setBooking] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const db = getDb();
    if (!db || !id) return undefined;
    return onSnapshot(doc(db, "wallPanelBookings", id), (snap) => {
      setBooking(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
  }, [id]);

  const respond = async (decision: "ACCEPT" | "REJECT") => {
    const auth = getAuthClient();
    const token = await auth?.currentUser?.getIdToken();
    if (!token) return;
    setBusy(true);
    try {
      await fetch("/api/wall-panel/customer/quotation-response", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: id, decision }),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!booking) {
    return (
      <Container className="py-10">
        <p>Loading…</p>
      </Container>
    );
  }

  const q = booking.quotation as { totalRupees?: number; lines?: Array<Record<string, unknown>> } | undefined;

  return (
    <Container className="max-w-lg py-10">
      <Link href="/wall-panel" className="text-sm text-[#C45508]">
        ← Wall Panel
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{String(booking.bookingCode || id)}</h1>
      <p className="text-neutral-600">Status: {String(booking.status || "")}</p>
      {booking.consultationOtp ? (
        <div className="mt-4 rounded-xl border border-[#C45508] bg-orange-50 p-4">
          <p className="text-sm font-semibold">Consultation OTP</p>
          <p className="text-3xl font-black tracking-widest">{String(booking.consultationOtp)}</p>
        </div>
      ) : null}
      {booking.deliveryOtp ? (
        <div className="mt-4 rounded-xl border border-[#C45508] bg-orange-50 p-4">
          <p className="text-sm font-semibold">Delivery OTP</p>
          <p className="text-3xl font-black tracking-widest">{String(booking.deliveryOtp)}</p>
        </div>
      ) : null}
      {booking.status === "QUOTATION_PENDING_CUSTOMER" && q?.totalRupees != null ? (
        <div className="mt-6 space-y-3 rounded-xl border p-4">
          <p className="text-lg font-bold">Quotation: ₹{Number(q.totalRupees).toFixed(2)}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              className="flex-1 rounded-lg bg-neutral-500 py-2 text-white"
              onClick={() => void respond("REJECT")}
            >
              Reject
            </button>
            <button
              type="button"
              disabled={busy}
              className="flex-1 rounded-lg bg-[#C45508] py-2 text-white"
              onClick={() => void respond("ACCEPT")}
            >
              Accept
            </button>
          </div>
        </div>
      ) : null}
    </Container>
  );
}
