export const FORMATS = {
  paperback: "Paperback",
  hardcover: "Hardcover",
  textbook: "Textbook",
  childrens: "Children's book",
  picture_book: "Picture book",
  graphic_novel: "Graphic novel / comic",
  manga: "Manga",
  reference: "Reference",
  large_print: "Large print",
  poetry: "Poetry / literary collection",
  cookbook: "Cookbook",
  art_photography: "Art & photography",
  religious_cultural: "Religious & cultural",
  boxed_set: "Boxed set",
  other: "Other physical format",
} as const;
export type Format = keyof typeof FORMATS;

export const CONDITIONS = {
  like_new: { label: "Like New", guidance: "Appears barely used; no meaningful damage." },
  very_good: { label: "Very Good", guidance: "Light signs of use; pages intact and readable." },
  good: { label: "Good", guidance: "Normal wear; may have notes or markings disclosed in the description." },
  acceptable: {
    label: "Acceptable",
    guidance: "Significant wear but complete and usable; all defects clearly disclosed.",
  },
} as const;
export type Condition = keyof typeof CONDITIONS;

export const NOT_EXCHANGEABLE = [
  "Missing pages",
  "Detached covers",
  "Extensive mold or active pests",
  "Severe water damage",
  "Undisclosed writing or highlighting",
  "Strong smoke or other persistent odors",
  "Counterfeit or pirated copies",
  "Materially misleading edition details",
];

export const LANGUAGES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  ga: "Irish",
  cy: "Welsh",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  pl: "Polish",
  ru: "Russian",
  uk: "Ukrainian",
  tr: "Turkish",
  ar: "Arabic",
  he: "Hebrew",
  fa: "Persian",
  ur: "Urdu",
  hi: "Hindi",
  bn: "Bengali",
  pa: "Punjabi",
  ta: "Tamil",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  ms: "Malay",
  sw: "Swahili",
  el: "Greek",
  la: "Latin",
  other: "Other",
};

export const LISTING_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  reserved: "Reserved",
  unavailable: "Unavailable",
  paused: "Paused",
  exchanged: "Exchanged",
  removed: "Removed",
  under_review: "Under review",
};

export const EXCHANGE_STATUS_LABEL: Record<string, string> = {
  requested: "Awaiting sender response",
  accepted: "Accepted, being prepared",
  shipped: "In transit",
  delivered: "Delivered",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
  disputed: "In dispute",
  refunded: "Closed, credit restored",
};

export const DISPUTE_TYPES: Record<string, string> = {
  no_dispatch_evidence: "No evidence the book was sent",
  tracking_not_updating: "Tracking hasn't updated",
  delivered_not_received: "Carrier shows delivered but I can't find it",
  customs_hold: "Customs hold",
  returned_to_sender: "Parcel returned to sender",
  damaged: "Book arrived damaged",
  wrong_book: "Wrong book or edition",
  condition_mismatch: "Condition materially different from listing",
  other: "Something else",
};

export const REPORT_REASONS: Record<string, string> = {
  inaccurate: "Inaccurate description or edition",
  prohibited: "Prohibited item",
  counterfeit: "Counterfeit or pirated copy",
  not_owned: "Member doesn't seem to own this book",
  harassment: "Harassment or abuse",
  off_platform_payment: "Asking for off-platform payment",
  spam: "Spam",
  review_abuse: "Abusive or retaliatory review",
  other: "Other",
};

export const TICKET_CATEGORIES: Record<string, string> = {
  account_security: "Account access & security",
  credit_balance: "Credit balance problem",
  request_cancellation: "Request cancellation",
  sender_not_shipped: "Sender hasn't shipped",
  tracking_delivery: "Tracking / delivery",
  damaged_incorrect: "Damaged or incorrect book",
  customs_returned: "Customs or returned parcel",
  harassment_safety: "Harassment or safety",
  privacy_data: "Privacy / data request",
  payment_subscription: "Payment or subscription",
  general: "General question",
};

/** Ticket categories that start at high priority. */
export const HIGH_PRIORITY_CATEGORIES = new Set(["account_security", "harassment_safety", "credit_balance"]);

export const REVIEW_TAGS: Record<string, string> = {
  great_communication: "Great communication",
  fast_dispatch: "Fast dispatch",
  accurate_listing: "Accurate listing",
  well_packed: "Well packed",
  slow_dispatch: "Slow dispatch",
  poor_packaging: "Poor packaging",
  not_as_described: "Not as described",
};

export const LEDGER_LABEL: Record<string, string> = {
  credit_earned: "Credit earned",
  credit_reserved: "Credit reserved",
  credit_spent: "Credit spent",
  credit_released: "Credit released",
  credit_refunded: "Credit restored",
  credit_admin_adjustment: "Adjustment by YOS",
  credit_reversed: "Reversal",
};

export function label(map: Record<string, string | { label: string }>, key: string | null | undefined): string {
  if (!key) return "";
  const v = map[key];
  if (!v) return key;
  return typeof v === "string" ? v : v.label;
}
