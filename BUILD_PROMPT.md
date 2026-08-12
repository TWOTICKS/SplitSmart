# Build Prompt — "Tabby" (Splitwise clone for overseas trips)

This document is the complete build specification. Feed it to a coding agent as the prompt.
It is written so that every ambiguous decision is already made. Where a rule affects money,
it is stated as a testable invariant, not a preference.

---

## 0. Decisions already made (do not re-litigate)

| Question | Decision | Why |
|---|---|---|
| Native iOS/Android or web? | **Installable PWA**, one codebase | Native means 2 codebases, 2 store accounts (US$99/yr Apple + US$25 Google), review queues, and release lag for a group-expense app that is 95% forms and lists. A PWA installs to the home screen, runs full-screen, works offline, and updates instantly. |
| Hosting | **Vercel (app) + Neon or Supabase Postgres (data)**, both free tier | US$0 at this scale, global edge, TLS handled, no ops. |
| Host on the laptop from overseas? | **No.** | Technically possible (Cloudflare Tunnel → laptop). Practically: laptop sleeps/lid closes, home ISP reboots, power cuts, dynamic IP, no one can settle a bill at 11pm because your laptop is asleep in another timezone. It also puts the group's data on an unbacked-up consumer machine. Cost saved: $0. Do not do it. |
| Money type | **Integer minor units (cents)**, never floats | `0.1 + 0.2 !== 0.3`. Any float in a money path is a bug. |
| Accounts | **Email magic link** (Supabase Auth) | No passwords to store, reset, or leak. Works on any device abroad. |

Deviating from any of the above requires an explicit instruction from the user.

---

## 1. What the app does

A trip-scoped shared expense ledger. Anyone in a trip can add an expense, say who paid, and
choose how the cost is divided. The app maintains running balances and tells everyone the
smallest set of payments that settles the group.

### Core objects
- **Trip** — a named container (e.g. "Japan Oct 2026"). Has a home currency, a member list, an invite code, and default tax settings.
- **Member** — a person in a trip. May be a *registered user* (signed in) or a *ghost* (name only, added by someone else, no login). Ghosts can be claimed later by a real user without breaking history.
- **Expense** — who paid, how much, in what currency, on what date, split among which members.
- **Settlement** — a direct payment from one member to another that reduces debt. Stored as its own record type, never as a negative expense.

### Split modes (all four required)
1. **Equal** — divide among selected members.
2. **Exact amounts** — each member gets a typed figure. Must sum to the total.
3. **Shares/parts** — e.g. 2 parts for the couple, 1 part each for singles.
4. **Percentage** — must sum to exactly 100%.

An expense may have **multiple payers** (two people split the bill at the counter). Payer
amounts must sum to the expense total.

### Tax handling (the differentiator)
When entering an expense the user may toggle **Service charge** and **GST**. Both are per-trip
defaults, overridable per expense.

- Defaults: service charge **10%**, GST **9%** (Singapore, as of 2024). Both stored as basis
  points on the trip row so they can be changed without a deploy.
- **Application order is fixed and must not be configurable**: service charge applies to the
  subtotal; GST applies to the subtotal *plus* service charge. This matches Singapore F&B
  practice ("++").
  ```
  service_charge = round(subtotal * sc_bps / 10000)
  gst            = round((subtotal + service_charge) * gst_bps / 10000)
  total          = subtotal + service_charge + gst
  ```
- The entry form must also accept the **reverse case**: user types the *final* total off the
  receipt and flags it as "tax already included". The app back-computes subtotal for display
  only; the split always operates on `total`.
- Taxes are **never split separately**. They inflate the total, and the total is split by
  whatever mode was chosen. Rationale: splitting tax proportionally to the pre-tax split gives
  the identical result, so a separate tax-split feature is dead code.
- The expense detail view must show the breakdown line-by-line (subtotal / service / GST /
  total) so a user can reconcile against a paper receipt.

### Multi-currency (required — this is an overseas app)
- Trip has a **home currency**. Every expense stores `amount_minor`, `currency`, and
  `fx_rate_to_home` captured **at the moment of entry**.
