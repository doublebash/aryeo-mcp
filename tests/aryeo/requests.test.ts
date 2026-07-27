import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMinutes,
  createAppointment,
  getAvailableTimeslots,
  listAppointments,
  localDateInTimezone,
} from "../../src/aryeo/appointments.js";
import { listCustomers } from "../../src/aryeo/customers.js";
import { deriveOrderDuration } from "../../src/aryeo/duration.js";
import { listOrders } from "../../src/aryeo/orders.js";

// These tests assert on the REQUESTS THE SERVER ACTUALLY SENDS.
//
// The schema tests in mcp/schemas.test.ts cannot catch the class of bug this
// suite exists for: every scheduling and filtering defect found on 2026-07-27
// was a mismatch between our payload and Aryeo's contract, and the schemas were
// internally consistent the whole time. A test that only parses its own Zod
// objects will pass just as happily against a payload Aryeo rejects.

const ENV = { ARYEO_API_KEY: "test-key" };

interface Captured {
  url: URL;
  method: string;
  body: Record<string, unknown> | undefined;
}

let captured: Captured[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Route responses by URL substring; records every outgoing request. */
function stubFetch(routes: Array<[string, unknown]>, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      captured.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      });
      const match = routes.find(([fragment]) => url.pathname.includes(fragment));
      return Promise.resolve(jsonResponse(match ? match[1] : { data: [] }, status));
    }),
  );
}

/**
 * Assert on a ToolError's `userMessage` — the text Claude actually receives.
 * `expect(...).toThrow()` matches Error.message, which for ToolError is the
 * INTERNAL message. Asserting on that would let a useless user-facing message
 * pass, which is precisely the failure this suite is guarding against.
 */
async function expectUserMessage(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const userMessage = (err as { userMessage?: string }).userMessage;
    expect(userMessage, "error should expose a userMessage").toBeDefined();
    expect(userMessage).toMatch(pattern);
    return;
  }
  throw new Error("expected the call to reject, but it resolved");
}

