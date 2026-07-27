export const SERVER_NAME = "aryeo-mcp";
export const SERVER_VERSION = "2.1.1";

export const ARYEO_BASE_URL = "https://api.aryeo.com/v1";

export const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26"] as const;
export const DEFAULT_PROTOCOL_VERSION: (typeof SUPPORTED_PROTOCOL_VERSIONS)[number] = "2024-11-05";

export const ALLOWED_REDIRECT_HOSTS = new Set<string>([
  "claude.ai",
  "api.claude.ai",
  "claude.com",
  "api.claude.com",
  // Native-app OAuth callbacks (RFC 8252) for CLI clients like Claude Code
  // Desktop and Hermes Agent. Localhost is only reachable from the same
  // machine, so tokens cannot be intercepted by remote attackers.
  "localhost",
  "127.0.0.1",
]);

export const ALLOWED_REDIRECT_SCHEMES = new Set<string>(["https:", "http:"]);

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
//
// RE-VERIFIED 2026-07-27: these are RESPONSE values. The `filter[status]` query
// param accepts a different, overlapping set — open / draft / canceled /
// confirmed (lowercase). Measured on the live account: open=55, canceled=3
// (=58 total), draft=0, confirmed=0 — even though every order's response
// `status` field reads "CONFIRMED". Aryeo's filter is keyed off the order's
// lifecycle (`order_status`, e.g. "OPEN"), not the response `status` field.
// We expose the filterable set and uppercase it for consistency with responses;
// toAryeoFilterValue() lowercases on the wire.
export const ORDER_STATUSES = ["OPEN", "DRAFT", "CANCELED", "CONFIRMED"] as const;
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

// VERIFIED 2026-07-27 — /scheduling/available-timeslots requires `timezone`,
// `date` and `interval`; `duration` sets the length of each returned slot
// (interval=30 + duration=120 yields 30-min-apart slots that are 2h long).
// The group's configured granularity is exposed on any order as
// booking_limits.slot_interval_minutes (15 on this account).
export const DEFAULT_SLOT_INTERVAL_MINUTES = 15;

// Every customer record on this account is Pacific/Auckland. Forks operating in
// another region should change this — it is only a fallback when the caller
// does not pass an explicit IANA timezone.
export const DEFAULT_TIMEZONE = "Pacific/Auckland";

// Aryeo's timeslot endpoint accepts ONE date per call. We loop to support a
// range; this caps how many upstream requests a single tool call can make.
export const MAX_TIMESLOT_DAYS = 14;

// VERIFIED 2026-07-27 — Aryeo ignores (rather than rejects) filters it does not
// support, so several documented filters must be applied client-side after
// fetching. These bound that walk.
export const CLIENT_FILTER_MAX_PAGES = 5;
export const CLIENT_FILTER_PAGE_SIZE = 100;
