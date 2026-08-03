-- ============================================================================
-- Commitments: recurring rules and month-plan items merged into one table.
--
--   One row per OCCURRENCE. The schedule rides along denormalized and
--   describes how to make the NEXT one, so "the rule" is simply the most
--   recent row in a series. Only the current period is ever materialized,
--   which keeps that duplication to ~1-2 live rows per series.
--
--   Identity is (series_id, period, seq) — NEVER the due date. due_hint
--   drives ordering and overdue nudges only. This is what kills the
--   duplicate class where editing a rule's day forked its identity, and the
--   unique constraint makes same-period twins structurally impossible.
--
--   PHASE 1 IS ADDITIVE AND REVERSIBLE. Nothing reads this table yet:
--   recurring_rules, month_plans and month_plan_items are left intact,
--   transactions.plan_item_id keeps working, and no transaction rows are
--   deleted. Phase 2 switches the ledger over; phase 4 drops the old tables.
-- ============================================================================

create table public.commitments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  series_id    uuid not null,                 -- groups the repeats (not an FK)
  period       text not null check (period ~ '^\d{4}-\d{2}$'),
  seq          smallint not null default 0,   -- 0,1,2… within the period

  -- what
  name         text not null,
  kind         text not null
                 check (kind in ('income','bill','debt','savings','cc_payment')),
  amount       numeric(14,2) not null,        -- signed, PLANNED (actual comes from links)
  -- nullable: a hand-added plan line genuinely has no account
  account_id   uuid references public.accounts (id) on delete cascade,
  transfer_account_id uuid references public.accounts (id) on delete set null,
  category_id  uuid references public.categories (id) on delete set null,
  bucket       text check (bucket in ('needs','wants','savings')),

  -- when: a hint, never identity
  due_hint     date,

  -- how it repeats (describes how to make the NEXT occurrence)
  frequency    text not null default 'monthly'
                 check (frequency in ('monthly','semimonthly','weekly','biweekly')),
  day_of_month   smallint check (day_of_month between 1 and 31),
  day_of_month_2 smallint check (day_of_month_2 between 1 and 31),
  weekday        smallint check (weekday between 0 and 6),
  interval       smallint not null default 1,
  series_ended   boolean not null default false,  -- no future occurrences

  -- state (paid is DERIVED: any linked transaction means paid)
  skipped      boolean not null default false,  -- kept but not counted this period
  variable     boolean not null default false,  -- amount confirmed in review
  auto_confirm boolean not null default false,  -- reserved; no UI, always false for now

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- the anti-duplicate guarantee
  unique (user_id, series_id, period, seq)
);

create index commitments_user_period_idx on public.commitments (user_id, period);
create index commitments_series_idx on public.commitments (series_id, period);
create index commitments_live_idx on public.commitments (user_id, series_ended)
  where series_ended = false;

alter table public.commitments enable row level security;

create policy "owner_all" on public.commitments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Link column. ADDED alongside plan_item_id, not a rename: the app still reads
-- plan_item_id through phases 1-2, so both coexist until phase 4 drops the old
-- one. Many transactions may point at one commitment (split payments, and both
-- legs of a transfer).
-- ----------------------------------------------------------------------------
alter table public.transactions
  add column commitment_id uuid references public.commitments (id) on delete set null;

create index transactions_commitment_idx on public.transactions (commitment_id)
  where commitment_id is not null;

-- ============================================================================
-- Backfill
-- ============================================================================

-- 1. Rule-backed plan items become commitments. The rule's UUID is reused as
--    series_id so existing relationships stay traceable, and seq is assigned by
--    due-date order within (rule, period) — which is what finally gives a
--    semimonthly rule its second line.
insert into public.commitments (
  id, user_id, series_id, period, seq,
  name, kind, amount, account_id, transfer_account_id, category_id, bucket,
  due_hint, frequency, day_of_month, day_of_month_2, weekday, interval,
  series_ended, skipped, variable, created_at
)
select
  i.id,                    -- keep the item's id so link remapping is a no-op
  i.user_id,
  i.rule_id,
  p.month,
  (row_number() over (partition by i.rule_id, p.month
                      order by i.due_date nulls last, i.created_at, i.id) - 1)::smallint,
  i.name,
  i.kind,
  i.amount,
  r.account_id,
  r.transfer_account_id,
  r.category_id,
  r.bucket,
  i.due_date,
  r.frequency,
  r.day_of_month::smallint,
  r.day_of_month_2::smallint,
  r.weekday::smallint,
  r.interval::smallint,
  -- a paused or expired rule produces no further occurrences
  (not r.active) or (r.end_date is not null and r.end_date < current_date),
  i.excluded,
  i.variable,
  i.created_at
from public.month_plan_items i
join public.month_plans p on p.id = i.plan_id
join public.recurring_rules r on r.id = i.rule_id
where i.rule_id is not null;

-- 2. Orphan plan items (added by hand, no rule) become one-off ended series.
insert into public.commitments (
  id, user_id, series_id, period, seq,
  name, kind, amount, due_hint, frequency, series_ended, skipped, variable, created_at
)
select
  i.id,
  i.user_id,
  gen_random_uuid(),
  p.month,
  0,
  i.name,
  i.kind,
  i.amount,
  i.due_date,
  'monthly',
  true,          -- one-off: never clones forward
  i.excluded,
  i.variable,
  i.created_at
from public.month_plan_items i
join public.month_plans p on p.id = i.plan_id
where i.rule_id is null;

-- 3. Carry the links over. Because commitments reuse the plan item's id, this
--    is a straight copy — and it stays correct if the app writes more
--    plan_item_id values before phase 2 lands.
update public.transactions t
set commitment_id = t.plan_item_id
where t.plan_item_id is not null
  and exists (select 1 from public.commitments c where c.id = t.plan_item_id);

-- ----------------------------------------------------------------------------
-- NOT done here, deliberately:
--   * Live rules with no line in the current period get their occurrence from
--     phase 2's clone-forward, which owns the date math. Reimplementing
--     occurrences() in PL/pgSQL just to duplicate it is not worth the risk.
--   * Future-dated `source = 'recurring'` rows are left alone. Deleting them
--     would move balances and the ledger while the app still reads the old
--     tables. Phase 2 retires them in the same change that stops relying
--     on them.
-- ----------------------------------------------------------------------------