beforeEach(() => {
  captured = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("filter syntax — Aryeo ignores flat params, so we must send filter[...]", () => {
  it("sends filter[search], never a flat search param", async () => {
    stubFetch([["/customers", { data: [] }]]);
    await listCustomers(ENV, { search: "Michelle" });

    const query = captured[0]!.url.searchParams;
    expect(query.get("filter[search]")).toBe("michelle");
    expect(query.has("search")).toBe(false);
  });

  it("lowercases order filter enums — Aryeo rejects filter[payment_status]=PAID", async () => {
    stubFetch([["/orders", { data: [] }]]);
    await listOrders(ENV, { status: "OPEN", payment_status: "PAID" });

    const query = captured[0]!.url.searchParams;
    expect(query.get("filter[status]")).toBe("open");
    expect(query.get("filter[payment_status]")).toBe("paid");
    expect(query.has("payment_status")).toBe(false);
  });
});

describe("create_appointment — Aryeo takes end_at, not duration", () => {
  it("sends end_at and omits duration entirely", async () => {
    stubFetch([["/appointments/store", { data: { id: "appt" } }]]);
    await createAppointment(ENV, {
      order_id: "019de176-1c40-7347-b815-eb92c249b9f6",
      start_at: "2026-08-17T10:00:00+12:00",
      duration: 75,
      notify_customer: false,
    });

    const body = captured[0]!.body!;
    expect(body.end_at).toBe("2026-08-17T11:15:00+12:00");
    expect(body.duration).toBeUndefined();
    expect(body.start_at).toBe("2026-08-17T10:00:00+12:00");
  });
});

describe("addMinutes", () => {
  it("preserves the caller's UTC offset rather than flipping to Z", () => {
    expect(addMinutes("2026-08-17T10:00:00+12:00", 75)).toBe("2026-08-17T11:15:00+12:00");
  });

  it("rolls over midnight correctly", () => {
    expect(addMinutes("2026-08-17T23:30:00+12:00", 60)).toBe("2026-08-18T00:30:00+12:00");
  });

  it("keeps Z timestamps in Z", () => {
    expect(addMinutes("2026-08-17T10:00:00Z", 30)).toBe("2026-08-17T10:30:00.000Z");
  });

  it("handles negative offsets", () => {
    expect(addMinutes("2026-08-17T10:00:00-05:00", 120)).toBe("2026-08-17T12:00:00-05:00");
  });

  it("rejects an unparseable timestamp instead of sending NaN upstream", () => {
    expect(() => addMinutes("not-a-date", 60)).toThrow();
  });
});

describe("get_available_timeslots — real parameter contract", () => {
  it("sends timezone/date/interval/duration, and never start_date or order_id", async () => {
    stubFetch([["/scheduling/available-timeslots", { data: [{ start_at: "x" }] }]]);
    await getAvailableTimeslots(ENV, {
      start_date: "2026-08-17",
      duration: 120,
      interval: 15,
      timezone: "Pacific/Auckland",
    });

    const query = captured[0]!.url.searchParams;
    expect(query.get("timezone")).toBe("Pacific/Auckland");
    expect(query.get("date")).toBe("2026-08-17");
    expect(query.get("interval")).toBe("15");
    expect(query.get("duration")).toBe("120");
    // order_id returns 403 from this endpoint; it must never be forwarded.
    expect(query.has("order_id")).toBe(false);
    expect(query.has("start_date")).toBe(false);
  });

  it("issues one request per day across a range", async () => {
    stubFetch([["/scheduling/available-timeslots", { data: [] }]]);
    const result = await getAvailableTimeslots(ENV, {
      start_date: "2026-08-17",
      end_date: "2026-08-19",
      duration: 60,
      interval: 30,
      timezone: "Pacific/Auckland",
    });

    expect(captured).toHaveLength(3);
    expect(captured.map((c) => c.url.searchParams.get("date"))).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
    ]);
    expect(result.meta.days_queried).toBe(3);
  });

  it("refuses a range wider than the day cap rather than firing 90 requests", async () => {
    stubFetch([["/scheduling/available-timeslots", { data: [] }]]);
    await expectUserMessage(
      getAvailableTimeslots(ENV, {
        start_date: "2026-08-01",
        end_date: "2026-10-30",
        duration: 60,
        interval: 30,
        timezone: "Pacific/Auckland",
      }),
      /maximum is 14/,
    );
    expect(captured).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// list_appointments — the daily-briefing path.
//
// Two production failures are pinned here. (1) The tool advertised `include`
// values Aryeo rejects with a 400. (2) Retrying without them returned 1.4 MB
// of appointments, which the client truncated. Both are why filtering happens
// in the Worker, over a bounded scan, with honest metadata.
// ---------------------------------------------------------------------------

const ORDER_A = "019de176-1c40-7347-b815-eb92c249b9f6";
const ORDER_B = "019de176-1c40-7347-b815-eb92c249b9f7";

interface ApptStub {
  id: string;
  start_at: string | null;
  status: string;
  order: { id: string };
}

function appt(
  id: string,
  start_at: string | null,
  status = "SCHEDULED",
  orderId = ORDER_A,
): ApptStub {
  return { id, start_at, status, order: { id: orderId } };
}

/** Stub GET /appointments with real Aryeo pagination meta, one entry per page. */
function stubAppointmentPages(pages: ApptStub[][], lastPage = pages.length): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      captured.push({ url, method: init?.method ?? "GET", body: undefined });
      const page = Number(url.searchParams.get("page") ?? "1");
      const data = pages[page - 1] ?? [];
      return Promise.resolve(
        jsonResponse({
          data,
          meta: { current_page: page, last_page: lastPage, total: pages.flat().length },
        }),
      );
    }),
  );
}

