-- ============================================================================
-- Apply the coverage that cover-multi-week-payments.sql reported.
--
-- Runnable as-is. Read the report first — every row it prints must name a
-- DISTINCT cover_id, because two payments cannot settle the same week.
--
-- The rule is CONTIGUITY: a payment covers the weeks immediately after its
-- own, settled ones included in the ordering because their position is what
-- makes "immediately after" mean anything. That is what stops a payment
-- reaching forward across weeks already settled by someone else, and what
-- lets a payment whose next week is already settled correctly cover nothing.
--
-- NO TRANSACTIONS ARE TOUCHED. The only write is `commitments.covered_by`,
-- reversible with: update public.commitments set covered_by = null where ...
-- ============================================================================

begin;

with payment as (
  select t.id as txn_id, abs(t.amount) as paid, c.id as primary_id,
         c.series_id, abs(c.amount) as per_occurrence,
         coalesce(c.due_hint, (c.period || '-01')::date) as primary_due
  from public.transactions t
  join public.commitments c on c.id = t.commitment_id
  where t.amount <> 0 and abs(c.amount) > 0
    and abs(t.amount) >= abs(c.amount) * 1.8
),
follower as (
  select p.txn_id, p.paid, p.per_occurrence, f.id as cover_id,
         f.skipped, f.covered_by,
         exists (select 1 from public.transactions x
                  where x.commitment_id = f.id) as settled,
         row_number() over (
           partition by p.txn_id
           order by coalesce(f.due_hint, (f.period || '-01')::date),
                    f.period, f.seq) as step
  from payment p
  join public.commitments f
    on  f.series_id = p.series_id
    and f.id <> p.primary_id
    and coalesce(f.due_hint, (f.period || '-01')::date) >= p.primary_due
)
update public.commitments c
set covered_by = f.txn_id, updated_at = now()
from follower f
where c.id = f.cover_id
  and f.step <= floor(f.paid / f.per_occurrence) - 1
  and not f.settled
  and f.covered_by is null
  and f.skipped = false;

commit;
