import type { AryeoApiEnv } from "../env.js";
import type { AppointmentStatus } from "../constants.js";
import { aryeoFetch, includeParam } from "./client.js";
import { buildPath } from "./path.js";

// VERIFIED 2026-05-18: Aryeo's GET /appointments silently ignores every
// date-filter variant we tested (start_date, end_date, start_at_gte,
// start_at_lte). Server-side date filtering is unsupported. Callers must
// filter client-side after fetching. The schema therefore omits date params.
export interface ListAppointmentsInput {
  order_id?: string;
  status?: AppointmentStatus;
  page?: number;
  per_page?: number;
  include?: string[];
}

export async function listAppointments(
  env: AryeoApiEnv,
  input: ListAppointmentsInput,
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "GET",
    path: "/appointments",
    query: {
      ...(input.order_id !== undefined ? { order_id: input.order_id } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.page !== undefined ? { page: input.page } : {}),
      ...(input.per_page !== undefined ? { per_page: input.per_page } : {}),
      ...(includeParam(input.include) !== undefined
        ? { include: includeParam(input.include) }
        : {}),
    },
  });
}

export interface GetAvailableTimeslotsInput {
  start_date: string;
  end_date: string;
  order_id?: string;
  region_id?: string;
}

export async function getAvailableTimeslots(
  env: AryeoApiEnv,
  input: GetAvailableTimeslotsInput,
): Promise<unknown> {
  return aryeoFetch(env, {
    method: "GET",
    path: "/scheduling/available-timeslots",
    query: {
      start_date: input.start_date,
      end_date: input.end_date,
      ...(input.order_id !== undefined ? { order_id: input.order_id } : {}),
      ...(input.region_id !== undefined ? { region_id: input.region_id } : {}),
    },
  });
}

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
      duration: input.duration,
      notify_customer: input.notify_customer,
    },
  });
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
