import crypto from "crypto";

export function generateWallPanelOtp(): string {
  return String(crypto.randomInt(1000, 10000));
}

export function otpExpiryDate(minutes = 30): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function normalizeOtpInput(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\D/g, "")
    .trim();
}

export function assertOtpValid(expected: string, entered: string, expiresAt?: Date | null): void {
  const exp = String(expected || "").trim();
  const got = normalizeOtpInput(entered);
  if (!exp) {
    throw Object.assign(new Error("OTP not issued yet"), { status: 409, code: "OTP_MISSING" });
  }
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    throw Object.assign(new Error("OTP expired"), { status: 410, code: "OTP_EXPIRED" });
  }
  if (got.length < 4 || got !== exp) {
    throw Object.assign(new Error("Invalid OTP"), { status: 403, code: "INVALID_OTP" });
  }
}
