import { NextRequest } from "next/server";
import { jsonWithCors } from "@/lib/api/cors";
import { adminCredentialFailure, requireApiCaller } from "@/lib/server/auth";
import { publicErrorMessage } from "@/lib/server/http";
import { assignPartner, type AssignMode } from "@/lib/server/assignment/assignPartner";
import {
  classifyFirebaseAdminErrorCode,
  clientMessageForAdminFailure,
  logSafeFirebaseAdminFailure,
} from "@/lib/firebase/adminErrors";

export async function handleAssignPost(req: NextRequest) {
  try {
    const caller = await requireApiCaller(req);
    const body = (await req.json().catch(() => ({}))) as {
      bookingId?: string;
      mode?: AssignMode;
      technicianId?: string;
      dateStr?: string;
      slotIndex?: number;
      slotLabel?: string;
      reservedSlotIndices?: number[];
      categoryId?: string;
      serviceTypeId?: string;
      serviceCategoryId?: string;
      userLat?: number;
      userLng?: number;
      excludeTechnicianIds?: string[];
    };
    const result = await assignPartner({
      bookingId: String(body.bookingId || ""),
      mode: body.mode || (body.technicianId ? "specific" : "nearest"),
      caller,
      technicianId: body.technicianId,
      dateStr: body.dateStr,
      slotIndex: body.slotIndex,
      slotLabel: body.slotLabel,
      reservedSlotIndices: body.reservedSlotIndices,
      categoryId: body.categoryId,
      serviceTypeId: body.serviceTypeId,
      serviceCategoryId: body.serviceCategoryId,
      userLat: body.userLat,
      userLng: body.userLng,
      excludeTechnicianIds: body.excludeTechnicianIds,
    });
    return jsonWithCors(req, result);
  } catch (err) {
    const serverCreds = adminCredentialFailure(err);
    const status = serverCreds
      ? 503
      : Number((err as { status?: number })?.status) || 500;
    if (serverCreds) {
      logSafeFirebaseAdminFailure(err, "api/bookings/assign");
    }
    return jsonWithCors(
      req,
      {
        success: false,
        error: serverCreds
          ? clientMessageForAdminFailure(err)
          : publicErrorMessage(err, "Could not assign a partner"),
        code: serverCreds
          ? classifyFirebaseAdminErrorCode(err)
          : (err as { code?: string }).code,
      },
      { status },
    );
  }
}
