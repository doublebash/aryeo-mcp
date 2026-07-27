import { ToolError } from "@bashco/mcp-toolkit";
import type { AryeoApiEnv } from "../env.js";
import type { AppointmentStatus } from "../constants.js";
import { APPOINTMENT_SCAN_LIMIT, DEFAULT_TIMEZONE, MAX_TIMESLOT_DAYS } from "../constants.js";
import { aryeoFetch, listWithClientFilter } from "./client.js";
import { buildPath } from "./path.js";

// VERIFIED 2026-05-18: Aryeo's GET /appointments silently ignores every
// date-filter variant we tested (start_date, end_date, start_at_gte,
// start_at_lte). Server-side date filtering is unsupported.
//
// RE-VERIFIED 2026-07-27, and it is broader than dates: /appointments ignores
// ALL filtering. `status`, `order_id`, `filter[status]`, `filter[order_id]` and
// `filter[appointment_status]` each returned the full 52-record set. The
// previous code sent flat `status`/`order_id` params and presented the
// unfiltered response as filtered results. Both filters are now applied
// client-side over a bounded page walk, with the walk reported in meta.
//
// RE-VERIFIED 2026-07-28 — why date filtering had to move in here too. The
// daily briefing cron could not use this tool at all:
//   * it sent include=customer,listing,address,agents and Aryeo 400'd. Those
//     four are NOT in Aryeo's allowlist for /appointments (the 400 body lists
//     the permitted set: order, order.address, order.customer, order.listing,
//     items, owner, users, company, …). `include` is gone from this tool — the
//     default payload already nests the full order, its listing AND that
//     listing's street address, which is everything a shoot briefing needs.
//   * retrying without include succeeded but returned 1.4 MB for 52
//     appointments (median 26 KB each — `order.listing.images` alone runs to
//     52 KB on a delivered listing). The client truncated it, so the agent
//     could not reliably pick out today's shoots.
// Filtering to one day server-side turns that 1.4 MB into a handful of records.
//
// Dates MUST be compared in a real timezone, not by slicing the ISO string:
// Aryeo returns `start_at` in UTC ("2026-08-09T21:30:00Z"), and on this
// Pacific/Auckland account 21 of 52 appointments (40%) fall on a different
// calendar day locally than their UTC prefix suggests.
export interface ListAppointmentsInput {
  order_id?: string;
  status?: AppointmentStatus;
  start_date?: string;
  end_date?: string;
  timezone?: string;
  page?: number;
  per_page?: number;
}

interface AppointmentRecord {
  status?: string;
  start_at?: string | null;
  order?: { id?: string };
}

/** The date window actually applied, echoed back to the caller in meta. */
export interface AppointmentDateFilter {
  start_date?: string;
  end_date?: string;
  timezone: string;
}

export async function listAppointments(
  env: AryeoApiEnv,
  input: ListAppointmentsInput,
): Promise<unknown> {
  const dateFilter = resolveDateFilter(input);
  const needsClientFilter =
    input.order_id !== undefined || input.status !== undefined || dateFilter !== undefined;

  // No filter at all: a plain paginated passthrough, unchanged from v2.1.x.
  if (!needsClientFilter) {
    return aryeoFetch(env, {
      method: "GET",
      path: "/appointments",
      query: {
        ...(input.page !== undefined ? { page: input.page } : {}),
        ...(input.per_page !== undefined ? { per_page: input.per_page } : {}),
      },
    });
  }

  const matchesDate = dateFilter ? buildDateMatcher(dateFilter) : undefined;

  const criteria = [
    input.order_id !== undefined ? `order_id=${input.order_id}` : undefined,
    input.status !== undefined ? `status=${input.status}` : undefined,
    dateFilter ? describeDateFilter(dateFilter) : undefined,
  ].filter((c): c is string => c !== undefined);

  const result = await listWithClientFilter<AppointmentRecord>(
    env,
    "/appointments",
    {},
    (appointment) => {
      if (input.status !== undefined && appointment.status !== input.status) return false;
      if (input.order_id !== undefined && appointment.order?.id !== input.order_id) return false;
      if (matchesDate !== undefined && !matchesDate(appointment)) return false;
      return true;
    },
    `Aryeo does not support filtering /appointments; ${criteria.join(", ")} applied client-side ` +
      `over a bounded scan of up to ${APPOINTMENT_SCAN_LIMIT} appointments.`,
  );

  // `page`/`per_page` address Aryeo's own pagination, which this branch does not
  // use — it walks the pages itself. Saying so beats silently ignoring them.
  const paginationIgnored = input.page !== undefined || input.per_page !== undefined;

  return {
    data: result.data,
    meta: {
      ...result.meta,
      // `count` is kept for callers written against v2.1.x; `records_matched`
      // is its self-describing name, to sit unambiguously beside
      // `records_scanned` when an agent has to judge whether to trust the list.
      records_matched: result.data.length,
      scan_limit: APPOINTMENT_SCAN_LIMIT,
      ...(dateFilter ? { date_filter: dateFilter } : {}),
      ...(paginationIgnored
        ? {
            pagination_note:
              "page/per_page were ignored: filtered requests walk Aryeo's pages internally. " +
              "Narrow the filter instead of paging.",
          }
        : {}),
    },
  };
}