interface FilteredResult {
  data: ApptStub[];
  meta: {
    count: number;
    records_scanned: number;
    records_matched: number;
    pages_scanned: number;
    scan_limit: number;
    truncated: boolean;
    filter_note: string;
    date_filter?: { start_date?: string; end_date?: string; timezone: string };
    pagination_note?: string;
  };
}

describe("localDateInTimezone — Aryeo returns UTC, briefings are asked in local time", () => {
  it("rolls a 21:30Z appointment onto the NEXT day in Pacific/Auckland", () => {
    // Real record from the live account: 40% of appointments on this account
    // sit on a different local day than their UTC prefix reads.
    expect(localDateInTimezone("2026-08-09T21:30:00Z", "Pacific/Auckland")).toBe("2026-08-10");
  });

  it("handles the NZST (+12) midnight boundary in both directions", () => {
    expect(localDateInTimezone("2026-07-27T11:59:00Z", "Pacific/Auckland")).toBe("2026-07-27");
    expect(localDateInTimezone("2026-07-27T12:00:00Z", "Pacific/Auckland")).toBe("2026-07-28");
  });

  it("honours NZDT (+13) in summer rather than a fixed offset", () => {
    // If this used a hardcoded +12 it would answer 2026-01-15.
    expect(localDateInTimezone("2026-01-15T11:00:00Z", "Pacific/Auckland")).toBe("2026-01-16");
  });

  it("returns the same day for a UTC-noon instant, and differs from UTC slicing", () => {
    expect(localDateInTimezone("2026-07-30T00:00:00Z", "Pacific/Auckland")).toBe("2026-07-30");
  });

  it("returns null for an unparseable timestamp instead of throwing mid-scan", () => {
    expect(localDateInTimezone("not-a-date", "Pacific/Auckland")).toBeNull();
  });
});

