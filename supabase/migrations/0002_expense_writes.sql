-- Transactional writes for expenses. A single RPC call is one Postgres
-- transaction, so the deferred sum-check triggers on expense_payers /
-- expense_splits see the complete, consistent set of rows before they fire
-- at COMMIT — something three separate supabase-js calls could not
-- guarantee. security invoker: RLS still applies to every statement below,
-- so this grants no privilege the caller didn't already have.

create function upsert_expense(
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
    where trip_id = p_trip_id and user_id = auth.uid();
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

revoke all on function upsert_expense(uuid, uuid, text, text, char(3), bigint, bigint, bigint, bigint, numeric, boolean, date, text, boolean, jsonb, jsonb) from public;
grant execute on function upsert_expense(uuid, uuid, text, text, char(3), bigint, bigint, bigint, bigint, numeric, boolean, date, text, boolean, jsonb, jsonb) to authenticated;

create function soft_delete_expense(p_id uuid) returns void
language sql security invoker as $$
  update expenses set deleted_at = now() where id = p_id;
$$;

grant execute on function soft_delete_expense(uuid) to authenticated;