/**
 * Normalise the requested window, or undefined when no date filtering was asked for.
 *
 * A lone `start_date` means that ONE day (matching get_available_timeslots,
 * where end_date likewise defaults to start_date). A lone `end_date` means
 * everything up to and including it. The range is inclusive at both ends.
 */
function resolveDateFilter(input: ListAppointmentsInput): AppointmentDateFilter | undefined {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;

  if (input.start_date === undefined && input.end_date === undefined) {
    // A timezone on its own filters nothing; ignore it rather than scanning.
    return undefined;
  }

  assertValidTimezone(timezone);

  const start = input.start_date;
  const end = input.end_date ?? input.start_date;
  if (start !== undefined) assertCalendarDate(start, "start_date");
  if (end !== undefined) assertCalendarDate(end, "end_date");

  if (start !== undefined && end !== undefined && end < start) {
    throw new ToolError({
      userMessage: "end_date must be on or after start_date.",
      internalMessage: `listAppointments: ${end} precedes ${start}`,
      status: 422,
      upstreamName: "Aryeo",
    });
  }

  return {
    ...(start !== undefined ? { start_date: start } : {}),
    ...(end !== undefined ? { end_date: end } : {}),
    timezone,
  };
}

/**
 * Build the per-record date test, constructing the Intl formatter ONCE rather
 * than per appointment — the scan can run to 500 records.
 *
 * Appointments with no usable `start_at` (UNSCHEDULED ones) never match a date
 * window: they are not on any day yet.
 */
function buildDateMatcher(filter: AppointmentDateFilter): (a: AppointmentRecord) => boolean {
  const formatter = createDateFormatter(filter.timezone);
  return (appointment) => {
    if (typeof appointment.start_at !== "string") return false;
    const localDate = formatLocalDate(formatter, appointment.start_at);
    if (localDate === null) return false;
    if (filter.start_date !== undefined && localDate < filter.start_date) return false;
    if (filter.end_date !== undefined && localDate > filter.end_date) return false;
    return true;
  };
}

function describeDateFilter(filter: AppointmentDateFilter): string {
  const window =
    filter.start_date !== undefined && filter.end_date !== undefined
      ? filter.start_date === filter.end_date
        ? filter.start_date
        : `${filter.start_date}..${filter.end_date}`
      : filter.start_date !== undefined
        ? `from ${filter.start_date}`
        : `up to ${filter.end_date}`;
  return `dates ${window} (${filter.timezone})`;
}

function createDateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * The calendar date an instant falls on in the formatter's timezone, as
 * YYYY-MM-DD — which compares correctly as a plain string.
 *
 * Assembled from formatToParts rather than a locale's format string, so the
 * result cannot shift with ICU locale data.
 */
function formatLocalDate(formatter: Intl.DateTimeFormat, isoTimestamp: string): string | null {
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) return null;

  let year = "";
  let month = "";
  let day = "";
  for (const part of formatter.formatToParts(new Date(parsed))) {
    if (part.type === "year") year = part.value.padStart(4, "0");
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
  }
  if (year === "" || month === "" || day === "") return null;
  return `${year}-${month}-${day}`;
}