describe("list_appointments — Worker-side date filtering", () => {
  it("returns ONLY the requested day, in Pacific/Auckland, not the whole scan", async () => {
    stubAppointmentPages([
      [
        appt("prev-day", "2026-07-27T11:59:00Z"), // NZ 27th, excluded
        appt("target-early", "2026-07-27T12:00:00Z"), // NZ 28th 00:00, included
        appt("target-late", "2026-07-28T10:59:00Z"), // NZ 28th 22:59, included
        appt("next-day", "2026-07-28T12:00:00Z"), // NZ 29th, excluded
      ],
    ]);

    const result = (await listAppointments(ENV, {
      start_date: "2026-07-28",
      end_date: "2026-07-28",
      timezone: "Pacific/Auckland",
    })) as FilteredResult;

    expect(result.data.map((a) => a.id)).toEqual(["target-early", "target-late"]);
    // The whole point: the caller must not receive the 4 scanned records.
    expect(result.data).toHaveLength(2);
    expect(result.meta.records_scanned).toBe(4);
    expect(result.meta.records_matched).toBe(2);
  });

  it("treats the range as inclusive at both ends", async () => {
    stubAppointmentPages([
      [
        appt("before", "2026-07-28T11:00:00Z"), // NZ 28th
        appt("first", "2026-07-28T12:00:00Z"), // NZ 29th — lower bound
        appt("middle", "2026-07-30T02:00:00Z"), // NZ 30th
        appt("last", "2026-07-31T10:00:00Z"), // NZ 31st — upper bound
        appt("after", "2026-07-31T12:00:00Z"), // NZ Aug 1st
      ],
    ]);

    const result = (await listAppointments(ENV, {
      start_date: "2026-07-29",
      end_date: "2026-07-31",
      timezone: "Pacific/Auckland",
    })) as FilteredResult;

    expect(result.data.map((a) => a.id)).toEqual(["first", "middle", "last"]);
  });

  it("treats a lone start_date as that single day", async () => {
    stubAppointmentPages([
      [appt("on-day", "2026-07-28T02:00:00Z"), appt("next-day", "2026-07-29T02:00:00Z")],
    ]);

    const result = (await listAppointments(ENV, { start_date: "2026-07-28" })) as FilteredResult;

    expect(result.data.map((a) => a.id)).toEqual(["on-day"]);
    expect(result.meta.date_filter).toEqual({
      start_date: "2026-07-28",
      end_date: "2026-07-28",
      timezone: "Pacific/Auckland",
    });
  });

  it("defaults to Pacific/Auckland and honours an explicit timezone instead", async () => {
    const page = [appt("edge", "2026-07-27T12:00:00Z")]; // NZ 28th, UTC 27th
    stubAppointmentPages([page]);
    const nz = (await listAppointments(ENV, { start_date: "2026-07-28" })) as FilteredResult;
    expect(nz.data).toHaveLength(1);

    vi.unstubAllGlobals();
    captured = [];
    stubAppointmentPages([page]);
    const utc = (await listAppointments(ENV, {
      start_date: "2026-07-28",
      timezone: "UTC",
    })) as FilteredResult;
    expect(utc.data).toHaveLength(0);
    expect(utc.meta.date_filter?.timezone).toBe("UTC");
  });

  it("never sends date params upstream — Aryeo ignores them", async () => {
    stubAppointmentPages([[appt("a", "2026-07-28T02:00:00Z")]]);
    await listAppointments(ENV, {
      start_date: "2026-07-28",
      end_date: "2026-07-28",
      timezone: "Pacific/Auckland",
    });

    const query = captured[0]!.url.searchParams;
    for (const param of [
      "start_date",
      "end_date",
      "timezone",
      "filter[start_date]",
      "filter[end_date]",
    ]) {
      expect(query.has(param), `${param} must not be sent upstream`).toBe(false);
    }
  });

  it("never sends an include param — Aryeo 400s on the ones agents reach for", async () => {
    stubAppointmentPages([[appt("a", "2026-07-28T02:00:00Z")]]);
    // The production failure: include=customer,listing,address,agents -> 400.
    await listAppointments(ENV, {
      start_date: "2026-07-28",
      ...({ include: ["customer", "listing", "address", "agents"] } as Record<string, unknown>),
    });

    expect(captured[0]!.url.searchParams.has("include")).toBe(false);
  });

  it("excludes appointments with no start_at — they are not on any day yet", async () => {
    stubAppointmentPages([
      [appt("unscheduled", null, "UNSCHEDULED"), appt("scheduled", "2026-07-28T02:00:00Z")],
    ]);

    const result = (await listAppointments(ENV, { start_date: "2026-07-28" })) as FilteredResult;
    expect(result.data.map((a) => a.id)).toEqual(["scheduled"]);
  });

  it("combines date, status and order filters", async () => {
    stubAppointmentPages([
      [
        appt("match", "2026-07-28T02:00:00Z", "SCHEDULED", ORDER_A),
        appt("wrong-status", "2026-07-28T03:00:00Z", "CANCELED", ORDER_A),
        appt("wrong-order", "2026-07-28T04:00:00Z", "SCHEDULED", ORDER_B),
        appt("wrong-day", "2026-07-29T02:00:00Z", "SCHEDULED", ORDER_A),
      ],
    ]);

    const result = (await listAppointments(ENV, {
      start_date: "2026-07-28",
      end_date: "2026-07-28",
      status: "SCHEDULED",
      order_id: ORDER_A,
    })) as FilteredResult;

    expect(result.data.map((a) => a.id)).toEqual(["match"]);
  });
});

