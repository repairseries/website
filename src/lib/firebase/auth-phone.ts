"use client";

import {
  initializeRecaptchaConfig,
  RecaptchaVerifier,
  signInWithCustomToken,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from "firebase/auth";
import { getAuthClient } from "@/lib/firebase/auth";
import { logPhoneOtpFailure, toPhoneAuthUserError } from "@/lib/auth/phone-errors";
import { parseIndiaMobile } from "@/lib/auth/phone";

export const PHONE_RECAPTCHA_ID = "rs-phone-recaptcha";

const OTP_SEND_TIMEOUT_MS = 90_000;

const RECAPTCHA_UI = {
  size: "compact" as const,
  theme: "light" as const,
};

let verifier: RecaptchaVerifier | null = null;
let captchaVerified = false;
let confirmation: ConfirmationResult | null = null;
let sendInFlight = false;
let mountGeneration = 0;

function requireBrowser() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Phone login is only available in the browser.");
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function recaptchaHost() {
  const host = document.getElementById(PHONE_RECAPTCHA_ID);
  if (!host) {
    throw new Error("Security check is not ready. Refresh the page and try again.");
  }
  return host;
}

export function isPhoneCaptchaVerified() {
  return captchaVerified;
}

export function clearPhoneVerifier() {
  if (sendInFlight) return;
  try {
    verifier?.clear();
  } catch {
    /* ignore */
  }
  verifier = null;
  captchaVerified = false;
  confirmation = null;
  const host = document.getElementById(PHONE_RECAPTCHA_ID);
  host?.replaceChildren();
}

/** Mount visible compact reCAPTCHA checkbox. Call when phone step is shown. */
export async function mountVisiblePhoneRecaptcha(
  onVerifiedChange?: (verified: boolean) => void,
): Promise<void> {
  requireBrowser();
  const auth = getAuthClient();
  if (!auth) throw new Error("Firebase Auth is not configured.");

  clearPhoneVerifier();
  const gen = ++mountGeneration;
  recaptchaHost().replaceChildren();

  try {
    await initializeRecaptchaConfig(auth);
  } catch (error) {
    console.warn("[phone-auth] initializeRecaptchaConfig failed", error);
  }

  const next = new RecaptchaVerifier(auth, PHONE_RECAPTCHA_ID, {
    ...RECAPTCHA_UI,
    callback: () => {
      if (gen !== mountGeneration) return;
      captchaVerified = true;
      onVerifiedChange?.(true);
    },
    "expired-callback": () => {
      if (gen !== mountGeneration) return;
      captchaVerified = false;
      onVerifiedChange?.(false);
    },
  });

  verifier = next;
  try {
    await next.render();
  } catch (error) {
    console.warn("[phone-auth] recaptcha render failed", error);
    captchaVerified = false;
    onVerifiedChange?.(false);
    clearPhoneVerifier();
    throw error;
  }
}

export async function sendCustomerOtp(rawPhone: string) {
  if (sendInFlight) {
    throw new Error("Sending OTP...");
  }
  const parsed = parseIndiaMobile(rawPhone);
  if (!parsed.ok) throw new Error(parsed.error);
  if (!parsed.e164.startsWith("+")) {
    throw new Error("Invalid phone number.");
  }
  if (!captchaVerified || !verifier) {
    throw new Error("Please verify that you're not a robot.");
  }

  const auth = getAuthClient();
  if (!auth) throw new Error("Firebase Auth is not configured.");

  const appVerifier = verifier;
  sendInFlight = true;
  try {
    confirmation = await withTimeout(
      signInWithPhoneNumber(auth, parsed.e164, appVerifier),
      OTP_SEND_TIMEOUT_MS,
      "Unable to send OTP. Please try again.",
    );
    captchaVerified = false;
    try {
      appVerifier.clear();
    } catch {
      /* ignore */
    }
    verifier = null;
    recaptchaHost().replaceChildren();
    return { e164: parsed.e164 };
  } catch (error) {
    logPhoneOtpFailure(error, {
      hasVerifier: Boolean(appVerifier),
      e164Length: parsed.e164.length,
      e164Prefix: parsed.e164.slice(0, 3),
      hostname: typeof window !== "undefined" ? window.location.hostname : "",
    });
    console.warn("[phone-auth] sendCustomerOtp failed", error);
    confirmation = null;
    clearPhoneVerifier();
    throw toPhoneAuthUserError(error);
  } finally {
    sendInFlight = false;
  }
}

export async function confirmCustomerOtp(code: string) {
  const otp = String(code || "").replace(/\D/g, "");
  if (otp.length !== 6) throw new Error("Enter the 6-digit OTP.");
  if (!confirmation) throw new Error("Request a new OTP first.");
  try {
    const cred = await confirmation.confirm(otp);
    return cred.user;
  } catch (error) {
    logPhoneOtpFailure(error, { stage: "confirm" });
    throw toPhoneAuthUserError(error);
  }
}

export async function resolveCustomerIdentity(displayName?: string) {
  const auth = getAuthClient();
  if (!auth?.currentUser) throw new Error("Sign in required");
  const token = await auth.currentUser.getIdToken();
  const res = await fetch("/api/auth/resolve-identity", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "customer", displayName: displayName || "" }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    customToken?: string;
    blocked?: boolean;
    created?: boolean;
    migrated?: boolean;
    uid?: string;
  };
  if (!res.ok) {
    await signOut(auth).catch(() => undefined);
    throw new Error(payload.error || "Could not complete sign in.");
  }
  if (payload.customToken) {
    await signInWithCustomToken(auth, payload.customToken);
  }
  return payload;
}
