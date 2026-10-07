"use client";

import { useEffect } from "react";
import { PHONE_RECAPTCHA_ID, clearPhoneVerifier, mountVisiblePhoneRecaptcha } from "@/lib/firebase/auth-phone";

type Props = {
  active: boolean;
  onVerifiedChange: (verified: boolean) => void;
  remountKey?: number;
};

export function PhoneRecaptchaBox({ active, onVerifiedChange, remountKey = 0 }: Props) {
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    void mountVisiblePhoneRecaptcha((verified) => {
      if (!cancelled) onVerifiedChange(verified);
    }).catch((err) => {
      console.warn("[phone-auth] mount recaptcha failed", err);
      if (!cancelled) onVerifiedChange(false);
    });
    return () => {
      cancelled = true;
    };
  }, [active, remountKey, onVerifiedChange]);

  useEffect(() => {
    return () => {
      if (!active) clearPhoneVerifier();
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="my-3 flex w-full justify-center">
      <div
        id={PHONE_RECAPTCHA_ID}
        className="flex min-h-[72px] min-w-[164px] justify-center rounded-lg bg-white"
      />
    </div>
  );
}
