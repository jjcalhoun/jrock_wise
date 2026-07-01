-- ============================================================================
-- Budget bucket on transfers
--   A transfer is normally excluded from the budget, but a transfer INTO savings
--   (or debt payoff) is a real "savings" allocation. This optional bucket lets a
--   transfer count toward a bucket (savings) once, on a single side of the pair.
-- ============================================================================

alter table public.transactions
  add column bucket text check (bucket in ('needs','wants','savings'));