describe("list_appointments — bounded scan metadata", () => {
  it("reports scanned, matched and truncated:false for a scan that completed", async () => {
    stubAppointmentPages([
      [appt("a", "2026-07-28T02:00:00Z"), appt("b", "2026-07-29T02:00:00Z")],
    ]);

    const result = (await listAppointments(ENV, { start_date: "2026-07-28" })) as FilteredResult;

    expect(result.meta.records_scanned).toBe(2);
    expect(result.meta.records_matched).toBe(1);
    expect(result.meta.count).toBe(1);
    expect(result.meta.pages_scanned).toBe(1);
    expect(result.meta.truncated).toBe(false);
    expect(result.meta.scan_limit).toBe(500);
    expect(result.meta.filter_note).toMatch(/applied client-side/);
  });

  it("stops at the 500-record cap and flags truncated when more pages exist", async () => {
    // 8 pages of 100 available; the walk must cover only 5 and admit it.
    const pages = Array.from({ length: 8 }, (_, p) =>
      Array.from({ length: 100 }, (_, i) => appt(`p${p}-${i}`, "2026-07-29T02:00:00Z")),
    );
    stubAppointmentPages(pages, 8);

    const result = (await listAppointments(ENV, { start_date: "2026-07-28" })) as FilteredResult;

    expect(captured).toHaveLength(5);
    expect(result.meta.pages_scanned).toBe(5);
    expect(result.meta.records_scanned).toBe(500);
    expect(result.meta.truncated).toBe(true);
    // Nothing matched the requested day, and the result must not pretend the
    // account has no shoots that day — truncated says the scan fell short.
    expect(result.data).toHaveLength(0);
  });

  it("echoes the applied date window and timezone in meta", async () => {
    stubAppointmentPages([[appt("a", "2026-07-28T02:00:00Z")]]);
    const result = (await listAppointments(ENV, {
      start_date: "2026-07-28",
      end_date: "2026-07-30",
      timezone: "Pacific/Auckland",
    })) as FilteredResult;

    expect(result.meta.date_filter).toEqual({
      start_date: "2026-07-28",
      end_date: "2026-07-30",
      timezone: "Pacific/Auckland",
    });
    expect(result.meta.filter_note).toContain("Pacific/Auckland");
  });

  it("omits date_filter when only non-date filters were used", async () => {
    stubAppointmentPages([[appt("a", "2026-07-28T02:00:00Z", "SCHEDULED", ORDER_A)]]);
    const result = (await listAppointments(ENV, { order_id: ORDER_A })) as FilteredResult;

    expect(result.meta.date_filter).toBeUndefined();
    expect(result.meta.records_matched).toBe(1);
  });

  it("says so when page/per_page are supplied alongside a filter", async () => {
    stubAppointmentPages([[appt("a", "2026-07-28T02:00:00Z")]]);
    const result = (await listAppointments(ENV, {
      start_date: "2026-07-28",
      page: 3,
      per_page: 10,
    })) as FilteredResult;

    expect(result.meta.pagination_note).toMatch(/ignored/);
    // The scan owns pagination; the caller's page must not leak upstream.
    expect(captured[0]!.url.searchParams.get("page")).toBe("1");
    expect(captured[0]!.url.searchParams.get("per_page")).toBe("100");
  });

  it("leaves the unfiltered call as a plain passthrough, with no scan", async () => {
    stubAppointmentPages([[appt("a", "2026-07-28T02:00:00Z")]]);
    const result = (await listAppointments(ENV, { page: 2, per_page: 25 })) as {
      data: ApptStub[];
      meta?: { records_scanned?: number };
    };

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url.searchParams.get("page")).toBe("2");
    expect(captured[0]!.url.searchParams.get("per_page")).toBe("25");
    expect(result.meta?.records_scanned).toBeUndefined();
  });
});

