export const CUSTOMER_COPY: Record<string, (s: string) => string> = {
  created: (s) =>
    `Your booking for ${s} is confirmed. We'll notify you when a partner is assigned.`,
  assigned: (s) => `A partner has been assigned to your ${s} booking.`,
  partner_assigned: (s) => `A partner has been assigned to your ${s} booking.`,
  accepted: (s) => `Your partner accepted the ${s} booking.`,
  rejected: (s) => `The assigned partner could not take your ${s} booking. We are reassigning.`,
  arriving: (s) => `Your partner is on the way for ${s}.`,
  started: (s) => `Your ${s} service has started.`,
  otp_ready: (s) =>
    `Your ${s} service OTP is ready. Open the app to share it with your partner.`,
  completed: (s) => `Your ${s} booking is complete. Thank you!`,
  cancelled: (s) => `Your ${s} booking has been cancelled.`,
  rescheduled: (s) =>
    `Your ${s} booking has been rescheduled. Open the app to see the new time.`,
  add_on_approval_needed: (s) =>
    `Your partner added extra items to ${s}. Open the app to review and approve.`,
  extras_added: (s) =>
    `Your partner added extra items to ${s}. Open the app to review and approve.`,
  add_on_approved: (s) => `Add-on services for ${s} were approved.`,
  add_on_rejected: (s) => `Add-on services for ${s} were not approved.`,
  payment_request: (s) =>
    `Payment requested for your ${s} booking. Open the app to pay.`,
  payment_received: (s) => `Payment received for your ${s} booking.`,
  invoice_generated: (s) => `Your invoice for ${s} is ready.`,
};

export const TECH_COPY: Record<string, (s: string, code: string) => string> = {
  booking_assigned: (s, code) =>
    `Nayi booking: ${s}${code ? ` (${code})` : ""}. Open app to accept & navigate.`,
  new_booking: (s, code) =>
    `Nayi booking: ${s}${code ? ` (${code})` : ""}. Open app to accept & navigate.`,
  created: (s, code) =>
    `Nayi booking: ${s}${code ? ` (${code})` : ""}. Open app to accept & navigate.`,
  assigned: (s, code) =>
    `Nayi booking: ${s}${code ? ` (${code})` : ""}. Open app to accept & navigate.`,
  booking_cancelled: (s) => `Booking cancelled: ${s}`,
  cancelled: (s) => `Booking cancelled: ${s}`,
  add_on_approved: (s) => `Customer approved extras for ${s}`,
  add_on_rejected: (s) => `Customer rejected extras for ${s}`,
  invoice_generated: (s) => `Invoice generated for ${s}`,
  partner_approved: () => `Your partner account was approved.`,
  partner_rejected: () => `Your partner application needs attention.`,
  kyc_approved: () => `Your KYC documents were approved.`,
  kyc_rejected: () => `Your KYC needs a correction. Open the app.`,
};

export function customerBody(eventType: string, serviceName: string): string {
  const s = (serviceName || "your service").trim() || "your service";
  const fn = CUSTOMER_COPY[eventType];
  return fn ? fn(s) : "Your booking has been updated.";
}

export function techBody(
  eventType: string,
  serviceName: string,
  bookingCode: string,
): string {
  const s = (serviceName || "Service").trim() || "Service";
  const fn = TECH_COPY[eventType] || TECH_COPY[techEventFrom(eventType)];
  return fn ? fn(s, bookingCode) : `Booking update: ${s}`;
}

export function techEventFrom(eventType: string): string {
  const t = String(eventType || "").toLowerCase();
  if (
    t === "assigned" ||
    t === "created" ||
    t === "partner_assigned" ||
    t === "new_booking"
  ) {
    return "booking_assigned";
  }
  if (t === "cancelled") return "booking_cancelled";
  return eventType;
}

export function isNewBookingEvent(eventType: string): boolean {
  const t = String(eventType || "").trim().toLowerCase();
  return t === "booking_assigned" || t === "new_booking";
}

/** Versioned channel — Android cannot change sound/importance on an existing channel id. */
export const ANDROID_NEW_BOOKING_CHANNEL = "new-booking-v2";
export const BOOKING_ALERT_SOUND = "booking_alert";

export function channelFor(eventType: string): string {
  return isNewBookingEvent(eventType) ? ANDROID_NEW_BOOKING_CHANNEL : "booking-updates";
}

export function soundFor(eventType: string): string {
  return isNewBookingEvent(eventType) ? BOOKING_ALERT_SOUND : "default";
}
