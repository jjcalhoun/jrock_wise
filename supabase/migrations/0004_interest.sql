-- ============================================================================
-- Estimated interest accrual for manual liability accounts
--   Synced (SimpleFIN) accounts get the bank's real interest charge in their
--   feed, so this is only for manual loans/cards: monthly interest computed from
--   the outstanding balance and APR, posting on a statement day (default: the
--   last day of the month).
-- ============================================================================

alter table public.accounts
  add column statement_day int check (statement_day between 1 and 31);

-- Allow an 'interest' transaction source for these generated rows.
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('manual','csv','sync','recurring','interest'));
