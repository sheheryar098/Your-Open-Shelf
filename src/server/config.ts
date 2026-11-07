/**
 * Operational policy. The deadlines are starting values and are
 * intended to be tuned from real delivery data.
 */
export const policy = {
  termsVersion: "2026-11-draft",
  minimumAge: 16,
  senderResponseDays: 3,
  dispatchBusinessDays: 5,
  /** Dispute window after a delivery that the recipient did not explicitly confirm. */
  disputeWindowDays: 3,
  /** Extra days after the route's maximum delivery estimate before tracked parcels auto-confirm. */
  autoConfirmGraceDays: 7,
  /** Fallback when a route has no delivery estimate. */
  defaultMaxDeliveryDays: 14,
  staleListingDays: 120,
  maxPhotosPerListing: 6,
  maxUploadBytes: 5 * 1024 * 1024,
  activeListingLimit: { free: 50, plus: 250 } as Record<string, number>,
  /** Open requests a member may have before their first exchange completes, and after. */
  openRequestLimitNewMember: 3,
  openRequestLimit: 10,
  sessionDays: 30,
} as const;

export const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
export const uploadDir = () => process.env.UPLOAD_DIR ?? "storage/uploads";
export const devOutboxEnabled = () => process.env.ENABLE_DEV_OUTBOX === "true" && process.env.NODE_ENV !== "production";
