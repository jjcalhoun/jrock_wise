-- ============================================================================
-- Explain "Free to spend" for one month, input by input.
--
-- A mirror of lib/commitments/ledger.ts in SQL, so the number on the home
-- screen can be checked against the database without reading the app's mind:
--
--   freeToSpend = incomeEffective + extraIncome
--                 - commitmentsEffective - discretionary
--
-- Read-only. Nothing here writes.
--
-- Set the month by find-and-replacing '2026-08' (it appears in each section),
-- then run the whole file. It prints five results:
--   1. the summary, and the free-to-spend it implies
--   2. every commitment line, and what it contributes
--   3. discretionary spending, by account
--   4. LIVE SERIES WITH NO LINE THIS MONTH  <- the usual culprit
--   5. liability spending excluded from the cash view
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The summary. Compare free_to_spend against what the app displays.
-- ----------------------------------------------------------------------------
with c as (
  select * from public.commitments
  where period = '2026-08' and not skipped and covered_by is null
),
-- mirrors linkedActual(): income sums signed; everything else prefers the
-- OUTFLOW legs, so a two-sided transfer isn't counted on both sides
settled as (
  select c.id, c.kind, c.amount, l.legs, l.outflow, l.total
  from c
  cross join lateral (
    select count(*) as legs,
           count(*) filter (where t.amount < 0) as outflow,
           coalesce(sum(t.amount), 0) as total
    from public.transactions t where t.commitment_id = c.id
  ) l
),
eff as (
  select kind, amount,
    case
      when legs = 0 then amount                       -- nothing linked: the plan
      when kind = 'income' then total
      else -(select coalesce(sum(abs(t.amount)), 0)
               from public.transactions t
              where t.commitment_id = settled.id
                and (outflow = 0 or t.amount < 0))
    end as effective
  from settled
),
flows as (
  select
    coalesce(sum(case when t.type = 'income' then t.amount end), 0) as extra_income,
    coalesce(sum(
      case when t.type = 'transfer' and t.amount > 0
            and a.type in ('loan','credit','savings') then t.amount end), 0) as extra_committed,
    coalesce((
      select sum(-s.amount)
      from public.transactions t2
      join public.transaction_splits s on s.transaction_id = t2.id
      join public.accounts a2 on a2.id = t2.account_id
      where t2.commitment_id is null
        and to_char(t2.date,'YYYY-MM') = '2026-08'
        and t2.type not in ('income','transfer')
        and a2.type not in ('credit','loan')
    ), 0) as split_spend
  from public.transactions t
  join public.accounts a on a.id = t.account_id
  where t.commitment_id is null
    and to_char(t.date,'YYYY-MM') = '2026-08'
)
select
  (select coalesce(sum(amount), 0) from eff where kind = 'income')              as expected_income,
  (select coalesce(sum(effective), 0) from eff where kind = 'income')           as income_effective,
  (select coalesce(sum(-amount), 0) from eff where kind <> 'income')            as commitments_planned,
  (select coalesce(sum(-effective), 0) from eff where kind <> 'income')         as commitments_effective,
  f.extra_income,
  f.split_spend + f.extra_committed                                            as discretionary,
  (select coalesce(sum(effective), 0) from eff where kind = 'income')
    + f.extra_income
    - (select coalesce(sum(-effective), 0) from eff where kind <> 'income')
    - (f.split_spend + f.extra_committed)                                      as free_to_spend
from flows f;

-- ----------------------------------------------------------------------------
-- 2. Every line, and what it contributes. `effective` is what the ledger uses:
--    the actual once something links, the plan until then.
-- ----------------------------------------------------------------------------
select
  c.due_hint,
  c.name,
  c.kind,
  c.amount                                   as planned,
  c.skipped,
  c.covered_by is not null                   as covered,
  (select count(*) from public.transactions t where t.commitment_id = c.id) as links,
  (select coalesce(sum(t.amount), 0) from public.transactions t
    where t.commitment_id = c.id)            as linked_total,
  case
    when c.skipped or c.covered_by is not null then 0
    when exists (select 1 from public.transactions t where t.commitment_id = c.id)
      then (select coalesce(sum(t.amount), 0) from public.transactions t where t.commitment_id = c.id)
    else c.amount
  end                                        as effective
from public.commitments c
where c.period = '2026-08'
order by c.kind, c.due_hint nulls last, c.name;

-- ----------------------------------------------------------------------------
-- 3. Discretionary: unlinked spending that DOES reduce free-to-spend.
-- ----------------------------------------------------------------------------
select
  a.name                       as account,
  a.type                       as account_type,
  count(distinct t.id)         as txns,
  sum(-s.amount)               as counted_against_you
from public.transactions t
join public.transaction_splits s on s.transaction_id = t.id
join public.accounts a on a.id = t.account_id
where t.commitment_id is null
  and to_char(t.date,'YYYY-MM') = '2026-08'
  and t.type not in ('income','transfer')
  and a.type not in ('credit','loan')
group by a.name, a.type
order by counted_against_you desc;

-- ----------------------------------------------------------------------------
-- 4. THE USUAL CULPRIT: a live series with no line in this month.
--
--    A series with no commitment for the period is invisible to the ledger —
--    it neither expects nor spends, so free-to-spend reads high by exactly its
--    amount. Opening the month plan materializes the period and fixes it.
-- ----------------------------------------------------------------------------
with latest as (
  select distinct on (series_id) series_id, name, kind, amount, period, series_ended
  from public.commitments
  order by series_id, period desc, seq desc
)
select l.name, l.kind, l.amount as would_have_expected, l.period as last_seen_in
from latest l
where not l.series_ended
  and not exists (
    select 1 from public.commitments c
    where c.series_id = l.series_id and c.period = '2026-08'
  )
order by l.kind, l.name;

-- ----------------------------------------------------------------------------
-- 5. Spending on liability accounts, EXCLUDED from free-to-spend by design.
--
--    Card purchases are meant to be carried by a card-payment commitment. If
--    section 2 shows no cc_payment line, this total is money that reduced
--    nothing — the second way free-to-spend reads high.
-- ----------------------------------------------------------------------------
select
  a.name                as liability_account,
  a.type                as account_type,
  count(distinct t.id)  as txns,
  sum(-s.amount)        as spent_but_not_counted
from public.transactions t
join public.transaction_splits s on s.transaction_id = t.id
join public.accounts a on a.id = t.account_id
where t.commitment_id is null
  and to_char(t.date,'YYYY-MM') = '2026-08'
  and t.type not in ('income','transfer')
  and a.type in ('credit','loan')
group by a.name, a.type
order by spent_but_not_counted desc;
