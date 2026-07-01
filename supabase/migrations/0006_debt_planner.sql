-- ============================================================================
-- Debt planner
--   Adds an editable minimum payment per liability account, plus planner inputs
--   on settings: investments balance/return and the monthly-surplus split
--   (savings % / investments % / the remainder → extra debt paydown).
-- ============================================================================

alter table public.accounts
  add column min_payment numeric(14,2);

alter table public.settings
  add column investments_balance      numeric(14,2) not null default 0,
  add column investments_return       numeric(6,3)  not null default 0,
  add column surplus_savings_pct      int not null default 20 check (surplus_savings_pct between 0 and 100),
  add column surplus_investments_pct  int not null default 0  check (surplus_investments_pct between 0 and 100);
