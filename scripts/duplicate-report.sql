-- ============================================================================
-- Suspected duplicate recurring series — READ ONLY, changes nothing.
--
-- Run in the Supabase SQL editor. Mirrors lib/commitments/duplicates.ts:
-- same account, same direction of money, matching identity token, and amounts
-- within 15%. Nothing is merged automatically — this is the list to eyeball
-- before phase 3 offers a Merge action.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The cause: two active rules for one real-world bill.
-- ---------------------------------------------------------------------------
with toks as (
  select
    r.id, r.name, r.account_id, r.amount, r.frequency,
    r.day_of_month, r.weekday,
    a.name as account_name,
    string_to_array(
      trim(regexp_replace(lower(r.name), '[^a-z0-9]+', ' ', 'g')), ' '
    ) as parts
  from public.recurring_rules r
  left join public.accounts a on a.id = r.account_id
  where r.active
),
keyed as (
  select
    t.*,
    (
      select p from unnest(t.parts) p
      where length(p) > 1
        and p !~ '^\d+$'
        and p not in (
          'com','inc','llc','ltd','co','corp','company','the','payment','payments',
          'pmt','autopay','auto','recurring','bill','billpay','ach','pos','debit',
          'credit','purchase','web','online','id','ref','transfer','xfer','monthly',
          'subscription','sub'
        )
      limit 1
    ) as head
  from toks t
)
select
  a.head                                        as identity_token,
  a.account_name,
  a.name        as name_a,
  a.amount      as amount_a,
  a.frequency   as freq_a,
  coalesce(a.day_of_month, a.weekday)           as day_a,
  b.name        as name_b,
  b.amount      as amount_b,
  b.frequency   as freq_b,
  coalesce(b.day_of_month, b.weekday)           as day_b,
  round(
    abs(abs(a.amount) - abs(b.amount))
      / nullif(least(abs(a.amount), abs(b.amount)), 0) * 100
  , 1)                                          as amount_diff_pct,
  a.id          as rule_id_a,
  b.id          as rule_id_b
from keyed a
join keyed b
  on  a.id < b.id
  and a.account_id is not distinct from b.account_id
  and sign(a.amount) = sign(b.amount)
  and a.head = b.head
where a.head is not null
  and abs(abs(a.amount) - abs(b.amount))
        <= greatest(least(abs(a.amount), abs(b.amount)) * 0.15, 0.01)
order by a.head;


-- ---------------------------------------------------------------------------
-- 2. The symptom you actually saw: two planned lines for one bill, days apart.
--    (Change the month if you want to look further back.)
-- ---------------------------------------------------------------------------
with items as (
  select
    p.month, i.id, i.name, i.kind, i.amount, i.due_date, i.rule_id, i.excluded,
    (
      select x from unnest(
        string_to_array(trim(regexp_replace(lower(i.name), '[^a-z0-9]+', ' ', 'g')), ' ')
      ) x
      where length(x) > 1 and x !~ '^\d+$'
      limit 1
    ) as head
  from public.month_plan_items i
  join public.month_plans p on p.id = i.plan_id
  where p.month = to_char(now() at time zone 'America/Indiana/Indianapolis', 'YYYY-MM')
    and not i.excluded
)
select
  a.month,
  a.head            as identity_token,
  a.name            as name_a,
  a.due_date        as due_a,
  a.amount          as amount_a,
  b.name            as name_b,
  b.due_date        as due_b,
  b.amount          as amount_b,
  abs(b.due_date - a.due_date) as days_apart,
  a.rule_id         as rule_id_a,
  b.rule_id         as rule_id_b
from items a
join items b
  on  a.id < b.id
  and a.head = b.head
  and a.kind = b.kind
  -- two lines from the SAME rule are a legitimate semimonthly/biweekly pair,
  -- not a duplicate. Only cross-rule twins are suspicious.
  and a.rule_id is distinct from b.rule_id
where a.head is not null
order by days_apart, a.head;


-- ---------------------------------------------------------------------------
-- 3. Sanity check after running migration 0012 — these should all be 0 rows.
-- ---------------------------------------------------------------------------

-- every plan item became a commitment
select count(*) as items_not_migrated
from public.month_plan_items i
where not exists (select 1 from public.commitments c where c.id = i.id);

-- every link carried over
select count(*) as links_not_carried
from public.transactions t
where t.plan_item_id is not null and t.commitment_id is null;

-- semimonthly series should now have two lines in a period (this lists them;
-- previously the second was never created)
select series_id, period, count(*) as lines
from public.commitments
group by series_id, period
having count(*) > 1
order by lines desc;
