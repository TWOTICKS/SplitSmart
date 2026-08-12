-- Switches auth from Supabase's own email/OTP system to Clerk, integrated
-- via Supabase's Third-Party Auth support. This assumes Clerk has already
-- been enabled as a Third-Party Auth provider for this project in the
-- Supabase dashboard (Authentication -> Sign In / Providers -> Third Party
-- Auth) — that step can't be done via SQL, it must happen first.
--
-- Two consequences of Clerk issuing the JWT instead of Supabase:
--   1. auth.uid() breaks. It casts the JWT's `sub` claim to uuid, and
--      Clerk's user ids ("user_2abc...") aren't UUIDs — the cast raises.
--      Every place that used auth.uid() now uses (select auth.jwt()->>'sub')
--      (text, no cast) instead.
--   2. Columns that stored a Supabase auth.users id can no longer be uuid
--      foreign keys into auth.users — Clerk users don't live in that table
--      at all. trips.created_by and members.user_id become plain text.

-- ---- drop everything that touches the columns/functions being replaced --

drop policy trips_select on trips;
drop policy trips_update on trips;
drop policy trips_insert on trips;
drop policy trips_select_own on trips;
drop policy members_select on members;
drop policy members_insert on members;
drop policy members_update on members;
drop policy members_insert_creator_bootstrap on members;
drop policy fx_rates_select on fx_rates;
drop function is_trip_member(uuid);
drop function join_trip(text);

-- ---- column type changes -------------------------------------------------

alter table trips drop constraint trips_created_by_fkey;
alter table trips alter column created_by type text using created_by::text;

alter table members drop constraint members_user_id_fkey;
alter table members alter column user_id type text using user_id::text;

-- ---- re-create is_trip_member and policies using the Clerk JWT's `sub` --

create function is_trip_member(t uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from members m
    where m.trip_id = t and m.user_id = (select auth.jwt()->>'sub')
  );
$$;

create policy trips_select on trips for select using (is_trip_member(id));
create policy trips_update on trips for update using (is_trip_member(id));
create policy trips_insert on trips for insert
  with check (created_by = (select auth.jwt()->>'sub'));
-- lets the creator see their own just-created trip before their own
-- members row exists yet (see 0003_fix_trip_creation_rls.sql for why this
-- bootstrapping exception is needed)
create policy trips_select_own on trips for select
  using (created_by = (select auth.jwt()->>'sub'));

create policy members_select on members for select using (is_trip_member(trip_id));
create policy members_insert on members for insert with check (is_trip_member(trip_id));
create policy members_update on members for update using (is_trip_member(trip_id));

create policy members_insert_creator_bootstrap on members for insert
  with check (
    user_id = (select auth.jwt()->>'sub')
    and exists (select 1 from trips t where t.id = trip_id and t.created_by = (select auth.jwt()->>'sub'))
  );

create policy fx_rates_select on fx_rates for select
  using ((select auth.jwt()->>'sub') is not null);

-- ---- join_trip: display name now comes from the app (Clerk user data
-- isn't queryable from Postgres the way auth.users was) --------------------

create function join_trip(p_code text, p_display_name text) returns uuid
language plpgsql security definer as $$
declare
  v_trip_id uuid;
  v_user_id text := (select auth.jwt()->>'sub');
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select id into v_trip_id from trips
    where lower(invite_code) = lower(p_code) and archived_at is null;

  if v_trip_id is null then
    raise exception 'invalid invite code';
  end if;

  insert into members (trip_id, user_id, display_name)
    values (v_trip_id, v_user_id, coalesce(nullif(trim(p_display_name), ''), 'Member'))
    on conflict (trip_id, user_id) do nothing;

  return v_trip_id;
end;
$$;

revoke all on function join_trip(text, text) from public;
grant execute on function join_trip(text, text) to authenticated;

-- ---- upsert_expense: resolve the creator's member row via the Clerk sub -

create or replace function upsert_expense(
  p_id uuid,
  p_trip_id uuid,
  p_description text,
  p_category text,
  p_currency char(3),
  p_subtotal_minor bigint,
  p_sc_minor bigint,
  p_gst_minor bigint,
  p_total_minor bigint,
  p_fx_rate_to_home numeric,
  p_fx_stale boolean,
  p_spent_at date,
  p_split_mode text,
  p_tax_inclusive boolean,
  p_payers jsonb,
  p_splits jsonb
) returns uuid
language plpgsql security invoker as $$
declare
  v_creator_member_id uuid;
begin
  select id into v_creator_member_id from members
    where trip_id = p_trip_id and user_id = (select auth.jwt()->>'sub');
  if v_creator_member_id is null then
    raise exception 'not a member of this trip';
  end if;

  insert into expenses (
    id, trip_id, description, category, currency,
    subtotal_minor, sc_minor, gst_minor, total_minor,
    fx_rate_to_home, fx_stale, spent_at, split_mode, tax_inclusive, created_by, updated_by
  ) values (
    p_id, p_trip_id, p_description, p_category, p_currency,
    p_subtotal_minor, p_sc_minor, p_gst_minor, p_total_minor,
    p_fx_rate_to_home, p_fx_stale, p_spent_at, p_split_mode, p_tax_inclusive, v_creator_member_id, v_creator_member_id
  )
  on conflict (id) do update set
    description = excluded.description,
    category = excluded.category,
    currency = excluded.currency,
    subtotal_minor = excluded.subtotal_minor,
    sc_minor = excluded.sc_minor,
    gst_minor = excluded.gst_minor,
    total_minor = excluded.total_minor,
    fx_rate_to_home = excluded.fx_rate_to_home,
    fx_stale = excluded.fx_stale,
    spent_at = excluded.spent_at,
    split_mode = excluded.split_mode,
    tax_inclusive = excluded.tax_inclusive,
    updated_by = v_creator_member_id;

  delete from expense_payers where expense_id = p_id;
  insert into expense_payers (expense_id, member_id, amount_minor)
    select p_id, (r->>'member_id')::uuid, (r->>'amount_minor')::bigint
    from jsonb_array_elements(p_payers) r;

  delete from expense_splits where expense_id = p_id;
  insert into expense_splits (expense_id, member_id, amount_minor, input_value)
    select p_id, (r->>'member_id')::uuid, (r->>'amount_minor')::bigint, nullif(r->>'input_value','')::numeric
    from jsonb_array_elements(p_splits) r;

  return p_id;
end;
$$;
