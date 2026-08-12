-- Changing a trip's home currency isn't just relabeling a field: every
-- expense/settlement stores fx_rate_to_home computed against the OLD home
-- currency, and balances are computed by applying that rate. If the label
-- changes without the rates changing, every historical balance becomes
-- wrong while looking unchanged. This RPC updates the trip's currency and
-- every row's rate atomically — the rates themselves are refetched
-- client-side first (lib/fx.ts, same as on initial entry) and passed in,
-- since a Postgres transaction can't reach an external FX API itself.

create function update_home_currency(
  p_trip_id uuid,
  p_new_currency char(3),
  p_expense_rates jsonb,  -- [{id, rate, stale}]
  p_settlement_rates jsonb -- [{id, rate, stale}]
) returns void
language plpgsql security invoker as $$
begin
  update trips set home_currency = p_new_currency where id = p_trip_id;

  update expenses e set
    fx_rate_to_home = (r->>'rate')::numeric,
    fx_stale = (r->>'stale')::boolean
  from jsonb_array_elements(p_expense_rates) r
  where e.id = (r->>'id')::uuid and e.trip_id = p_trip_id;

  -- settlements has no fx_stale column (they're always recorded directly
  -- in the home currency at rate 1, see app/trips/[tripId]/settlements'
  -- submit path) — only the rate needs updating here.
  update settlements s set
    fx_rate_to_home = (r->>'rate')::numeric
  from jsonb_array_elements(p_settlement_rates) r
  where s.id = (r->>'id')::uuid and s.trip_id = p_trip_id;
end;
$$;

revoke all on function update_home_currency(uuid, char(3), jsonb, jsonb) from public;
grant execute on function update_home_currency(uuid, char(3), jsonb, jsonb) to authenticated;
