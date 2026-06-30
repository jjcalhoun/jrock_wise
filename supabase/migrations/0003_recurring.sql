-- ============================================================================
-- Recurring transactions  (replaces the unused recurring_bills table)
--   Auto-generates predictable transactions for manual accounts: a paycheck
--   allocation transfer, fixed monthly expenses, etc. Occurrences are
--   materialized only up to "today" so computed balances stay accurate.
-- ============================================================================

drop table if exists public.recurring_bills cascade;

-- Allow a new transaction source for generated recurring rows.
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('manual','csv','sync','recurring'));

create table public.recurring_rules (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  name                text not null,
  account_id          uuid not null references public.accounts (id) on delete cascade,
  type                text not null default 'expense'
                        check (type in ('expense','income','transfer')),
  amount              numeric(14,2) not null,                 -- signed
  transfer_account_id uuid references public.accounts (id),   -- transfer counterpart
  category_id         uuid references public.categories (id), -- expense/income split
  bucket              text check (bucket in ('needs','wants','savings')),
  frequency           text not null default 'monthly'
                        check (frequency in ('monthly','semimonthly','weekly','biweekly')),
  day_of_month        int check (day_of_month between 1 and 31),
  day_of_month_2      int check (day_of_month_2 between 1 and 31), -- semimonthly 2nd day
  weekday             int check (weekday between 0 and 6),          -- weekly/biweekly
  interval            int not null default 1,
  start_date          date not null,
  end_date            date,
  auto_review         boolean not null default true,
  last_generated      date,                                   -- watermark
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index recurring_rules_user_idx on public.recurring_rules (user_id);
create trigger recurring_rules_updated before update on public.recurring_rules
  for each row execute function public.set_updated_at();

alter table public.recurring_rules enable row level security;
create policy "owner_all" on public.recurring_rules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