/** Exported for tests: the local calendar date of an instant in `timeZone`. */
export function localDateInTimezone(isoTimestamp: string, timeZone: string): string | null {
  return formatLocalDate(createDateFormatter(timeZone), isoTimestamp);
}

function assertValidTimezone(timeZone: string): void {
  try {
    createDateFormatter(timeZone);
  } catch {
    throw new ToolError({
      userMessage:
        `timezone must be a valid IANA timezone name such as "Pacific/Auckland"; ` +
        `received "${timeZone}".`,
      internalMessage: `listAppointments: unsupported timeZone ${timeZone}`,
      status: 422,
      upstreamName: "Aryeo",
    });
  }
}

/**
 * Reject dates that are well-formed but not real (2026-02-31, 2026-13-01).
 *
 * The Zod schema only checks the YYYY-MM-DD shape. Date.parse alone is not
 * enough either: it rejects an impossible MONTH (2026-13-01 -> NaN) but rolls
 * an impossible DAY silently forward (2026-02-31 -> 2026-03-03), which would
 * quietly brief the wrong day. Comparing the round-trip catches both.
 */
function assertCalendarDate(value: string, field: string): void {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new ToolError({
      userMessage: `${field} must be a real calendar date in YYYY-MM-DD form; received "${value}".`,
      internalMessage: `listAppointments: unparseable ${field}=${value}`,
      status: 422,
      upstreamName: "Aryeo",
    });
  }
}

// VERIFIED 2026-07-27 — this endpoint's real contract, discovered from its own
// 422 body. It requires `timezone`, `date` (ONE day, not a range) and
// `interval`; `duration` sizes each returned slot. The previous
// start_date/end_date/order_id/region_id payload matched none of these, so
// every call 422'd (or 403'd when order_id was present) — the tool had never
// once succeeded. Measured on 2026-07-28 with interval=30:
//   duration=30  -> 8 slots, first 01:00-01:30Z
//   duration=60  -> 7 slots, first 01:00-02:00Z
//   duration=120 -> 5 slots, first 01:00-03:00Z
// Passing order_id to Aryeo returns 403, so an order's length is resolved
// locally via deriveOrderDuration() and sent as `duration`.
export interface GetAvailableTimeslotsInput {
  start_date: string;
  end_date?: string;
  duration: number;
  interval: number;
  timezone: string;
}

export interface TimeslotDay {
  date: string;
  slots: unknown[];
}

export interface AvailableTimeslotsResult {
  data: TimeslotDay[];
  meta: {
    duration_minutes: number;
    interval_minutes: number;
    timezone: string;
    days_queried: number;
    total_slots: number;
  };
}

interface TimeslotsPage {
  data?: unknown[];
}

export async function getAvailableTimeslots(
  env: AryeoApiEnv,
  input: GetAvailableTimeslotsInput,
): Promise<AvailableTimeslotsResult> {
  const dates = enumerateDates(input.start_date, input.end_date ?? input.start_date);
  const days: TimeslotDay[] = [];
  let totalSlots = 0;

  for (const date of dates) {
    const response = await aryeoFetch<TimeslotsPage>(env, {
      method: "GET",
      path: "/scheduling/available-timeslots",
      query: {
        timezone: input.timezone,
        date,
        interval: input.interval,
        duration: input.duration,
      },
    });
    const slots = response?.data ?? [];
    totalSlots += slots.length;
    days.push({ date, slots });
  }

  return {
    data: days,
    meta: {
      duration_minutes: input.duration,
      interval_minutes: input.interval,
      timezone: input.timezone,
      days_queried: dates.length,
      total_slots: totalSlots,
    },
  };
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new ToolError({
      userMessage: "start_date and end_date must be valid YYYY-MM-DD dates.",
      internalMessage: `enumerateDates: unparseable ${startDate}..${endDate}`,
      status: 422,
      upstreamName: "Aryeo",
    });
  }
  if (end < start) {
    throw new ToolError({
      userMessage: "end_date must be on or after start_date.",
      internalMessage: `enumerateDates: ${endDate} precedes ${startDate}`,
      status: 422,
      upstreamName: "Aryeo",
    });
  }

  const dayMs = 86_400_000;
  const spanDays = Math.floor((end - start) / dayMs) + 1;
  if (spanDays > MAX_TIMESLOT_DAYS) {
    throw new ToolError({
      userMessage:
        `Date range too wide: ${spanDays} days requested, maximum is ${MAX_TIMESLOT_DAYS}. ` +
        "Aryeo returns availability one day per request, so a wide range means one upstream " +
        "call per day. Narrow the range and call again.",
      internalMessage: `enumerateDates: span ${spanDays} exceeds ${MAX_TIMESLOT_DAYS}`,
      status: 422,
      upstreamName: "Aryeo",
    });
  }

  const dates: string[] = [];
  for (let t = start; t <= end; t += dayMs) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

