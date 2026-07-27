import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMinutes, createAppointment, getAvailableTimeslots } from "../../src/aryeo/appointments.js";
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

  it("falls back to an unambiguous price match when a product was renamed", async () => {
    stubFetch([
      [
        "/orders/",
        { data: { items: [{ title: "Old Package Name", quantity: 1, unit_price_amount: 38900 }] } },
      ],
      [
        "/products",
        {
          data: [{ title: "Renamed Package", variants: [{ duration: 75, price_amount: 38900 }] }],
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

  it("refuses a price match when two products share that price with different durations", async () => {
    stubFetch([
      [
        "/orders/",
        { data: { items: [{ title: "Unknown Title", quantity: 1, unit_price_amount: 74900 }] } },
      ],
      [
        "/products",
        {
          data: [
            { title: "Small Premium Package", variants: [{ duration: 120, price_amount: 74900 }] },
            { title: "Apartment Luxury Package", variants: [{ duration: 150, price_amount: 74900 }] },
          ],
          meta: { last_page: 1 },
        },
      ],
    ]);

    await expectUserMessage(deriveOrderDuration(ENV, ORDER_ID), /could not be matched/);
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
