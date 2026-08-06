-- ============================================================================
-- One payment covering several occurrences.
--
--   A weekly child-support payment is often sent as one lump for three or four
--   weeks. The transaction fulfills ONE commitment through commitment_id, and
--   the other weeks are marked covered_by that same transaction.
--
--   Why not just skip the extra weeks: skipping says "this didn't apply this
--   month", which is a different fact and reads differently in the plan. These
--   weeks DID happen and WERE paid — just not by their own transaction. The
--   ledger counts them at zero (the primary line carries the full amount, so
--   the cash is counted exactly once) while still showing as settled.
-- ============================================================================

alter table public.commitments
  add column covered_by uuid references public.transactions (id) on delete set null;

create index commitments_covered_by_idx on public.commitments (covered_by)
  where covered_by is not null;

comment on column public.commitments.covered_by is
  'Settled by a transaction that primarily fulfills a different commitment. Counts as zero in the ledger — the primary line carries the whole amount.';
