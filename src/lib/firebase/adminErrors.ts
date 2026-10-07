import {
  getAdminCredentialDiagnostics,
  type AdminCredentialDiagnostics,
} from "@/lib/firebase/admin";

export const FIREBASE_ADMIN_AUTH_ERROR = "FIREBASE_ADMIN_AUTH_ERROR";
export const SERVER_CONFIGURATION_ERROR = "SERVER_CONFIGURATION_ERROR";

export type SafeAdminFailureLog = {
  code: string;
  message: string;
  expectedProjectId: string;
  serviceAccountJsonPresent: boolean;
  clientEmailEnvPresent: boolean;
  privateKeyEnvPresent: boolean;
  parsed: boolean;
  parsedSource: string;
  parsedProjectId: string;
  projectIdMatches: boolean;
  privateKeyLooksValid: boolean;
  adminAppInitialized: boolean;
  googleErrorCode: string;
};

export function safeAdminFailureLog(err: unknown): SafeAdminFailureLog {
  const diag = getAdminCredentialDiagnostics();
  const message = String((err as Error)?.message || "").slice(0, 220);
  const googleErrorCode = String(
    (err as { code?: string }).code ||
      (err as { errorInfo?: { code?: string } }).errorInfo?.code ||
      "",
  ).slice(0, 80);
  const code = classifyFirebaseAdminErrorCode(err);
  return {
    code,
    message,
    expectedProjectId: diag.expectedProjectId,
    serviceAccountJsonPresent: diag.serviceAccountJsonExists,
    clientEmailEnvPresent: diag.clientEmailEnvExists,
    privateKeyEnvPresent: diag.privateKeyEnvExists,
    parsed: diag.parsed,
    parsedSource: diag.parsedSource,
    parsedProjectId: diag.parsedProjectId,
    projectIdMatches: diag.projectIdMatches,
    privateKeyLooksValid: diag.privateKeyLooksValid,
    adminAppInitialized: diag.adminAppInitialized,
    googleErrorCode,
  };
}

export function logSafeFirebaseAdminFailure(err: unknown, context?: string) {
  const payload = safeAdminFailureLog(err);
  console.error("[Firebase Admin auth/config failure]", {
    context: context || "api",
    ...payload,
  });
}

export function classifyFirebaseAdminErrorCode(err: unknown): string {
  const message = String((err as Error)?.message || "");
  const code = String(
    (err as { code?: string }).code ||
      (err as { errorInfo?: { code?: string } }).errorInfo?.code ||
      "",
  );

  if (code === FIREBASE_ADMIN_AUTH_ERROR) return FIREBASE_ADMIN_AUTH_ERROR;
  if (code === SERVER_CONFIGURATION_ERROR) return SERVER_CONFIGURATION_ERROR;

  if (
    /Missing Firebase Admin credentials|credentials are present but invalid|Firebase Admin project_id/i.test(
      message,
    )
  ) {
    return SERVER_CONFIGURATION_ERROR;
  }

  if (
    /16\s*UNAUTHENTICATED|invalid authentication credentials|invalid_grant|account has been disabled|Error fetching access token|credential/i.test(
      message,
    ) ||
    /invalid-credential|app-deleted|unauthenticated/i.test(code)
  ) {
    return FIREBASE_ADMIN_AUTH_ERROR;
  }

  if (/Invalid Firebase Admin credentials|cert failed/i.test(message)) {
    return FIREBASE_ADMIN_AUTH_ERROR;
  }

  return code || SERVER_CONFIGURATION_ERROR;
}

export function isFirebaseAdminFailure(err: unknown): boolean {
  const c = classifyFirebaseAdminErrorCode(err);
  return c === FIREBASE_ADMIN_AUTH_ERROR || c === SERVER_CONFIGURATION_ERROR;
}

export function clientMessageForAdminFailure(err: unknown): string {
  const code = classifyFirebaseAdminErrorCode(err);
  if (code === SERVER_CONFIGURATION_ERROR) {
    return "Server Firebase Admin is not configured. The booking was not assigned. Set FIREBASE_SERVICE_ACCOUNT_JSON (or client email + private key) on Vercel Production and redeploy.";
  }
  return "Server Firebase Admin credentials were rejected by Google. The booking was not assigned. This is a server configuration error, not a missing partner.";
}

export function diagnosticsForHealth(diag: AdminCredentialDiagnostics) {
  return {
    expectedProjectId: diag.expectedProjectId,
    serviceAccountJsonPresent: diag.serviceAccountJsonExists,
    clientEmailEnvPresent: diag.clientEmailEnvExists,
    privateKeyEnvPresent: diag.privateKeyEnvExists,
    parsed: diag.parsed,
    parsedSource: diag.parsedSource,
    parsedProjectId: diag.parsedProjectId,
    parsedClientEmailDomain: diag.parsedClientEmailDomain,
    projectIdMatches: diag.projectIdMatches,
    privateKeyLooksValid: diag.privateKeyLooksValid,
    privateKeyLength: diag.privateKeyLength,
    adminAppInitialized: diag.adminAppInitialized,
  };
}