- Rates are fetched from a free endpoint (e.g. `open.er-api.com` or `frankfurter.app`), cached
  in the DB per (date, currency-pair), and refreshed at most daily. If the network is down at
  entry time, the app uses the last cached rate and marks the expense `fx_stale = true` with a
  visible badge; the user can correct the rate later.
- **Historical rates are never retroactively updated.** A settled dinner in Tokyo does not
  change value because the yen moved. Balances are computed in home currency using each
  expense's stored rate.

---

## 2. Data model

Postgres. Write this as a single `schema.sql` migration.

```sql
-- money is always integer minor units; currency is ISO-4217
create table trips (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) between 1 and 80),
  home_currency  char(3) not null,
  sc_bps         int not null default 1000  check (sc_bps  between 0 and 10000),
  gst_bps        int not null default 900   check (gst_bps between 0 and 10000),
  invite_code    text unique not null,      -- 8 chars, crypto-random, case-insensitive
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now(),
  archived_at    timestamptz
);

create table members (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  user_id    uuid references auth.users(id),   -- null => ghost member
  display_name text not null check (length(trim(display_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (trip_id, user_id)                    -- a user joins a trip once
);

create table expenses (
  id            uuid primary key,              -- CLIENT-GENERATED (offline idempotency)
  trip_id       uuid not null references trips(id) on delete cascade,
  description   text not null check (length(trim(description)) between 1 and 140),
  category      text,
  currency      char(3) not null,
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  sc_minor      bigint not null default 0 check (sc_minor  >= 0),
  gst_minor     bigint not null default 0 check (gst_minor >= 0),
  total_minor   bigint not null check (total_minor > 0),
  fx_rate_to_home numeric(20,10) not null check (fx_rate_to_home > 0),
  fx_stale      boolean not null default false,
  spent_at      date not null,
  split_mode    text not null check (split_mode in ('equal','exact','shares','percent')),
  created_by    uuid not null references members(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,                   -- soft delete only
  constraint total_is_sum check (total_minor = subtotal_minor + sc_minor + gst_minor)
);

create table expense_payers (
  expense_id uuid not null references expenses(id) on delete cascade,
  member_id  uuid not null references members(id),
  amount_minor bigint not null check (amount_minor > 0),
  primary key (expense_id, member_id)
);

create table expense_splits (
  expense_id uuid not null references expenses(id) on delete cascade,
  member_id  uuid not null references members(id),
  amount_minor bigint not null check (amount_minor >= 0),
  -- the raw input that produced amount_minor, kept so the form can be re-opened
  input_value  numeric(18,6),
  primary key (expense_id, member_id)
);

create table settlements (
  id          uuid primary key,                -- client-generated
  trip_id     uuid not null references trips(id) on delete cascade,
  from_member uuid not null references members(id),
  to_member   uuid not null references members(id),
  currency    char(3) not null,
  amount_minor bigint not null check (amount_minor > 0),
  fx_rate_to_home numeric(20,10) not null,
  settled_at  date not null,
  note        text,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  check (from_member <> to_member)
);

create table fx_rates (
  as_of date, base char(3), quote char(3), rate numeric(20,10) not null,
  primary key (as_of, base, quote)
);

create index on expenses (trip_id, spent_at desc) where deleted_at is null;
create index on expense_splits (member_id);
```

### Integrity enforced in the database, not in JavaScript
Write **deferrable constraint triggers** that fire at COMMIT and raise on violation:
1. `sum(expense_payers.amount_minor) = expenses.total_minor`
2. `sum(expense_splits.amount_minor) = expenses.total_minor`
3. Every `member_id` referenced by a payer/split belongs to the same `trip_id` as the expense.
4. Both `settlements.from_member` and `to_member` belong to `settlements.trip_id`.

These are the invariants that make a balance sheet trustworthy. A UI bug must not be able to
create a ledger that does not sum. Do not move these checks into application code.

### Row-level security
Enable RLS on every table. The single predicate, expressed once as a SQL helper function:

```sql
create function is_trip_member(t uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from members m
                 where m.trip_id = t and m.user_id = auth.uid());
$$;
```

