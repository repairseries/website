import { NextRequest } from "next/server";
import { apiOptions, jsonWithCors } from "@/lib/api/cors";
import { publicErrorMessage } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const { handleAssignmentResponsePost } = await import("./handler");
    return await handleAssignmentResponsePost(req);
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    return jsonWithCors(
      req,
      {
        success: false,
        error: publicErrorMessage(err, "Could not record assignment response"),
        code: (err as { code?: string }).code,
      },
      { status },
    );
  }
}
