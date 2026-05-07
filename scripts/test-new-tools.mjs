// Live smoke test for the four newly-added Aryeo MCP tools.
//
// Reads ARYEO_API_KEY from the environment. Local development can do:
//   export ARYEO_API_KEY=$(grep '^ARYEO_API_KEY=' .dev.vars | cut -d= -f2-)
//   node scripts/test-new-tools.mjs
//
// Each call hits the real Aryeo API. The script prints the HTTP status, a one-line
// shape summary (top-level keys + count), and a PASS/FAIL marker per check from the
// prompt's test plan.

const BASE = "https://api.aryeo.com/v1";
const KEY = process.env.ARYEO_API_KEY;

if (!KEY || KEY === "your_api_key_here" || KEY === "your_aryeo_api_key_here") {
  console.error("ARYEO_API_KEY not set (or is the placeholder). Aborting.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${KEY}`,
  Accept: "application/json",
};

async function call(label, path) {
  const url = `${BASE}${path}`;
  const r = await fetch(url, { headers });
  let body;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  const topKeys = body && typeof body === "object" ? Object.keys(body).join(",") : "<non-json>";
  const dataLen = Array.isArray(body?.data) ? body.data.length : body?.data ? 1 : 0;
  console.log(`[${r.ok ? "OK " : "ERR"}] ${r.status} ${label}\n      ${url}\n      keys=${topKeys} data.len=${dataLen}`);
  return { ok: r.ok, status: r.status, body };
}

console.log("=== list_products: default ===");
await call("list_products()", "/products?per_page=5");

console.log("\n=== list_products: type=MAIN (flat) ===");
await call("list_products(type=MAIN)", "/products?type=MAIN&per_page=5");

console.log("\n=== list_products: type=ADDON (flat) ===");
await call("list_products(type=ADDON)", "/products?type=ADDON&per_page=5");

console.log("\n=== list_products: include=categories (verified-allowed) ===");
await call(
  "list_products(include=categories)",
  "/products?per_page=3&include=categories"
);

console.log("\n=== list_products: include_inactive=true ===");
await call(
  "list_products(active=false → include_inactive=true)",
  "/products?include_inactive=true&per_page=3"
);

console.log("\n=== list_product_categories ===");
await call("list_product_categories()", "/product-categories?per_page=5");

// get_product was removed — Aryeo has no GET /products/{id} endpoint (confirmed 404 live).

console.log("\n=== list_order_items: pick first order id and refetch with include=items ===");
const ordersResp = await fetch(`${BASE}/orders?per_page=1&include=items`, { headers });
const ordersBody = await ordersResp.json().catch(() => ({}));
const firstOrderId = ordersBody?.data?.[0]?.id;
let firstItemId;
if (firstOrderId) {
  const r = await call(
    `list_order_items(${firstOrderId})`,
    `/orders/${firstOrderId}?include=items`
  );
  firstItemId = r.body?.data?.items?.[0]?.id;
} else {
  console.log("      (skipped — no orders available to dereference)");
}

console.log("\n=== get_order_item: pick first line item id and refetch ===");
if (firstItemId) {
  await call(`get_order_item(${firstItemId})`, `/order-items/${firstItemId}`);
} else {
  console.log("      (skipped — no order item id available to dereference)");
}