- `trips`: select/update where `is_trip_member(id)`; insert where `created_by = auth.uid()`.
- `members`, `expenses`, `settlements`: all operations where `is_trip_member(trip_id)`.
- `expense_payers` / `expense_splits`: via a join to the parent expense's trip.
- Joining by invite code goes through a `security definer` RPC (`join_trip(code text)`), because
  the joiner is not yet a member and therefore cannot satisfy the policy. That function must
  rate-limit and must not leak whether a code exists on failure — return a generic error.

**Required test:** a signed-in user who is not a member of trip X must receive zero rows from
every table for trip X, and every write against trip X must fail. Write this as an automated
test with two real auth sessions, not a manual check.

---

## 3. Money rules — implement exactly

Put all of this in one file, `lib/money.ts`, with no I/O, no dates, no imports. It must be a
pure module so it can be unit-tested exhaustively.

### 3.1 Rounding
- One rounding function: **half-up on the absolute value** (`round(2.5) = 3`, `round(-2.5) = -3`).
  Banker's rounding is not used; receipts do not use it.
- Round **once**, at the point of producing a minor-unit integer. Never round an intermediate.

### 3.2 Splitting with remainders — largest remainder method
Dividing 100.00 among 3 people is 33.333…. Naive rounding loses or invents a cent. Required
algorithm:

```
1. For each member i, compute exact = total * weight_i / sum(weights)  (use integer math:
   numerator = total * weight_i, then floor-divide by sum(weights)).
2. Assign each member floor(exact). Track the remainder numerator for each.
3. leftover = total - sum(floors)   // always 0 <= leftover < member_count
4. Sort members by remainder descending; tie-break by a STABLE key (member_id ascending).
5. Give one extra minor unit to the first `leftover` members.
```

**Invariant, asserted in code and in tests:** `sum(splits) === total`, for every mode, for
every input. Property-test it: for random totals 1…10_000_000 and 1…20 members with random
weights, the sum always matches and no split is negative.

The tie-break must be deterministic (sorted member id), never insertion order or object key
order — otherwise the same expense renders differently on two phones.

### 3.3 Percentage mode
Percentages are entered to 2 decimal places and stored as integer basis points. Reject
submission unless they sum to exactly 10000 bps. Then split by the largest-remainder algorithm
using bps as weights — do not multiply and round independently per person.

### 3.4 Exact mode
Entered amounts must sum to the total exactly. The UI shows a live "S$0.00 left to assign"
counter and disables save while non-zero. Do not silently absorb a difference.

### 3.5 Currency conversion
`fx_rate_to_home` is a major-unit-to-major-unit rate (1 unit of the expense's currency =
`fx_rate_to_home` units of the home currency — the form every FX API returns). Converting minor
units is **not** `amount_minor * fx_rate_to_home` — that's only correct when both currencies
happen to share the same number of decimal places. In general:
```
home_minor = round(amount_minor * fx_rate_to_home * 10^(homeExponent - fromExponent))
```
Skipping the exponent term is a real bug, not a rounding nuance: converting JPY (0 decimals)
into SGD (2 decimals) without it comes out **100x too small**, silently. Currencies with 0
decimals (JPY, KRW) and 3 decimals (KWD, BHD) must be handled: keep an exponent table, never
assume 2, and route every conversion through one function that applies this scaling — never
inline the multiplication at a call site.

### 3.6 Balances
```
balance(member) = Σ (paid by member, in home minor)
                - Σ (owed by member, in home minor)
                + Σ (settlements received)   -- wait, no:
```
State it unambiguously to avoid sign errors:
```
net(m) = Σ expense_payers[m].amount_home
       - Σ expense_splits[m].amount_home
       + Σ settlements.where(from = m).amount_home
       - Σ settlements.where(to   = m).amount_home
```
`net > 0` means the group owes m. `net < 0` means m owes the group. A settlement moves money
from a debtor to a creditor: the sender's net rises toward zero (they paid off what they owed),
the receiver's net falls toward zero (less is now owed to them) — so `from` is added and `to` is
subtracted, not the reverse.
**Invariant:** `Σ net(m) over all members of a trip === 0`, always. Assert this after every
balance computation; if it ever fails, surface a loud error rather than displaying wrong
numbers.

