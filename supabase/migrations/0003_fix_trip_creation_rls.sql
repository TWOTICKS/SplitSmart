-- Fixes a bootstrapping gap in 0001_init.sql's RLS policies: creating a
-- trip failed with "new row violates row-level security policy for table
-- trips" because, at the instant of INSERT ... RETURNING, the creator
-- isn't a trip member yet (that row doesn't exist until the very next
-- statement), so trips_select's is_trip_member() check couldn't see the
-- row it had just inserted. The same chicken-and-egg problem blocks the
-- creator's own first members row: members_insert requires
-- is_trip_member(trip_id), which can't be true before that row exists.
--
-- Both fixes are additional *permissive* policies (Postgres OR's multiple
-- permissive policies for the same command together), scoped narrowly to
-- "you're the trip's creator" — they don't loosen access for anyone else.

create policy trips_select_own on trips for select
  using (created_by = auth.uid());

create policy members_insert_creator_bootstrap on members for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from trips t where t.id = trip_id and t.created_by = auth.uid())
  );
