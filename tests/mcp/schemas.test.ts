import { describe, expect, it } from "vitest";
import { toolSchemas, type ToolName } from "../../src/mcp/schemas.js";
import { toolDefinitions } from "../../src/mcp/tools.js";

const expectedTools: ToolName[] = [
  "list_listings",
  "get_listing",
  "list_orders",
  "get_order",
  "list_customers",
  "get_customer",
  "list_appointments",
  "get_available_timeslots",
  "create_appointment",
  "reschedule_appointment",
  "cancel_appointment",
  "list_products",
  "list_product_categories",
  "list_order_items",
  "get_order_item",
];

const VALID_UUID = "019de176-1c40-7347-b815-eb92c249b9f6";

describe("tool catalogue", () => {
  it("declares the expected 15 tools", () => {
    expect(toolDefinitions.length).toBe(expectedTools.length);
    const names = toolDefinitions.map((t) => t.name);
    for (const name of expectedTools) {
      expect(names).toContain(name);
    }
  });

  it("every tool has a non-empty description and an inputSchema with type object", () => {
    for (const t of toolDefinitions) {
      expect(t.description.length).toBeGreaterThan(20);
      const s = t.inputSchema as { type?: string; properties?: unknown };
      expect(s.type).toBe("object");
      expect(s.properties).toBeDefined();
    }
  });
});

describe("argument validation — listings", () => {
  it("rejects a lowercase status (live API uses uppercase)", () => {
    const result = toolSchemas.list_listings.safeParse({ status: "draft" });
    expect(result.success).toBe(false);
  });

  it("accepts an uppercase listing status from the verified set", () => {
    const result = toolSchemas.list_listings.safeParse({ status: "FOR_SALE" });
    expect(result.success).toBe(true);
  });

  it("rejects a path-traversal listing_id on get_listing", () => {
    const result = toolSchemas.get_listing.safeParse({ listing_id: "../orders" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid Aryeo UUID on get_listing", () => {
    const result = toolSchemas.get_listing.safeParse({ listing_id: VALID_UUID });
    expect(result.success).toBe(true);
  });
});

describe("argument validation — orders", () => {
  it("exposes three separate status fields on list_orders", () => {
    const result = toolSchemas.list_orders.safeParse({
      status: "CONFIRMED",
      payment_status: "PAID",
      fulfillment_status: "FULFILLED",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bad payment_status enum value", () => {
    const result = toolSchemas.list_orders.safeParse({ payment_status: "paid" });
    expect(result.success).toBe(false);
  });
});

describe("argument validation — appointments", () => {
  it("rejects a lowercase appointment status (live API uses uppercase, American spelling)", () => {
    const result = toolSchemas.list_appointments.safeParse({ status: "scheduled" });
    expect(result.success).toBe(false);
  });

  it("rejects the British spelling CANCELLED", () => {
    const result = toolSchemas.list_appointments.safeParse({ status: "CANCELLED" });
    expect(result.success).toBe(false);
  });

  it("accepts the American spelling CANCELED", () => {
    const result = toolSchemas.list_appointments.safeParse({ status: "CANCELED" });
    expect(result.success).toBe(true);
  });

  it("does not expose date filter fields on list_appointments (server-side filtering unsupported)", () => {
    // start_date and end_date should be rejected because the schema is strict.
    // (Aryeo silently ignores both server-side per 2026-05-18 verification.)
    const schema = toolSchemas.list_appointments;
    // Asserting via a positive test — the schema does not declare these fields.
    const props = Object.keys(schema.shape);
    expect(props).not.toContain("start_date");
    expect(props).not.toContain("end_date");
    expect(props).not.toContain("start_at_gte");
    expect(props).not.toContain("start_at_lte");
  });

  it("rejects out-of-range duration on create_appointment", () => {
    const result = toolSchemas.create_appointment.safeParse({
      order_id: VALID_UUID,
      start_at: "2026-06-01T10:00:00+12:00",
      duration: 9999,
    });
    expect(result.success).toBe(false);
  });

  it("defaults notify_customer to true on cancel_appointment", () => {
    const result = toolSchemas.cancel_appointment.safeParse({ appointment_id: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notify_customer).toBe(true);
  });
});

describe("argument validation — products", () => {
  it("rejects a bad product type", () => {
    const result = toolSchemas.list_products.safeParse({ type: "main" });
    expect(result.success).toBe(false);
  });

  it("accepts MAIN and ADDON", () => {
    expect(toolSchemas.list_products.safeParse({ type: "MAIN" }).success).toBe(true);
    expect(toolSchemas.list_products.safeParse({ type: "ADDON" }).success).toBe(true);
  });
});

describe("argument validation — includes", () => {
  it("rejects an include with uppercase characters", () => {
    const result = toolSchemas.get_order.safeParse({
      order_id: VALID_UUID,
      include: ["Customer"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts dotted include paths like 'order.address'", () => {
    const result = toolSchemas.get_order_item.safeParse({
      order_item_id: VALID_UUID,
      include: ["order.address", "appointment"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 10 includes", () => {
    const result = toolSchemas.list_orders.safeParse({
      include: Array.from({ length: 11 }, (_, i) => `relation_${i}`),
    });
    expect(result.success).toBe(false);
  });
});