### 3.7 Settle-up suggestion (debt simplification)
Greedy min-cash-flow: repeatedly match the largest creditor with the largest debtor, transfer
`min(|debtor|, creditor)`, remove whoever hits zero. Produces at most `n-1` transfers.
- Deterministic tie-break by member id so every phone shows the same plan.
- Show it as a **suggestion**; a user may still record any arbitrary payment.
- Offer a per-trip toggle "simplify debts" (off by default). When off, show raw pairwise debts,
  because some groups want to see who actually owes whom.

---

## 4. Offline and flaky-network behaviour

This is the requirement that actually matters overseas — roaming data is intermittent, and
people add expenses at the table.

- **Local-first.** All writes go to IndexedDB immediately and render instantly. A background
  sync queue POSTs them when connectivity returns. The UI never blocks on the network.
- **Client-generated UUIDv7 primary keys** on `expenses` and `settlements`. Retrying a POST is
  therefore idempotent — the server upserts on primary key. This is why the ids are not
  `default gen_random_uuid()` for those tables.
- **Conflict policy: last-write-wins per row, by `updated_at`**, with the server clock as the
  tiebreaker. Justification: two people editing the same expense simultaneously is rare, and
  the alternative (CRDTs, operational transform) is weeks of work for a trip app. Document this
  choice in the README so it is a decision, not an accident.
- **Deletes are soft** (`deleted_at`). A tombstone syncs; a missing row does not.
- Each pending item shows a small "not synced" dot. A trip-level banner shows "3 changes
  waiting to sync" when the queue is non-empty. Never silently drop a queued write.
- The service worker precaches the app shell so a cold launch works with no signal at all.
- Realtime (Supabase channels) pushes other members' changes when online. Treat it as an
  optimisation — a full refetch on app focus must produce the same state, and there must be a
  pull-to-refresh.

---

## 5. Auth and joining

- Magic-link email sign-in. No passwords anywhere in the codebase.
- Trip invite: share a link `https://<app>/join/<code>`. Opening it while signed in shows
  "Join <trip name>?" → creates a `members` row.
- **Ghost members**: added by name alone so you can start splitting before everyone has
  installed anything. A ghost is claimed when a real user joins and picks "I'm Alex" — this
  sets `members.user_id` and preserves all history because the member id never changes.
  Claiming requires confirmation from the trip creator or the claim is limited to unclaimed
  ghosts only; either way, a user must never be able to claim a member that already has a
  `user_id`. Enforce with a DB check.
- Session persists indefinitely on the device (refresh token). Nobody should be logged out
  mid-trip in a country with no data.

---

## 6. Screens

Keep it to six. Every additional screen is a screen to maintain.

1. **Trips list** — cards showing trip name, your net balance ("you are owed S$142.30"), member avatars. FAB: new trip / join by code.
2. **Trip detail** — the ledger. Reverse-chronological expense list grouped by date, each row showing description, total, "you lent S$12.40" / "you borrowed S$8.00". Sticky header with your net balance. Tabs: *Expenses* | *Balances*.
3. **Add/edit expense** — the most important screen. Optimise it ruthlessly:
   - Amount keypad first, big, numeric, currency selector inline.
   - "Paid by [me ▾]" defaults to the current user; tapping opens multi-payer.
   - "Split [equally ▾] among [all ▾]" — the default path is three taps total.
   - Tax section collapsed by default, showing a one-line summary "+10% svc, +9% GST → S$120.24" when active. Trip defaults pre-applied.
   - Live per-person preview at the bottom, always visible: "Alex S$30.06 · Bea S$30.06 · …".
   - Save is disabled with a specific reason when invalid ("S$4.20 left to assign"), never a generic "invalid".
4. **Balances** — per-member net, plus the settle-up plan with a one-tap "Record payment".
5. **Expense detail** — full breakdown incl. tax lines, who paid, who owes, edit history (created/edited by whom and when), delete.
6. **Trip settings** — name, home currency, default GST/service-charge rates, members, simplify-debts toggle, invite link, export CSV, archive trip.

### UX rules
- Optimistic UI everywhere: the row appears the instant you hit save.
- Every destructive action is undoable via a 5-second snackbar rather than a confirm dialog.
- Currency always rendered with its symbol and correct decimal count; never show raw minor units.
- Touch targets ≥ 44px. Form inputs use native types (`inputmode="decimal"`, `type="date"`) so mobile keyboards and pickers are correct without libraries.
- Accessibility: labelled inputs, visible focus, contrast ≥ 4.5:1, screen-reader-announced balance changes.
- Dark mode via CSS `prefers-color-scheme`.

