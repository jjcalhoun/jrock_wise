-- ============================================================================
-- Budget PWA — Supabase schema (fresh project)
-- Single user in practice, but modeled multi-tenant with RLS so it's secure and
-- future-proof. Run in the Supabase SQL editor (or as the first migration).
-- ============================================================================

-- ---------- helper: updated_at ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ============================================================================
-- ACCOUNTS
-- ============================================================================
create table public.accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  name             text not null,
  type             text not null check (type in ('checking','savings','credit','loan','cash')),
  last4            text,
  starting_balance numeric(14,2) not null default 0,
  as_of_date       date not null default current_date,   -- balance is "as of" this date
  apr              numeric(6,3) not null default 0,        -- for credit/loan
  color            text,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index accounts_user_idx on public.accounts (user_id);
create trigger accounts_updated before update on public.accounts
  for each row execute function public.set_updated_at();

-- ============================================================================
-- CATEGORIES
-- ============================================================================
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  icon        text not null,                               -- Material Symbols name
  color       text not null,
  bucket      text not null check (bucket in ('needs','wants','savings')),
  is_archived boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index categories_user_idx on public.categories (user_id);
create trigger categories_updated before update on public.categories
  for each row execute function public.set_updated_at();

-- ============================================================================
-- TRANSACTIONS
--   amount is SIGNED: negative = outflow, positive = inflow.
--   type drives aggregation; category/bucket live on splits (below).
-- ============================================================================
create table public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  account_id          uuid not null references public.accounts (id) on delete cascade,
  date                date not null,
  amount              numeric(14,2) not null,
  merchant            text,                                -- display name
  description         text,                                -- raw imported description
  type                text not null default 'expense'
                        check (type in ('expense','income','transfer','refund')),
  transfer_account_id uuid references public.accounts (id),-- counterpart (transfer only)
  transfer_group_id   uuid,                                -- links the two transfer rows
  notes               text,
  source              text not null default 'manual'
                        check (source in ('manual','csv','sync')),
  external_id         text,                                -- raw id for dedupe
  import_batch_id     uuid,
  reviewed            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index transactions_user_date_idx on public.transactions (user_id, date desc);
create index transactions_account_idx   on public.transactions (account_id);
create index transactions_unreviewed_idx on public.transactions (user_id) where reviewed = false;
-- dedupe: same account + same source id can't import twice
create unique index transactions_dedupe_idx
  on public.transactions (user_id, account_id, external_id)
  where external_id is not null;
create trigger transactions_updated before update on public.transactions
  for each row execute function public.set_updated_at();

-- ============================================================================
-- TRANSACTION SPLITS  (one row per category line-item)
--   For expense/refund: split amounts are SIGNED like the parent and sum to it.
--   A normal single-category purchase is exactly one split.
--   income/transfer have NO splits.
-- ============================================================================
create table public.transaction_splits (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  category_id    uuid not null references public.categories (id),
  bucket         text not null check (bucket in ('needs','wants','savings')),
  amount         numeric(14,2) not null,
  created_at     timestamptz not null default now()
);
create index splits_txn_idx on public.transaction_splits (transaction_id);
create index splits_cat_idx on public.transaction_splits (category_id);
create index splits_user_idx on public.transaction_splits (user_id);

