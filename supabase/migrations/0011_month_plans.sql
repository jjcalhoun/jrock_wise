-- ============================================================================
-- Month plans: the explicit ledger behind "Free to spend".
--   A plan is a per-month snapshot of expected income and committed outgoing
--   payments (drafted from recurring_rules, then user-confirmed/edited).
--   Items are matched to real transactions via transactions.plan_item_id —
--   fuzzy matching only *suggests*; the ledger runs on these explicit links.
-- ============================================================================

create table public.month_plans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  month        text not null check (month ~ '^\d{4}-\d{2}$'),
  confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, month)
);

create table public.month_plan_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  plan_id    uuid not null references public.month_plans (id) on delete cascade,
  rule_id    uuid references public.recurring_rules (id) on delete set null,
  name       text not null,
  kind       text not null check (kind in ('income', 'bill', 'debt', 'savings', 'cc_payment')),
  amount     numeric(12,2) not null, -- signed: income positive, outgoing negative
  due_date   date,
  variable   boolean not null default false, -- variable bills always confirm in review
  excluded   boolean not null default false, -- kept but not counted this month
  created_at timestamptz not null default now()
);

create index month_plan_items_plan_idx on public.month_plan_items (plan_id);

-- Explicit link: a transaction that fulfills a plan item.
alter table public.transactions
  add column plan_item_id uuid references public.month_plan_items (id) on delete set null;

create index transactions_plan_item_idx on public.transactions (plan_item_id)
  where plan_item_id is not null;

alter table public.month_plans enable row level security;
alter table public.month_plan_items enable row level security;

create policy "owner_all" on public.month_plans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "owner_all" on public.month_plan_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