---

## 7. Stack

```
Next.js (App Router, TypeScript, strict)   — UI + a thin API surface
Tailwind CSS                               — styling, no component library
Supabase                                   — Postgres + Auth + RLS + Realtime
Dexie (IndexedDB wrapper)                  — offline store + sync queue
next-pwa or a hand-written service worker  — installability + app-shell cache
Vitest + fast-check                        — unit and property tests
Playwright                                 — one end-to-end happy path
```

**No state-management library.** React state plus a Dexie live-query hook covers this app;
adding Redux/Zustand here is ceremony. **No UI kit** — the six screens are lists, a form, and a
keypad. **No ORM** — the Supabase client plus one SQL migration file is enough; Prisma buys
nothing when the schema is 8 tables and RLS lives in SQL anyway.

Deploy: push to GitHub → Vercel auto-deploys. Supabase project in the **region closest to where
the group actually travels** (`ap-southeast-1` for Singapore-based users). Free tier covers a
group of this size with enormous headroom.

Cost at rest: **$0/month.** Optional custom domain ~US$12/yr.

---

## 8. Testing — non-negotiable, because this handles money

The instruction is "without any flaws". That is delivered by tests, not by care.

**Unit (`lib/money.ts`) — must exist before the UI is built:**
- Every split mode: sum of splits equals total. Property-tested over random inputs.
- Largest-remainder correctness: 100.00 / 3 → `[33.34, 33.33, 33.33]`, and the extra cent lands
  on a deterministic member.
- 0.01 split among 3 → `[0.01, 0.00, 0.00]`, never negative, never fractional.
- Tax order: subtotal 100.00, sc 10%, gst 9% → sc 10.00, gst 9.90, total 119.90. Assert exactly.
- Tax-inclusive back-computation round-trips to within one minor unit.
- JPY (0 decimals) and KWD (3 decimals) render and split correctly.
- Percentages not summing to 100 are rejected; exact amounts not summing to total are rejected.

**Integrity (against a real Postgres):**
- Attempting to insert splits that do not sum to the total raises at COMMIT.
- Attempting to reference a member from another trip raises.
- Non-member reads return 0 rows; non-member writes fail. (Two real auth sessions.)

**Invariant checks in production code:**
- After computing balances: assert `Σ net === 0`. Fail loudly.
- After computing a settle-up plan: assert the plan, applied, zeroes every balance.

**End-to-end (one path, Playwright):** create trip → add ghost member → add a S$119.90 dinner
with GST and service charge split equally among 3 → check balances → record the suggested
settlement → confirm all balances are zero.

**Offline test:** queue two expenses with the network disabled, restore the network, assert both
sync exactly once and that replaying the same queue twice does not duplicate them.

---

## 9. Build order

Ship each milestone working before starting the next. Do not build ahead.

1. `lib/money.ts` + its full test suite. **No UI.** Everything downstream depends on this being right.
2. `schema.sql` + constraint triggers + RLS + the integrity test suite against a local Postgres.
3. Auth, trips list, create trip, join by code, ghost members.
4. Add-expense form (equal split only) + expense list + balances. This is a usable app — stop and use it.
5. Remaining split modes, multiple payers, tax section, edit/delete with soft deletes.
6. Multi-currency + FX caching.
7. Offline queue + service worker + installability.
8. Settle-up plan + record payment + CSV export.

---

## 10. Explicitly out of scope

Do not build these. If one is genuinely needed later, it can be added in isolation.

- Payment integration (PayNow/Stripe/Venmo). Recording that a transfer happened is enough; the
  transfer itself happens in a banking app.
- Receipt photo OCR. Attaching a photo is fine; parsing it is a research project.
- Push notifications (needs APNs setup and permission prompts for near-zero benefit on a trip).
- Recurring expenses, budgets, spending analytics, friend graphs across trips.
- Native apps. Revisit only if App Store presence becomes a real requirement — the money module
  and the schema port unchanged to React Native if so.
- Real-time collaborative editing of a single expense. Last-write-wins is the documented policy.
