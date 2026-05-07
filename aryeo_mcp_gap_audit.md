# Aryeo MCP — Gap Audit

Generated against the Aryeo OpenAPI spec at `https://docs.aryeo.com/_bundle/api/aryeo.yaml`
(downloaded for this audit) and corroborated against the live API for the new tools.

> **Important caveat learned during this audit:** Aryeo's published OpenAPI spec is not a
> faithful description of the live API.
>
> - The spec advertises `filter[type]=MAIN` for `/products`. The live API rejects bracketed
>   filters and only accepts the flat `?type=MAIN` form (verified 200/400 against
>   `https://api.aryeo.com/v1/products`).
> - The spec lists `variants` as an example product include. The live API rejects it and
>   returns its own allowlist: `categories, categoriesCount, categoriesExists,
>   order_form_categories, order_form_categoriesCount, order_form_categoriesExists,
>   order_form_categories.order_form`. (Variants come back in the default response anyway.)
> - The spec omits `GET /products/{product_id}` entirely. The live API confirms it doesn't
>   exist — a request with a real product UUID returns `404 - Uh oh that path isn't found`.
>
> Treat the spec as a hint, not a contract. Every endpoint should be verified against
> the live API before being wrapped.

## Tool inventory after this PR

| MCP tool                    | API call                                    | Status         |
| --------------------------- | ------------------------------------------- | -------------- |
| `list_listings`             | `GET /listings`                             | existing       |
| `get_listing`               | `GET /listings/{id}`                        | existing       |
| `list_orders`               | `GET /orders`                               | existing       |
| `get_order`                 | `GET /orders/{id}`                          | existing       |
| `list_customers`            | `GET /customers`                            | existing       |
| `get_customer`              | `GET /customers/{id}` ⚠️                    | existing — endpoint absent from spec; live behaviour unverified |
| `list_appointments`         | `GET /appointments`                         | existing       |
| `create_appointment`        | `POST /appointments/store`                  | existing       |
| `reschedule_appointment`    | `PUT /appointments/{id}/reschedule`         | existing       |
| `cancel_appointment`        | `PUT /appointments/{id}/cancel`             | existing       |
| `get_available_timeslots`   | `GET /scheduling/available-timeslots`       | existing       |
| **`list_products`**         | `GET /products`                             | **new — verified live (flat params)** |
| **`list_product_categories`** | `GET /product-categories`                 | **new — verified live**               |
| **`list_order_items`**      | `GET /orders/{id}?include=items` wrapper    | **new — verified live; Aryeo has no global list** |

