-- Tabby schema. Money is always integer minor units. Currency is ISO-4217.
-- See BUILD_PROMPT.md section 2-3 for the invariants this file enforces.

create extension if not exists pgcrypto;

-- ============================================================ trips ======

create table trips (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) between 1 and 80),
  home_currency  char(3) not null,
  sc_bps         int not null default 1000  check (sc_bps  between 0 and 10000),
  gst_bps        int not null default 900   check (gst_bps between 0 and 10000),
  simplify_debts boolean not null default false,
  invite_code    text unique not null,
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now(),
  archived_at    timestamptz
);

-- ============================================================ members ====

create table members (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips(id) on delete cascade,
  user_id      uuid references auth.users(id),
  display_name text not null check (length(trim(display_name)) between 1 and 60),
  created_at   timestamptz not null default now(),
  unique (trip_id, user_id)
);

-- ============================================================ expenses ===

create table expenses (
  id              uuid primary key,
  trip_id         uuid not null references trips(id) on delete cascade,
  description     text not null check (length(trim(description)) between 1 and 140),
  category        text,
  currency        char(3) not null,
  subtotal_minor  bigint not null check (subtotal_minor >= 0),
  sc_minor        bigint not null default 0 check (sc_minor  >= 0),
  gst_minor       bigint not null default 0 check (gst_minor >= 0),
  total_minor     bigint not null check (total_minor > 0),
  fx_rate_to_home numeric(20,10) not null check (fx_rate_to_home > 0),
  fx_stale        boolean not null default false,
  spent_at        date not null,
  split_mode      text not null check (split_mode in ('equal','exact','shares','percent')),
  tax_inclusive   boolean not null default false,
  created_by      uuid not null references members(id),
  updated_by      uuid references members(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint total_is_sum check (total_minor = subtotal_minor + sc_minor + gst_minor)
);

create table expense_payers (
  expense_id   uuid not null references expenses(id) on delete cascade,
  member_id    uuid not null references members(id),
  amount_minor bigint not null check (amount_minor > 0),
  primary key (expense_id, member_id)
);

create table expense_splits (
  expense_id   uuid not null references expenses(id) on delete cascade,
  member_id    uuid not null references members(id),
  amount_minor bigint not null check (amount_minor >= 0),
  input_value  numeric(18,6),
  primary key (expense_id, member_id)
);

-- ========================================================= settlements ===

create table settlements (
  id              uuid primary key,
  trip_id         uuid not null references trips(id) on delete cascade,
  from_member     uuid not null references members(id),
  to_member       uuid not null references members(id),
  currency        char(3) not null,
  amount_minor    bigint not null check (amount_minor > 0),
  fx_rate_to_home numeric(20,10) not null,
  settled_at      date not null,
  note            text,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  check (from_member <> to_member)
);

-- ============================================================ fx_rates ===

create table fx_rates (
  as_of date not null,
  base  char(3) not null,
  quote char(3) not null,
  rate  numeric(20,10) not null check (rate > 0),
  primary key (as_of, base, quote)
);

create index expenses_trip_active_idx on expenses (trip_id, spent_at desc) where deleted_at is null;
create index expense_splits_member_idx on expense_splits (member_id);
create index expense_payers_member_idx on expense_payers (member_id);
create index settlements_trip_active_idx on settlements (trip_id) where deleted_at is null;
create index members_trip_idx on members (trip_id);

-- =================================================== integrity triggers ==
-- These run at COMMIT (deferrable) so a multi-statement insert (expense +
-- its payer rows + its split rows) can complete before being checked.
-- A UI bug must never be able to produce a ledger that doesn't sum.

create function check_expense_payers_sum() returns trigger
language plpgsql as $$
declare
  v_total bigint;
  v_sum bigint;
begin
  select total_minor into v_total from expenses where id = coalesce(new.expense_id, old.expense_id);
  if v_total is null then
    return null; -- parent expense was deleted in the same transaction
  end if;
  select coalesce(sum(amount_minor), 0) into v_sum
    from expense_payers where expense_id = coalesce(new.expense_id, old.expense_id);
  if v_sum <> v_total then
    raise exception 'expense_payers for expense % sum to % but expense total is %',
      coalesce(new.expense_id, old.expense_id), v_sum, v_total;
  end if;
  return null;
end;
$$;

create constraint trigger expense_payers_sum_trigger
  after insert or update or delete on expense_payers
  deferrable initially deferred
  for each row execute function check_expense_payers_sum();

create function check_expense_splits_sum() returns trigger
language plpgsql as $$
declare
  v_total bigint;
  v_sum bigint;
begin
  select total_minor into v_total from expenses where id = coalesce(new.expense_id, old.expense_id);
  if v_total is null then
    return null;
  end if;
  select coalesce(sum(amount_minor), 0) into v_sum
    from expense_splits where expense_id = coalesce(new.expense_id, old.expense_id);
  if v_sum <> v_total then
    raise exception 'expense_splits for expense % sum to % but expense total is %',
      coalesce(new.expense_id, old.expense_id), v_sum, v_total;
  end if;
  return null;
end;
$$;

create constraint trigger expense_splits_sum_trigger
  after insert or update or delete on expense_splits
  deferrable initially deferred
  for each row execute function check_expense_splits_sum();

-- also re-check both sums whenever the expense's own total changes
create function check_expense_total_change() returns trigger
language plpgsql as $$
declare
  v_payers_sum bigint;
  v_splits_sum bigint;
begin
  select coalesce(sum(amount_minor), 0) into v_payers_sum from expense_payers where expense_id = new.id;
  select coalesce(sum(amount_minor), 0) into v_splits_sum from expense_splits where expense_id = new.id;
  if v_payers_sum <> new.total_minor then
    raise exception 'expense_payers for expense % sum to % but expense total is %', new.id, v_payers_sum, new.total_minor;
  end if;
  if v_splits_sum <> new.total_minor then
    raise exception 'expense_splits for expense % sum to % but expense total is %', new.id, v_splits_sum, new.total_minor;
  end if;
  return null;
end;
$$;

create constraint trigger expense_total_change_trigger
  after update of total_minor on expenses
  deferrable initially deferred
  for each row execute function check_expense_total_change();

-- every member referenced by a payer/split row must belong to the expense's trip

create function check_payer_member_trip() returns trigger
language plpgsql as $$
declare
  v_expense_trip uuid;
  v_member_trip uuid;
begin
  select trip_id into v_expense_trip from expenses where id = new.expense_id;
  select trip_id into v_member_trip from members where id = new.member_id;
  if v_expense_trip is distinct from v_member_trip then
    raise exception 'member % does not belong to the trip of expense %', new.member_id, new.expense_id;
  end if;
  return new;
end;
$$;

create trigger expense_payers_member_trip_trigger
  before insert or update on expense_payers
  for each row execute function check_payer_member_trip();

create trigger expense_splits_member_trip_trigger
  before insert or update on expense_splits
  for each row execute function check_payer_member_trip();

create function check_settlement_members_trip() returns trigger
language plpgsql as $$
declare
  v_from_trip uuid;
  v_to_trip uuid;
begin
  select trip_id into v_from_trip from members where id = new.from_member;
  select trip_id into v_to_trip from members where id = new.to_member;
  if v_from_trip is distinct from new.trip_id or v_to_trip is distinct from new.trip_id then
    raise exception 'settlement % members must belong to trip %', new.id, new.trip_id;
  end if;
  return new;
end;
$$;

create trigger settlements_member_trip_trigger
  before insert or update on settlements
  for each row execute function check_settlement_members_trip();

-- a ghost member can only be claimed once: user_id may only move from null -> not null

create function check_member_claim() returns trigger
language plpgsql as $$
begin
  if old.user_id is not null and new.user_id is distinct from old.user_id then
    raise exception 'member % is already claimed and cannot be reassigned', old.id;
  end if;
  return new;
end;
$$;

create trigger members_claim_trigger
  before update of user_id on members
  for each row execute function check_member_claim();

-- keep expenses.updated_at current
create function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger expenses_touch_updated_at
  before update on expenses
  for each row execute function touch_updated_at();

-- =========================================================== row-level ===
-- security. Every table is scoped to "is this signed-in user a member of
-- the trip this row belongs to".

alter table trips enable row level security;
alter table members enable row level security;
alter table expenses enable row level security;
alter table expense_payers enable row level security;
alter table expense_splits enable row level security;
alter table settlements enable row level security;
alter table fx_rates enable row level security;

create function is_trip_member(t uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from members m where m.trip_id = t and m.user_id = auth.uid());
$$;

create policy trips_select on trips for select using (is_trip_member(id));
create policy trips_update on trips for update using (is_trip_member(id));
create policy trips_insert on trips for insert with check (created_by = auth.uid());

create policy members_select on members for select using (is_trip_member(trip_id));
create policy members_insert on members for insert with check (is_trip_member(trip_id));
create policy members_update on members for update using (is_trip_member(trip_id));

create policy expenses_all on expenses for all
  using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));

