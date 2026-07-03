-- ============================================================================
-- Investment / retirement calculator inputs (per-user, on settings)
--   Balance + expected return already exist; add the contribution and age
--   inputs used to project a value at retirement.
-- ============================================================================

alter table public.settings
  add column invest_monthly        numeric(14,2) not null default 0,
  add column invest_employer_match numeric(14,2) not null default 0,
  add column invest_current_age    int,
  add column invest_retire_age     int;
