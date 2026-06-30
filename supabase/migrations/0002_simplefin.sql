-- ============================================================================
-- SimpleFIN integration  (Phase 1)
--   Adds automatic balance + transaction retrieval via SimpleFIN Bridge.
--   The access URL is a bearer credential and is stored ENCRYPTED (AES-256-GCM,
--   encrypted/decrypted only in server route handlers — never in SQL/the client).
-- ============================================================================

-- One SimpleFIN connection (= one claimed access URL) per row.
create table public.simplefin_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  access_url_enc text not null,                 -- AES-256-GCM ciphertext (iv:tag:data)
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index simplefin_connections_user_idx on public.simplefin_connections (user_id);
create trigger simplefin_connections_updated before update on public.simplefin_connections
  for each row execute function public.set_updated_at();

-- Maps a SimpleFIN account to one of our accounts. One mapping per SimpleFIN
-- account; deleting a connection or account cleans up its mappings.
create table public.simplefin_account_map (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  connection_id        uuid not null references public.simplefin_connections (id) on delete cascade,
  simplefin_account_id text not null,
  account_id           uuid not null references public.accounts (id) on delete cascade,
  org_name             text,
  created_at           timestamptz not null default now(),
  unique (user_id, simplefin_account_id)
);
create index simplefin_account_map_user_idx on public.simplefin_account_map (user_id);

-- Live balance from SimpleFIN for linked accounts. When present, the balance
-- view trusts it instead of computing from transactions (decision 1: trust
-- SimpleFIN's live balance for linked accounts). Manual/CSV accounts leave
-- these null and keep the computed balance.
alter table public.accounts add column live_balance    numeric(14,2);
alter table public.accounts add column live_balance_at timestamptz;

-- Best-guess auto-categorization of imported transactions (decision 3):
-- on by default, can be turned off in Settings.
alter table public.settings
  add column autocategorize_imports boolean not null default true;

-- ----------------------------------------------------------------------------
-- Balance view: prefer the SimpleFIN live balance when present, else fall back
-- to the original rule (starting_balance + transactions strictly after as_of).
-- ----------------------------------------------------------------------------
create or replace view public.account_balances with (security_invoker = true) as
select
  a.id      as account_id,
  a.user_id as user_id,
  coalesce(
    a.live_balance,
    a.starting_balance
      + coalesce(sum(t.amount) filter (where t.date > a.as_of_date), 0)
  ) as balance
from public.accounts a
left join public.transactions t on t.account_id = a.id
group by a.id;

-- ----------------------------------------------------------------------------
-- Row level security (owner-only, same pattern as 0001).
-- ----------------------------------------------------------------------------
alter table public.simplefin_connections  enable row level security;
alter table public.simplefin_account_map  enable row level security;

create policy "owner_all" on public.simplefin_connections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner_all" on public.simplefin_account_map
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