describe("list_appointments — input validation", () => {
  it("rejects an invalid IANA timezone before making any upstream call", async () => {
    stubAppointmentPages([[]]);
    await expectUserMessage(
      listAppointments(ENV, { start_date: "2026-07-28", timezone: "Mars/Olympus_Mons" }),
      /valid IANA timezone/,
    );
    expect(captured).toHaveLength(0);
  });

  it("accepts a non-default IANA timezone", async () => {
    stubAppointmentPages([[appt("a", "2026-07-28T02:00:00Z")]]);
    const result = (await listAppointments(ENV, {
      start_date: "2026-07-28",
      timezone: "Australia/Sydney",
    })) as FilteredResult;
    expect(result.meta.date_filter?.timezone).toBe("Australia/Sydney");
  });

  it("rejects end_date before start_date", async () => {
    stubAppointmentPages([[]]);
    await expectUserMessage(
      listAppointments(ENV, { start_date: "2026-07-28", end_date: "2026-07-01" }),
      /end_date must be on or after start_date/,
    );
    expect(captured).toHaveLength(0);
  });

  it("rejects a well-formed but impossible calendar date", async () => {
    stubAppointmentPages([[]]);
    // 2026-13-01 fails Date.parse outright; 2026-02-31 does NOT — it rolls
    // forward to 2026-03-03, so an unguarded implementation would silently
    // brief the wrong day rather than complain.
    await expectUserMessage(listAppointments(ENV, { end_date: "2026-13-01" }), /real calendar date/);
    await expectUserMessage(
      listAppointments(ENV, { start_date: "2026-02-31" }),
      /real calendar date/,
    );
    await expectUserMessage(listAppointments(ENV, { start_date: "2026-07-32" }), /real calendar date/);
    expect(captured).toHaveLength(0);
  });

  it("supports an open-ended 'up to this date' window", async () => {
    stubAppointmentPages([
      [appt("old", "2026-07-01T02:00:00Z"), appt("future", "2026-09-01T02:00:00Z")],
    ]);
    const result = (await listAppointments(ENV, { end_date: "2026-07-28" })) as FilteredResult;

    expect(result.data.map((a) => a.id)).toEqual(["old"]);
    expect(result.meta.date_filter?.start_date).toBeUndefined();
  });

  it("does not trigger a scan when only a timezone is supplied", async () => {
    stubAppointmentPages([[appt("a", "2026-07-28T02:00:00Z")]]);
    const result = (await listAppointments(ENV, { timezone: "Pacific/Auckland" })) as {
      meta?: { records_scanned?: number };
    };
    expect(result.meta?.records_scanned).toBeUndefined();
  });
});

describe("error surfacing — Aryeo puts validation detail under `data`", () => {
  it("surfaces field errors instead of a bare 'unprocessable entity'", async () => {
    stubFetch(
      [["/customers", { status: "fail", data: { end_at: ["The end at field is required."] } }]],
      422,
    );

    // Must be checked on userMessage: the raw body always appears in the
    // internal message, so asserting there would pass even unfixed.
    await expectUserMessage(listCustomers(ENV, {}), /The end at field is required/);
  });
});