-- ============================================================================
-- RECURRING BILLS
-- ============================================================================
create table public.recurring_bills (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  amount       numeric(14,2) not null,
  category_id  uuid references public.categories (id),
  account_id   uuid references public.accounts (id),
  day_of_month int check (day_of_month between 1 and 31),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index recurring_user_idx on public.recurring_bills (user_id);
create trigger recurring_updated before update on public.recurring_bills
  for each row execute function public.set_updated_at();

-- ============================================================================
-- BUDGET PLAN  (one row per user) + per-category targets
-- ============================================================================
create table public.budget_plan (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  income       numeric(14,2) not null default 0,
  plan_needs   int not null default 50,
  plan_wants   int not null default 30,
  plan_savings int not null default 20,
  updated_at   timestamptz not null default now()
);
create trigger budget_plan_updated before update on public.budget_plan
  for each row execute function public.set_updated_at();

create table public.category_budgets (
  user_id        uuid not null references auth.users (id) on delete cascade,
  category_id    uuid not null references public.categories (id) on delete cascade,
  monthly_target numeric(14,2) not null default 0,
  primary key (user_id, category_id)
);

-- ============================================================================
-- SETTINGS  (one row per user)
-- ============================================================================
create table public.settings (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  import_start_date date,
  theme_mode        text not null default 'system' check (theme_mode in ('system','light','dark')),
  debt_strategy     text not null default 'avalanche' check (debt_strategy in ('avalanche','snowball')),
  debt_extra        numeric(14,2) not null default 0,
  updated_at        timestamptz not null default now()
);
create trigger settings_updated before update on public.settings
  for each row execute function public.set_updated_at();

-- ============================================================================
-- BALANCE VIEW
--   Core correctness rule: balance = starting_balance + sum of transactions
--   dated STRICTLY AFTER the account's as_of_date.
--   security_invoker => base-table RLS applies to the querying user.
-- ============================================================================
create view public.account_balances with (security_invoker = true) as
select
  a.id      as account_id,
  a.user_id as user_id,
  a.starting_balance
    + coalesce(sum(t.amount) filter (where t.date > a.as_of_date), 0) as balance
from public.accounts a
left join public.transactions t on t.account_id = a.id
group by a.id;

-- ============================================================================
-- ROW LEVEL SECURITY  (owner-only on every table)
-- ============================================================================
alter table public.accounts            enable row level security;
alter table public.categories          enable row level security;
alter table public.transactions        enable row level security;
alter table public.transaction_splits  enable row level security;
alter table public.recurring_bills     enable row level security;
alter table public.budget_plan         enable row level security;
alter table public.category_budgets    enable row level security;
alter table public.settings            enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'accounts','categories','transactions','transaction_splits',
    'recurring_bills','budget_plan','category_budgets','settings'
  ] loop
    execute format(
      'create policy "owner_all" on public.%I for all
         using (user_id = auth.uid()) with check (user_id = auth.uid());', tbl);
  end loop;
end $$;

-- ============================================================================
-- DEFAULT CATEGORIES + NEW-USER BOOTSTRAP
-- ============================================================================
create or replace function public.seed_default_categories(uid uuid)
returns void language plpgsql as $$
begin
  insert into public.categories (user_id, name, icon, color, bucket, sort_order) values
    (uid,'Housing','home','#14B8A6','needs',1),
    (uid,'Transportation','directions_car','#8B5CF6','needs',2),
    (uid,'Groceries','shopping_cart','#84CC16','needs',3),
    (uid,'Dining Out','restaurant','#22D3EE','wants',4),
    (uid,'Utilities & Bills','receipt_long','#F97316','needs',5),
    (uid,'Shopping','shopping_bag','#D946EF','wants',6),
    (uid,'Health','health_and_safety','#D6B98C','needs',7),
    (uid,'Entertainment','confirmation_number','#60A5FA','wants',8),
    (uid,'Family & Care','volunteer_activism','#FB7185','needs',9),
    (uid,'Pets','pets','#F472B6','wants',10),
    (uid,'Travel','flight','#FACC15','wants',11),
    (uid,'Education','school','#3B82F6','needs',12),
    (uid,'Gifts & Donations','redeem','#FCA5A5','wants',13),
    (uid,'Subscription','autorenew','#2DD4BF','wants',14),
    (uid,'Savings & Investing','savings','#4ADE80','savings',15),
    (uid,'Debt Payments','payments','#A78BFA','savings',16),
    (uid,'Fees','percent','#EF4444','needs',17),
    (uid,'Other','sell','#C084FC','wants',18);
end $$;

-- on signup: create settings + budget plan + default categories
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.settings (user_id, import_start_date) values (new.id, current_date);
  insert into public.budget_plan (user_id) values (new.id);
  perform public.seed_default_categories(new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- NOTES (enforce in the app layer, not shown here):
--   * For expense/refund, splits must sum to transactions.amount.
--   * For income/transfer, there are no splits.
--   * A transfer's two rows share transfer_group_id and point at each other
--     via transfer_account_id; both move balances, neither is spend/income.
--   * Refund splits are positive (they reduce that category's monthly spend).
-- ============================================================================
