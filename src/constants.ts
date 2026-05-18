export const SERVER_NAME = "aryeo-mcp";
export const SERVER_VERSION = "2.0.0";

export const ARYEO_BASE_URL = "https://api.aryeo.com/v1";

export const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26"] as const;
export const DEFAULT_PROTOCOL_VERSION: (typeof SUPPORTED_PROTOCOL_VERSIONS)[number] = "2024-11-05";

export const ALLOWED_REDIRECT_HOSTS = new Set<string>([
  "claude.ai",
  "api.claude.ai",
  "claude.com",
  "api.claude.com",
]);

// VERIFIED 2026-05-18 against live API — see CHANGELOG for the curl evidence.
// Listings status values are uppercase enums from Aryeo's listing-status set.
export const LISTING_STATUSES = [
  "DRAFT",
  "COMING_SOON",
  "FOR_LEASE",
  "FOR_SALE",
  "PENDING_SALE",
  "PENDING_LEASE",
  "FOR_RENT",
  "SOLD",
  "LEASED",
  "OFF_MARKET",
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

// VERIFIED 2026-05-18 against live API — orders expose THREE separate status-like
// fields (payment_status, fulfillment_status, status). Each has its own enum.
export const ORDER_STATUSES = ["CONFIRMED", "CANCELED", "DRAFT"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_PAYMENT_STATUSES = ["PAID", "UNPAID", "PARTIALLY_PAID"] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

export const ORDER_FULFILLMENT_STATUSES = [
  "FULFILLED",
  "UNFULFILLED",
  "PARTIALLY_FULFILLED",
] as const;
export type OrderFulfillmentStatus = (typeof ORDER_FULFILLMENT_STATUSES)[number];

// VERIFIED 2026-05-18 — Aryeo uses American "CANCELED" spelling on appointments.
export const APPOINTMENT_STATUSES = ["SCHEDULED", "UNSCHEDULED", "CANCELED"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const PRODUCT_TYPES = ["MAIN", "ADDON"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

// Aryeo IDs are UUIDs (v7 in practice as of 2026-05-18; the toolkit's
// uuidValidator accepts all UUID layouts, version digit unenforced).
// Used for path parameters and ID filters across every Aryeo tool.
export const APPOINTMENT_DURATION_MIN = 15;
export const APPOINTMENT_DURATION_MAX = 480;

export const SEARCH_MAX_CHARS = 255;
export const CANCEL_REASON_MAX_CHARS = 500;
export const PAGE_PER_PAGE_MAX = 100;
