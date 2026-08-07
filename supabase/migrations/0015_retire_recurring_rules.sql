-- ============================================================================
-- Retire recurring_rules, month_plans, month_plan_items and plan_item_id.
--
-- These were the two-table version of one idea. `recurring_rules` held what
-- repeats; `month_plan_items` held what that means for a given month; and
-- something had to keep them in step. That sync step is where the bugs lived:
-- duplicate series a day or two apart, edits that reached one copy and not the
-- other, and a generator that wrote a transaction the moment a date passed
-- whether or not the payment had happened.
--
-- `commitments` (0012) replaced all of it with one row per occurrence carrying
-- its own schedule, so the newest row in a series IS the rule. Everything has
-- read it since phase 2 and written it since phase 3. This drops what's left.
--
-- Three things move out before the tables go:
--   1. month_plans.confirmed_at -> plan_periods. All that survived of a "plan"
--      was the timestamp saying you'd looked at the month.
--   2. Mortgage escrow -> accounts.escrow_amount. The generator's last real
--      job was posting one escrow charge a month against a loan. That is a
--      property of the account, so it posts beside interest now (lib/escrow.ts)
--      and nothing writes transactions on a schedule any more.
--   3. Any live rule with no commitments at all would otherwise vanish. There
--      should be none — creation has written commitments since phase 3 — so
--      this reports rather than guesses: see the safety check at the end.
--
-- NO TRANSACTIONS ARE DELETED, including the rows the generator already wrote.
-- They are real history; they simply have no generator behind them any more.
-- ============================================================================

-- Atomic on purpose: the safety check in step 3 is only a safety check if a
-- failure leaves the database exactly as it was.
begin;

-- ----------------------------------------------------------------------------
-- 1. plan_periods — "have you looked at this month yet", and nothing else.
-- ----------------------------------------------------------------------------
create table public.plan_periods (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  period       text not null check (period ~ '^\d{4}-\d{2}$'),
  confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, period)
);

alter table public.plan_periods enable row level security;

create policy "owner_all" on public.plan_periods
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into public.plan_periods (user_id, period, confirmed_at, created_at, updated_at)
select user_id, month, confirmed_at, created_at, updated_at
from public.month_plans
on conflict (user_id, period) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Escrow becomes an account setting.
--
--    An escrow charge was modelled as an expense rule posting ONTO the loan
--    account — the only way to say "this much of the payment wasn't principal"
--    when the only tool available was a schedule that writes transactions.
--    A rule that is an expense, on a loan account, and pays no one else is
--    exactly that shape and nothing else.
--
--    Already-posted escrow rows are left alone; lib/escrow.ts dedupes on
--    external_id, so it picks up from the next unposted statement.
-- ----------------------------------------------------------------------------
update public.accounts a
set escrow_amount = sub.amount
from (
  select r.account_id, max(abs(r.amount)) as amount
  from public.recurring_rules r
  join public.accounts acc on acc.id = r.account_id
  where r.active
    and r.type = 'expense'
    and acc.type = 'loan'
  group by r.account_id
) sub
where a.id = sub.account_id
  and coalesce(a.escrow_amount, 0) = 0;

-- ----------------------------------------------------------------------------
-- 3. Safety check: a live rule with no commitment anywhere would be silently
--    lost. Creation has written commitments since phase 3, so this should find
--    nothing — and if it finds something, the migration stops rather than
--    dropping a bill the plan never learned about.
-- ----------------------------------------------------------------------------
do $$
declare
  orphans int;
  names   text;
begin
  select count(*), string_agg(r.name, ', ')
    into orphans, names
  from public.recurring_rules r
  where r.active
    and not exists (select 1 from public.commitments c where c.series_id = r.id)
    -- the escrow rules just absorbed into accounts.escrow_amount are expected
    -- to have no plan line of their own
    and not exists (
      select 1 from public.accounts acc
      where acc.id = r.account_id and acc.type = 'loan' and r.type = 'expense'
    );

  if orphans > 0 then
    raise exception
      'Refusing to drop recurring_rules: % active rule(s) have no commitments (%). Open the month plan once to materialize them, then re-run.',
      orphans, names;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Drop it.
--
--    plan_item_id goes last. transactions.commitment_id has carried every link
--    since 0012's backfill, and nothing has read plan_item_id since phase 2.
-- ----------------------------------------------------------------------------
alter table public.transactions drop column plan_item_id;

drop table public.month_plan_items;
drop table public.month_plans;
drop table public.recurring_rules;

-- Rows the old generator wrote keep source = 'recurring' — they are history and
-- the check constraint still has to accept them. 'escrow' joins the list for
-- the charge that replaces the generator's last job.
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions
  add constraint transactions_source_check
  check (source in ('manual','csv','sync','recurring','interest','escrow'));

commit;
