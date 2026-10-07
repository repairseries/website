import { NextRequest } from "next/server";
import {
  getAdminCredentialDiagnostics,
  probeAdminFirestore,
} from "@/lib/firebase/admin";
import { diagnosticsForHealth } from "@/lib/firebase/adminErrors";
import { tryInternalAuth } from "@/lib/server/auth";
import { apiOptions, jsonWithCors } from "@/lib/server/http";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return apiOptions(req);
}

/**
 * Server ops only — requires NOTIFY_INTERNAL_SECRET / CRON_SECRET bearer token.
 * Never exposes private keys or service account JSON.
 */
export async function GET(req: NextRequest) {
  const internal = tryInternalAuth(req);
  if (!internal) {
    return jsonWithCors(req, { error: "Not allowed" }, { status: 401 });
  }

  const diag = getAdminCredentialDiagnostics();
  let probe: Awaited<ReturnType<typeof probeAdminFirestore>> | null = null;
  let probeError = "";
  try {
    probe = await probeAdminFirestore();
  } catch (err) {
    probeError = String((err as Error)?.message || "probe failed").slice(0, 200);
  }

  return jsonWithCors(req, {
    ok: probe?.ok === true,
    diagnostics: diagnosticsForHealth(diag),
    firestoreProbe: probe || { ok: false, message: probeError || "not run" },
    vercelEnv: process.env.VERCEL_ENV || "unknown",
  });
}
