# SplitSmart

A trip-scoped shared expense splitter — see [BUILD_PROMPT.md](./BUILD_PROMPT.md) for the full
spec this was built against. Installable PWA (Next.js + Supabase + Clerk), works offline.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (pick the region
   closest to where the group actually travels — `ap-southeast-1` for Singapore-based users).
2. **Run the migrations** — in the Supabase SQL editor, run the files in `supabase/migrations/`
   **in order** (`0001` through `0005`). Or via the Supabase CLI: `supabase db push`.
3. **Create a Clerk app** at [clerk.com](https://clerk.com) (free tier). Grab the **Publishable
   key** and **Secret key** from its API Keys page.
4. **Connect Clerk to Supabase as a Third-Party Auth provider** — this is what lets Supabase's
   Row Level Security trust a Clerk-issued sign-in, instead of Supabase's own auth system:
   - In Clerk's dashboard, find the **Supabase integration** (under Integrations) and enable it.
     It gives you a domain to use.
   - In Supabase → **Authentication → Sign In / Providers → Third Party Auth**, add Clerk and
     paste that domain in.
   - Without this step, every database request will be rejected — Clerk's JWTs won't be
     recognized as valid sessions.
5. **Copy the env file** and fill in your Supabase and Clerk keys:
   ```bash
   cp .env.local.example .env.local
   ```
6. **Install and run**:
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000.

## Deploying

Push to GitHub, import the repo on [Vercel](https://vercel.com/new), and set the four env vars
from `.env.local.example` in the Vercel project settings. **Also check Vercel's Deployment
Protection setting (Settings → Deployment Protection) and make sure Production is set to
Public** — if it's protected, visitors get Vercel's own login wall in front of the app, on top
of Clerk's, which is not what you want for something you're sharing with friends.

Cost at rest: Supabase and Vercel free tiers cover this app easily; Clerk's free tier covers up
to 10,000 monthly active users.

## Testing

```bash
npm test          # lib/money.ts and lib/expense-builder.ts — pure, no backend needed
npm run test:e2e  # Playwright happy-path + offline-sync — needs real Supabase + Clerk projects
```

The E2E suite needs `CLERK_SECRET_KEY` set (already required above) so it can create disposable
test users via Clerk's Backend API and sign them in through
[`@clerk/testing`](https://clerk.com/docs/testing/playwright/overview)'s Playwright helper,
rather than driving Clerk's real sign-in UI by hand.

## Architecture notes worth knowing before you touch the code

- **Money is integer minor units everywhere**, split using the largest-remainder method
  (`lib/money.ts`). Never introduce a float into a money path.
- **The DB enforces the ledger, not the UI.** Deferred constraint triggers in
  `supabase/migrations/0001_init.sql` reject any commit where payer or split amounts don't sum
  to the expense total. `lib/expense-builder.ts` mirrors the same logic client-side purely so
  the live form preview and the eventual write agree — the trigger is still the actual
  guarantee.
- **New expenses and settlements write client-first, offline-first** (`lib/offline/`): the
  browser resolves totals/splits/fx itself and tries Supabase directly; on failure it queues to
  a local Dexie outbox and retries on reconnect. Editing an existing expense goes through a
  regular server action instead, since that's a less time-critical path and keeps the diff
  smaller.
- **Multi-table expense writes go through one Postgres function** (`upsert_expense` RPC), not
  three separate `supabase-js` calls, so the deferred sum-check triggers see a complete,
  consistent transaction.
- Settlements are recorded directly in the trip's home currency (rate always 1) —
  foreign-currency settlements were left out; add if a user actually asks for one.
- **Auth is Clerk, not Supabase's own auth system** (`supabase/migrations/0005_clerk_auth.sql`
  has the full story). This app originally used Supabase's built-in email sign-in, first as a
  clickable magic link, then as a typed one-time code with a custom Resend-based email hook —
  both fought a long series of real-world issues (redirect/cookie fragility, Vercel's
  Deployment Protection interposing itself, Resend's sender-domain-verification requirement
  blocking delivery to anyone but the account owner). Clerk was adopted because it owns email
  delivery end-to-end, removing that whole category of problems. Two consequences worth
  knowing if you're reading the schema: `auth.uid()` doesn't work anymore (Clerk's user ids
  aren't UUIDs, and that helper casts to one) — RLS policies use `(select auth.jwt()->>'sub')`
  instead; and `members.user_id` / `trips.created_by` are `text`, not `uuid` foreign keys into
  `auth.users`, since Clerk users don't live in that table.