// VERIFIED 2026-07-27 — POST /appointments/store has NO `duration` field. It
// requires `end_at`, and silently discards `duration`. Proof, same order:
//   {start_at, duration}        -> 422 {"end_at":["The end at field is required."]}
//   {start_at, end_at}          -> 422 only about the order's missing address
// The tool previously sent `duration` and omitted `end_at`, so EVERY booking
// attempt failed — and the client's error handling hid the reason behind the
// toolkit's generic "unprocessable entity" summary.
export interface CreateAppointmentInput {
  order_id: string;
  start_at: string;
  duration: number;
  notify_customer: boolean;
}

export async function createAppointment(
  env: AryeoApiEnv,
  input: CreateAppointmentInput,
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "POST",
    path: "/appointments/store",
    body: {
      order_id: input.order_id,
      start_at: input.start_at,
      end_at: addMinutes(input.start_at, input.duration),
      notify_customer: input.notify_customer,
    },
  });
}

/**
 * Add minutes to an ISO 8601 timestamp, PRESERVING the caller's UTC offset.
 *
 * Aryeo stores appointments against a listing in a local timezone, and the
 * account is Pacific/Auckland (UTC+12/+13 across DST). Formatting end_at as a
 * plain `toISOString()` would silently convert to Z — accepted by Aryeo, but it
 * makes the request harder to read and to diff against start_at in logs, so we
 * echo the offset the caller supplied.
 */
export function addMinutes(isoTimestamp: string, minutes: number): string {
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) {
    throw new ToolError({
      userMessage: `start_at is not a valid ISO 8601 timestamp: ${isoTimestamp}`,
      internalMessage: `addMinutes: unparseable ${isoTimestamp}`,
      status: 422,
      upstreamName: "Aryeo",
    });
  }

  const offsetMatch = /(Z|[+-]\d{2}:\d{2})$/.exec(isoTimestamp);
  const offset = offsetMatch?.[1];
  const shifted = new Date(parsed + minutes * 60_000);
  if (offset === undefined || offset === "Z") return shifted.toISOString();

  const sign = offset.startsWith("-") ? -1 : 1;
  const [hours, mins] = offset.slice(1).split(":").map(Number);
  const offsetMs = sign * ((hours ?? 0) * 60 + (mins ?? 0)) * 60_000;
  const local = new Date(shifted.getTime() + offsetMs).toISOString();
  return `${local.slice(0, 19)}${offset}`;
}

export interface RescheduleAppointmentInput {
  appointment_id: string;
  start_at: string;
  notify_customer: boolean;
}

export async function rescheduleAppointment(
  env: AryeoApiEnv,
  input: RescheduleAppointmentInput,
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "PUT",
    path: buildPath("/appointments/{appointmentId}/reschedule", {
      appointmentId: input.appointment_id,
    }),
    body: {
      start_at: input.start_at,
      notify_customer: input.notify_customer,
    },
  });
}

export interface CancelAppointmentInput {
  appointment_id: string;
  reason?: string;
  notify_customer: boolean;
}

export async function cancelAppointment(
  env: AryeoApiEnv,
  input: CancelAppointmentInput,
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "PUT",
    path: buildPath("/appointments/{appointmentId}/cancel", {
      appointmentId: input.appointment_id,
    }),
    body: {
      notify_customer: input.notify_customer,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    },
  });
}