`get_product` was attempted (`GET /products/{id}`) and removed before shipping — Aryeo
returns 404 for that path with a real product UUID. See [Section 4](#4-conflicts-surfaced-during-this-pr).

⚠️ See [Section 3](#3-schema-gaps-in-existing-tools-and-bugs) for endpoint-existence concerns.

---

## 1. Uncovered resource groups

Endpoints below are present in the Aryeo OpenAPI spec but not wrapped by the MCP server.
For each group, priority is judged on probable agent value to a real-estate-photography
operator using Claude as a control surface.

### Addresses — **medium**
- `POST /addresses` — create address
- `GET /addresses/{address}` — get address
- `PATCH /addresses/{address}` — update address

Worth wrapping if the agent ever needs to update billing/shipping addresses on orders or
attach a corrected address to a listing without going through the order create flow.
Otherwise, address data already arrives via `include=address` on listings/orders.

### Tasks — **high**
- `GET /tasks` — list tasks
- `POST /tasks` — create task
- `GET /tasks/{id}` — get task
- `PUT /tasks/{id}` — update task
- `DELETE /tasks/{id}` — delete task
- `PUT /tasks/{id}/complete` — complete task
- `PUT /tasks/{id}/reinstate` — reinstate task

Tasks are how Aryeo tracks per-order work assignments (editing, delivery prep). High value
for an agent that triages backlog or marks work done. Wrap list, get, complete, reinstate
first; create/update are lower priority.

### Tags — **medium**
- `POST /tags`, `PUT /tags/{tag_id}` — top-level tag CRUD
- `POST /orders/{order_id}/tags`, `PUT`, `DELETE` — attach/detach order tags
- `POST /products/{product_id}/tags`, `PUT`, `DELETE` — product tags
- `POST /customer-teams/{team_id}/tags`, `PUT`, `DELETE` — team tags

Tags are useful for agent-driven cohort filtering (e.g. "show me all orders tagged
'rush'"). Wrap order-tag attach/detach + a top-level `list_tags` first.

### Order Notes — **medium**
- `PUT /orders/{order_id}/notes` — update order notes

Single-endpoint resource; useful so an agent can append "Note: photographer arrived 15 min
late" without leaving the chat.

### Discounts / Coupons / Promotion codes / Refunds — **low to medium**
- `GET /coupons` — list coupons (medium — useful for showing active promos)
- `POST /discounts` — create discount (low — finance action; better in UI)
- `DELETE /discounts/{discount_id}` (low)
- `DELETE /orders/{order}/discounts/{discount}` (low)
- `POST /promotion-codes/redeem/{discountedType}/{discounted}` (low)
- `POST /refunds/{orderPayment}` — refund (low — money-moving; require explicit confirmation flow if exposed at all)

Most of this is finance plumbing better left in the UI. `list_coupons` is the only one
worth surfacing in the near term.

### Order Forms — **low**
- `POST /order-form-sessions` — create order form session
- `GET /order-forms` — list order forms

Order forms are the public booking-page templates. Low value for back-office agent flows;
expose only if the user wants Claude to surface "what booking forms do I have published".

### Order Payments / Payment Info — **low**
- `POST /orders/{order}/payments` — create manual payment
- `GET /orders/{order}/payment-info` — get payment info
- `PUT /orders/{order}/billing-address` — update billing address
- `POST /billing/setup-intents` — create Stripe setup intent

Money-handling endpoints. The user's MCP server explicitly avoids handling sensitive
financial data; keep these in the UI.

### Blocks (scheduling) — **medium**
- `POST /blocks`, `GET /blocks/{id}`, `PUT /blocks/{id}`, `DELETE /blocks/{id}`

Blocks model time the company is unavailable (holidays, photographer leave). Useful
companion to `get_available_timeslots` so an agent can both check availability and
manage exceptions. Medium — probably second wave.

### Regions / Territories / Taxes — **low**
- `GET /regions` — list scheduling regions
- `GET /territories` — list territories
- `POST /taxes`, `DELETE /taxes/{id}` — tax entry CRUD

Mostly setup/configuration. Low value for agent-driven daily ops. `list_regions` could
help `get_available_timeslots` pick the correct region — wrap it as a small helper if the
user often needs to know the region IDs.

### Scheduling helpers (uncovered) — **medium**
- `GET /scheduling/available-dates` — list available dates (coarser version of timeslots)
- `GET /scheduling/assignment` — get assignment for a candidate appointment
- `GET /scheduling/item-groupings` — list groupings of schedule items

`available-dates` is a useful pair to `available-timeslots` for "what days even have
slots?" surveys. `assignment` is more niche.

### Videos — **medium**
- `GET /videos/{id}`, `PUT /videos/{id}`, `DELETE /videos/{id}`

Listing video assets; useful when an agent is asked to update titles or remove a video.
No collection list endpoint — videos are reached via `?include=videos` on a listing.

### Listing extras — **low to medium**
- `GET /listings/{id}/cubi-casa` — Cubicasa floor-plan info
- `GET /listings/{id}/details/search` — search listing details
- `GET /listings/{id}/stats` — listing engagement stats

`stats` is the highest-value of these for agent-driven reporting ("how many views did the
last shoot get?"). Cubicasa and details/search are niche.

### Appointment lifecycle (uncovered) — **high**
- `GET /appointments/{id}` — get a single appointment
- `PUT /appointments/{id}` — update an appointment
- `PUT /appointments/{id}/postpone` — postpone
- `PUT /appointments/{id}/accept` — accept (provider action)
- `PUT /appointments/{id}/decline` — decline (provider action)
- `PUT /appointments/{id}/schedule` — schedule (move to scheduled)
- `GET /appointments/{id}/availability` — check who's available for this appointment
- `GET /appointments/{id}/3dh-tour-link` — get 3D tour link

`get_appointment` is a clear miss — list+get is the standard pair. accept/decline are
high-value provider actions. The full lifecycle is the most under-wrapped resource group
right now.

### Company team members — **medium**
- `GET /company-team-members` — list company team members (photographers, editors)
- `GET /company-team-members/{id}` — get team member
- `GET /company-team-members/{id}/events` — list a member's calendar events

Useful for "who's on shift today" or "show me Ana's bookings this week". No write
endpoints exposed.

### Customer users / customer team members — **low**
- `GET /customer-users` — list customer users
- `POST /customer-users` — create customer user
- `POST /customer-users/{user}/credit-transactions` — store credit transaction
- `GET /customer-team-members/{id}` — get team member
- `GET /customer-teams/{team_id}/memberships` — list memberships
- `POST /customer-teams/affiliate-memberships` — create affiliate membership

Existing `list_customers`/`get_customer` cover the common case. Only wrap customer-users
endpoints if the user needs to manage agency-level structures (teams, affiliates).

### Order items (uncovered, beyond the new wrapper) — **low**
- `POST /order-items` — create line item
- `GET /order-items/{id}` — get one line item
- `PUT /order-items/{id}` — update line item
- `DELETE /order-items/{id}` — delete line item
- `GET /order-items/{id}/pay-run-item-defaults` — pay run defaults

The new `list_order_items` covers the common read path. `get_order_item` is a worthwhile
add for direct line-item drill-down. Create/update/delete are write operations against
billed items — keep behind explicit user confirmation if exposed.

---

## 2. Partially covered resources

| Resource     | Wrapped                                        | Missing                                                                                          | Looks intentional? |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------ |
| Listings     | list, get                                      | `POST /listings`, `PUT /listings/{id}`, `cubi-casa`, `details/search`, `stats`                   | Likely intentional read-only-by-design for v1; flag `stats` as a missed agent-friendly endpoint |
| Orders       | list, get                                      | `POST /orders`, `notes` PUT, payments, payment-info, billing-address, discount remove, tags      | Read-only by design is plausible; missing `notes` and `tags` is the most accidental-looking gap |
| Appointments | list, create, reschedule, cancel               | get, update, postpone, accept, decline, schedule, availability, 3dh-tour-link                    | Accidental — list+create+two-mutations strongly suggests get/update were meant to ship |
| Customers    | list, get (⚠️ unverified), create not exposed  | `POST /customers`, plus most filters (email/phone/name/exclude/team)                             | get path is suspicious (see §3); missing create is intentional v1 read-bias                   |
| Scheduling   | available-timeslots                            | available-dates, assignment, item-groupings, blocks                                              | available-dates omission looks accidental                                                     |
| Products     | list (new), categories (new)                   | `get_product` not buildable — Aryeo has no `GET /products/{id}` (404'd live with a real UUID); tag attach/detach also missing | Single-fetch absence is a real product-API gap on Aryeo's side, not an MCP one |
| Order items  | per-order list (new wrapper)                   | get/create/update/delete                                                                         | `get_order_item` is the clean follow-up — endpoint exists and is documented                  |

---

## 3. Schema gaps in existing tools

Originally this section claimed the existing tools' flat-param syntax was the primary
bug, on the basis that the OpenAPI spec advertises `filter[*]`. Live testing of `/products`
disproved that assumption: the live API rejects bracketed filters and accepts flat ones.
The most likely interpretation is that the spec is broadly wrong about query syntax across
the API and the existing tools' flat style is in fact correct. **None of the items below
should be treated as confirmed bugs without a live-API check first.**

### `list_listings`
- `status` enum values `"active" | "archived" | "draft"` likely don't match any listings.
  The spec's enum is `DRAFT | COMING_SOON | FOR_LEASE | FOR_SALE | PENDING_SALE |
  PENDING_LEASE | FOR_RENT | SOLD | LEASED | OFF_MARKET | null`. Live test:
  `?status=DRAFT` against `/listings` to confirm flat is accepted.
- Likely-missing filters worth surfacing: `address`, `list_agent`, `active`,
  `price_gte`/`lte`, `square_feet_gte`/`lte`, `bedrooms_gte`/`lte`, `bathrooms_gte`/`lte`,
  `delivery_status`, `showcase`, `sort`. (Live-test which syntax — flat or bracketed —
  the API expects on a per-filter basis; spec is unreliable.)
- `include` docstring lists values that may or may not be in the live allowlist; ask the
  API and let it reject what it doesn't accept (it returns the live allowlist in the 400).

### `list_orders`
- `status` enum is `"pending" | "fulfilled" | "cancelled" | "in_progress"`. The spec
  describes only `payment_status` (PAID/PARTIALLY_PAID/UNPAID) and `fulfillment_status`
  (FULFILLED/PARTIALLY_FULFILLED/UNFULFILLED). Worth a live test of both `?status=` and
  `?payment_status=` to see which (if any) the API actually honours.
- `listing_id` filter likewise — verify whether the API honours it. The spec lists no
  such filter; live behaviour unknown.
- Filters worth surfacing once verified: `search`, `appointment_start_at_gte`,
  `appointment_start_at_lte`, `creator_group_id`, `tag_ids`, `user_ids`, `sort`.

### `list_appointments`
- `start_date` / `end_date` are date strings (`YYYY-MM-DD`). The spec wants ISO datetime
  via `start_at_gte` / `start_at_lte`. Verify against live API — date strings may be
  silently ignored, may be coerced, or may work if the API is forgiving.
- `status` enum is `"confirmed" | "pending" | "cancelled" | "completed"`. The spec lists
  `SCHEDULED | UNSCHEDULED | CANCELED`. Live test recommended.
- Worth surfacing: `tense` (PAST/UPCOMING), `user_ids`, `sort`.
- `include` docstring overlaps with the spec example (`order`, `items`) but adds
  unverified values (`customer`, `agents`, `listing`, `address`); the API will reject
  unknown includes loudly with a 400 listing the allowed set, so this can be tightened.

### `list_customers`
- Worth surfacing: `email`, `email_domain`, `phone`, `name`, `exclude_ids`,
  `customer_team_ids`, `sort` (with live-API verification of syntax).

### `get_customer` ⚠️ unverified
- Calls `GET /customers/{id}`. The OpenAPI spec lists no such endpoint — only
  `GET /customers` and `POST /customers`. Given that `GET /products/{id}` was confirmed
  to genuinely 404 on the live API, **this tool is at high risk of also being a 404
  silently in production**. A quick live test (curl any real customer ID) would
  confirm whether to keep it, replace it with a `list_customers` + `filter[id]` lookup,
  or pivot to `GET /customer-team-members/{id}` (different resource shape).

### `get_listing`, `get_order`
- Spec endpoints exist and follow the standard pattern. No concerns.

### `create_appointment`, `reschedule_appointment`, `cancel_appointment`
- Paths and verbs match the spec. `notify_customer` default of `true` is a sensible
  choice but isn't echoed in the spec — confirm against live behaviour.

### Cross-cutting
- All collection tools omit `sort`. Worth adding once query syntax is verified.
- `safeId` regex (`/^[a-zA-Z0-9_|-]{1,128}$/`) admits non-UUID IDs; most Aryeo IDs are
  strict v4 UUIDs. The new tools use a stricter `uuid` schema where the API demands
  UUIDs. Older tools could be tightened.

---

## 4. Conflicts surfaced during this PR

These are spec-vs-prompt-vs-live-API disagreements that came up while building and
verifying the new tools. Each was surfaced rather than silently resolved.

1. **`get_product` is empirically dead and was removed.** The user's prompt requested it,
   the Aryeo OpenAPI spec doesn't list it, and the live API confirms it: a request to
   `GET /products/{real-product-uuid}` returned `HTTP 404` with body
   `"404 - Uh oh that path isn't found"`. The tool was implemented, tested, and removed
   before shipping. Single-product detail isn't available via the public API; callers
   should use `list_products` with a `search=` to locate one and read the (already-
   expanded) `variants` and `categories` from the collection response.

2. **`list_order_items` cannot be backed by a list endpoint.** Aryeo exposes only
   `POST /order-items`, `GET /order-items/{id}`, `PUT`, and `DELETE` — no global list.
   The new tool wraps `GET /orders/{id}?include=items` and returns the items array;
   `order_id` is required. `product_id` (when supplied) is applied as a client-side
   filter on the returned items. A `get_order_item` tool against the documented
   `/order-items/{id}` endpoint is the obvious follow-up if single-line-item drill-down
   is needed.

3. **Aryeo's published OpenAPI spec is unreliable.** The spec advertises `filter[type]=`
   for `/products`; the live API rejects bracketed filters with a 400 and accepts only
   the flat `?type=` form. The spec lists `variants` as a valid include; the live API
   rejects it with the actual allowlist (`categories, categoriesCount, categoriesExists,
   order_form_categories, order_form_categoriesCount, order_form_categoriesExists,
   order_form_categories.order_form`). The spec omits `GET /products/{id}` entirely,
   correctly.
   The new product tools were initially built around the spec, then rewritten against
   the live API after the first test run failed. **The most useful takeaway for future
   tools: hit the live API early, treat the OpenAPI spec as a hint.**

4. **Existing tools' "flat-param bugs" may not be bugs at all.** The first revision of
   this audit claimed `list_listings`, `list_orders`, `list_appointments`, and
   `list_customers` were buggy because they pass parameters flat instead of as
   `filter[*]`. The `/products` discovery in (3) flips that conclusion: flat is what the
   live API expects on at least that endpoint, and may be the correct convention across
   the API regardless of what the spec says. §3 has been rewritten to reflect that
   uncertainty — none of those tools should be "fixed" without a live-API check first.

5. **`get_customer` is at high risk of 404'ing in production.** The OpenAPI spec lists
   no `GET /customers/{id}` endpoint, mirroring the situation for `get_product` exactly.
   This wasn't tested live in this PR. Worth a curl with any real customer UUID before
   trusting the tool.

6. **Product `active` filter shape.** Aryeo's only knob is `?include_inactive=true`
   (defaults off, returning active-only). There's no live-API "active-only" toggle
   because that's already the default. The new `list_products` accepts `active: boolean`
   and maps `active === false` → `?include_inactive=true`; `active === true` is a no-op.

7. **Product `include` allowlist.** The new `list_products` and (formerly) `get_product`
   tools surface the verified-live allowlist in their docstrings. Anything outside that
   list returns a 400 with the allowlist embedded in the response, so future drift will
   be self-documenting in error responses.
