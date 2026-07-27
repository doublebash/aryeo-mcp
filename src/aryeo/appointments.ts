import { ToolError } from "@bashco/mcp-toolkit";
import type { AryeoApiEnv } from "../env.js";
import type { AppointmentStatus } from "../constants.js";
import { MAX_TIMESLOT_DAYS } from "../constants.js";
import { aryeoFetch, includeParam, listWithClientFilter } from "./client.js";
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
export interface ListAppointmentsInput {
  order_id?: string;
  status?: AppointmentStatus;
  page?: number;
  per_page?: number;
  include?: string[];
}

interface AppointmentRecord {
  status?: string;
  order?: { id?: string };
}

export async function listAppointments(
  env: AryeoApiEnv,
  input: ListAppointmentsInput,
): Promise<unknown> {
  const include = includeParam(input.include);
  const needsClientFilter = input.order_id !== undefined || input.status !== undefined;

  if (!needsClientFilter) {
    return aryeoFetch(env, {
      method: "GET",
      path: "/appointments",
      query: {
        ...(input.page !== undefined ? { page: input.page } : {}),
        ...(input.per_page !== undefined ? { per_page: input.per_page } : {}),
        ...(include !== undefined ? { include } : {}),
      },
    });
  }

  const criteria = [
    input.order_id !== undefined ? `order_id=${input.order_id}` : undefined,
    input.status !== undefined ? `status=${input.status}` : undefined,
  ].filter(Boolean);

  return listWithClientFilter<AppointmentRecord>(
    env,
    "/appointments",
    { ...(include !== undefined ? { include } : {}) },
    (appointment) => {
      if (input.status !== undefined && appointment.status !== input.status) return false;
      if (input.order_id !== undefined && appointment.order?.id !== input.order_id) return false;
      return true;
    },
    `Aryeo does not support filtering /appointments; ${criteria.join(" and ")} applied client-side.`,
  );
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
