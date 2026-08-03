-- ============================================================================
-- Merge two duplicate recurring series into one.
--
-- Duplicates arise because identity is a merchant string and the "make this
-- recurring" path in review has no existence check at all — ticking it on a
-- charge you already had a rule for silently mints a second rule, each taking
-- its day from its own spawning transaction. Hence twins a day or two apart.
--
-- NO TRANSACTIONS ARE EVER DELETED. Real payments are repointed to the
-- surviving series; only the redundant rule and its derived plan lines go.
--
-- The keeper is chosen by evidence: the rule with more linked payments, ties
-- broken by age. Which day-of-month survives barely matters under the
-- commitments model, where the due date is a hint rather than identity.
--
-- Handles three cases, each verified against Postgres 16:
--   1. both series have a line in the same period -> payments move to the
--      keeper's line (closest due date wins if it has several)
--   2. only the loser covers a period -> that line is ADOPTED into the keeper
--      series, so no plan history is lost
--   3. everything left on the loser is removed
--
-- Runs against the old tables AND commitments together, so phase 1's backfill
-- stays consistent.
--
-- USAGE: replace the two UUIDs below, then run the whole script.
-- ============================================================================

begin;

create temp table _merge as
select
  (array_agg(id order by linked desc, created_at asc))[1] as keeper,
  (array_agg(id order by linked desc, created_at asc))[2] as loser
from (
  select r.id, r.created_at,
    (select count(*) from public.transactions t
       join public.month_plan_items i on i.id = t.plan_item_id
      where i.rule_id = r.id) as linked
  from public.recurring_rules r
  where r.id in (
    -- >>> the two duplicate rule ids <<<
    'ac8fc56d-7845-430e-a7a5-422e045ad374',
    'b6cc77b3-7193-4f5b-bf3e-0844261d828b'
  )
) x;

-- 1. payments linked to the loser move to the keeper's line for that period
update public.transactions t
set plan_item_id = m.keep_item, commitment_id = m.keep_item
from (
  select li.id as lose_item, (
    select k.id from public.month_plan_items k
    join public.month_plans kp on kp.id = k.plan_id
    where k.rule_id = (select keeper from _merge) and kp.month = lp.month
    order by abs(k.due_date - li.due_date) nulls last, k.id
    limit 1
  ) as keep_item
  from public.month_plan_items li
  join public.month_plans lp on lp.id = li.plan_id
  where li.rule_id = (select loser from _merge)
) m
where t.plan_item_id = m.lose_item and m.keep_item is not null;

-- 2. periods only the loser covers: adopt the line instead of deleting it
update public.month_plan_items li
set rule_id = (select keeper from _merge)
where li.rule_id = (select loser from _merge)
  and not exists (
    select 1 from public.month_plan_items k
    join public.month_plans kp on kp.id = k.plan_id
    join public.month_plans lp on lp.id = li.plan_id
    where k.rule_id = (select keeper from _merge) and kp.month = lp.month);

update public.commitments c
set series_id = (select keeper from _merge)
where c.series_id = (select loser from _merge)
  and not exists (select 1 from public.commitments k
    where k.series_id = (select keeper from _merge) and k.period = c.period);

-- 3. remove what's left of the redundant series
delete from public.commitments where series_id = (select loser from _merge);
delete from public.month_plan_items where rule_id = (select loser from _merge);
delete from public.recurring_rules where id = (select loser from _merge);

commit;