describe("deriveOrderDuration — the product timings actually reaching the calendar", () => {
  const ORDER_ID = "019de176-1c40-7347-b815-eb92c249b9f6";

  it("sums variant durations across items, multiplied by quantity", async () => {
    stubFetch([
      [
        "/orders/",
        {
          data: {
            items: [
              { title: "Small Essentials Listing Package", quantity: 1, unit_price_amount: 38900 },
              { title: "Dusk Photography Add-On", quantity: 2, unit_price_amount: 15500 },
            ],
          },
        },
      ],
      [
        "/products",
        {
          data: [
            {
              title: "Small Essentials Listing Package",
              variants: [{ duration: 75, price_amount: 38900 }],
            },
            {
              title: "Dusk Photography Add-On",
              variants: [{ duration: 30, price_amount: 15500 }],
            },
          ],
          meta: { last_page: 1 },
        },
      ],
    ]);

    const result = await deriveOrderDuration(ENV, ORDER_ID);
    expect(result.duration).toBe(135); // 75 + (30 x 2)
    expect(result.breakdown).toHaveLength(2);
  });

  it("ignores canceled line items", async () => {
    stubFetch([
      [
        "/orders/",
        {
          data: {
            items: [
              { title: "Small Essentials Listing Package", quantity: 1, unit_price_amount: 38900 },
              {
                title: "Large Property Video",
                quantity: 1,
                unit_price_amount: 41900,
                is_canceled: true,
              },
            ],
          },
        },
      ],
      [
        "/products",
        {
          data: [
            {
              title: "Small Essentials Listing Package",
              variants: [{ duration: 75, price_amount: 38900 }],
            },
            { title: "Large Property Video", variants: [{ duration: 60, price_amount: 41900 }] },
          ],
          meta: { last_page: 1 },
        },
      ],
    ]);

    expect((await deriveOrderDuration(ENV, ORDER_ID)).duration).toBe(75);
  });

  it("NEVER matches on price alone — an equal price is a coincidence, not a match", async () => {
    // Regression guard for a real defect found on 2026-07-27. Order #1067
    // "Kitchen Photogaphy" ($250) price-matched the product "Small Apartment
    // Video" ($250, 45 min) — an unrelated service — and would have booked a
    // 45-minute slot on the strength of two numbers being equal.
    stubFetch([
      [
        "/orders/",
        { data: { items: [{ title: "Kitchen Photogaphy", quantity: 1, unit_price_amount: 25000 }] } },
      ],
      [
        "/products",
        {
          data: [{ title: "Small Apartment Video", variants: [{ duration: 45, price_amount: 25000 }] }],
          meta: { last_page: 1 },
        },
      ],
    ]);

    await expectUserMessage(deriveOrderDuration(ENV, ORDER_ID), /do not match any product title/);
  });

  it("matches titles case-insensitively", async () => {
    stubFetch([
      [
        "/orders/",
        {
          data: {
            items: [
              { title: "small essentials listing package", quantity: 1, unit_price_amount: 38900 },
            ],
          },
        },
      ],
      [
        "/products",
        {
          data: [
            {
              title: "Small Essentials Listing Package",
              variants: [{ duration: 75, price_amount: 38900 }],
            },
          ],
          meta: { last_page: 1 },
        },
      ],
    ]);

    expect((await deriveOrderDuration(ENV, ORDER_ID)).duration).toBe(75);
  });

  it("FAILS rather than under-counting when an item cannot be matched", async () => {
    stubFetch([
      [
        "/orders/",
        {
          data: {
            items: [
              { title: "Small Essentials Listing Package", quantity: 1, unit_price_amount: 38900 },
              { title: "Mystery Service", quantity: 1, unit_price_amount: 999 },
            ],
          },
        },
      ],
      [
        "/products",
        {
          data: [
            {
              title: "Small Essentials Listing Package",
              variants: [{ duration: 75, price_amount: 38900 }],
            },
          ],
          meta: { last_page: 1 },
        },
      ],
    ]);

    // Silently booking 75 minutes here would leave a real shoot short.
    await expect(deriveOrderDuration(ENV, ORDER_ID)).rejects.toThrow(/Mystery Service/);
  });

  it("names the offending free-text titles so the caller can act on the failure", async () => {
    // Hand-typed admin orders look like this — 26 of 27 live orders do.
    stubFetch([
      [
        "/orders/",
        { data: { items: [{ title: "Photos + Short Video", quantity: 1, unit_price_amount: 27900 }] } },
      ],
      [
        "/products",
        {
          data: [
            {
              title: "Small Essentials Listing Package",
              variants: [{ duration: 75, price_amount: 38900 }],
            },
          ],
          meta: { last_page: 1 },
        },
      ],
    ]);

    await expectUserMessage(deriveOrderDuration(ENV, ORDER_ID), /"Photos \+ Short Video"/);
  });

  it("fails clearly when every product on the order is a 0-minute edit-only service", async () => {
    stubFetch([
      [
        "/orders/",
        { data: { items: [{ title: "Virtual Staging - Per Room", quantity: 3, unit_price_amount: 4500 }] } },
      ],
      [
        "/products",
        {
          data: [
            { title: "Virtual Staging - Per Room", variants: [{ duration: 0, price_amount: 4500 }] },
          ],
          meta: { last_page: 1 },
        },
      ],
    ]);

    await expect(deriveOrderDuration(ENV, ORDER_ID)).rejects.toThrow(/0 minutes/);
  });
});
