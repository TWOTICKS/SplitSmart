# SplitSmart

A trip-scoped shared expense splitter — see [BUILD_PROMPT.md](./BUILD_PROMPT.md) for the full
spec this was built against. Installable PWA (Next.js + Supabase), $0/month hosting, works
offline.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (pick the region
   closest to where the group actually travels — `ap-southeast-1` for Singapore-based users).
2. **Run the migrations** — in the Supabase SQL editor, run the two files in
   `supabase/migrations/` in order (`0001_init.sql`, then `0002_expense_writes.sql`). Or via the
   Supabase CLI: `supabase db push`.
3. **Enable email auth** — it's on by default. No other provider is needed; the app signs
   people in with a magic link only.
4. **Copy the env file** and fill in your project's URL and anon key (Project Settings → API):
   ```bash
   cp .env.local.example .env.local
   ```
5. **Install and run**:
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000.

## Deploying

Push to GitHub, import the repo on [Vercel](https://vercel.com/new), and set the same two env
vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) plus
`NEXT_PUBLIC_SITE_URL` (your Vercel URL, used to build the magic-link redirect) in the Vercel
project settings. Also add that URL to Supabase's Auth → URL Configuration → Redirect URLs
(`https://<your-app>.vercel.app/auth/callback`). Free tier on both sides covers this app with
enormous headroom — cost at rest is $0/month.

## Testing

```bash
npm test          # lib/money.ts and lib/expense-builder.ts — pure, no backend needed
npm run test:e2e  # Playwright happy-path + offline-sync — needs a real Supabase project
```

The E2E suite needs `SUPABASE_SERVICE_ROLE_KEY` set (test-only — never expose this to the
browser or commit it) so it can mint real sign-in links for disposable test users via
`supabase.auth.admin.generateLink`, the same mechanism a production magic link uses.

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