create policy settlements_all on settlements for all
  using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));

create policy expense_payers_all on expense_payers for all
  using (is_trip_member((select trip_id from expenses e where e.id = expense_id)))
  with check (is_trip_member((select trip_id from expenses e where e.id = expense_id)));

create policy expense_splits_all on expense_splits for all
  using (is_trip_member((select trip_id from expenses e where e.id = expense_id)))
  with check (is_trip_member((select trip_id from expenses e where e.id = expense_id)));

-- fx_rates is shared reference data, readable by any signed-in user
create policy fx_rates_select on fx_rates for select using (auth.uid() is not null);

-- ============================================================ join_trip ==
-- The joiner isn't a member yet, so cannot satisfy is_trip_member(). This
-- runs as the function owner and is the only way to join by invite code.
-- Returns the trip id on success. Never reveals whether a code exists.

create function join_trip(p_code text) returns uuid
language plpgsql security definer as $$
declare
  v_trip_id uuid;
  v_display_name text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select id into v_trip_id from trips
    where lower(invite_code) = lower(p_code) and archived_at is null;

  if v_trip_id is null then
    raise exception 'invalid invite code';
  end if;

  select coalesce(email, 'Member') into v_display_name from auth.users where id = auth.uid();

  insert into members (trip_id, user_id, display_name)
    values (v_trip_id, auth.uid(), split_part(v_display_name, '@', 1))
    on conflict (trip_id, user_id) do nothing;

  return v_trip_id;
end;
$$;

revoke all on function join_trip(text) from public;
grant execute on function join_trip(text) to authenticated;

-- ================================================ trip_name_for_code =====
-- Lets the /join/<code> screen show "Join <trip name>?" before the user
-- has a membership row (and thus before RLS would let them read the trip).
-- Returns null rather than raising when the code doesn't match, so the
-- caller can show a generic "invalid code" message either way.

create function trip_name_for_code(p_code text) returns text
language sql security definer stable as $$
  select name from trips where lower(invite_code) = lower(p_code) and archived_at is null;
$$;

revoke all on function trip_name_for_code(text) from public;
grant execute on function trip_name_for_code(text) to authenticated;
