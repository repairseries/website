import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { apiOptions, jsonWithCors, publicErrorMessage } from "@/lib/server/http";
import { requireApiCaller } from "@/lib/server/auth";
import type { WallPanelAddress } from "@/lib/wall-panel/types";

export const runtime = "nodejs";

function bookingCode(): string {
  return `WP${Date.now().toString(36).toUpperCase().slice(-6)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    const body = (await req.json().catch(() => ({}))) as {
      address?: WallPanelAddress;
      scheduledDate?: string;
      scheduledSlotLabel?: string;
      scheduledSlotIndex?: number;
      interestedDesignIds?: string[];
      customerNotes?: string;
      customerName?: string;
      customerPhone?: string;
    };

    const address = body.address;
    if (!address?.line1?.trim() || !address?.city?.trim() || !address?.pincode?.trim()) {
      return jsonWithCors(req, { error: "Complete address is required" }, { status: 400 });
    }
    const scheduledDate = String(body.scheduledDate || "").trim();
    const scheduledSlotLabel = String(body.scheduledSlotLabel || "").trim();
    if (!scheduledDate || !scheduledSlotLabel) {
      return jsonWithCors(req, { error: "Appointment date and slot are required" }, { status: 400 });
    }

    const designIds = Array.isArray(body.interestedDesignIds)
      ? body.interestedDesignIds.map((id) => String(id).trim()).filter(Boolean)
      : [];

    const db = getAdminDb();
    const ref = db.collection("wallPanelBookings").doc();
    const payload = {
      bookingCode: bookingCode(),
      customerId: caller.uid,
      customerName: String(body.customerName || caller.name || "").trim(),
      customerPhone: String(body.customerPhone || caller.phone || "").trim(),
      address: {
        ...address,
        fullAddress:
          address.fullAddress ||
          [address.line1, address.line2, address.city, address.state, address.pincode]
            .filter(Boolean)
            .join(", "),
      },
      scheduledDate,
      scheduledSlotLabel,
      scheduledSlotIndex: Number.isFinite(Number(body.scheduledSlotIndex))
        ? Number(body.scheduledSlotIndex)
        : null,
      interestedDesignIds: designIds,
      customerNotes: String(body.customerNotes || "").trim(),
      status: "CONSULTATION_PENDING",
      department: "wallPanel",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.set(payload);

    return jsonWithCors(req, { ok: true, bookingId: ref.id, bookingCode: payload.bookingCode });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(req, { error: publicErrorMessage(err, "Could not create consultation") }, { status });
  }
}
