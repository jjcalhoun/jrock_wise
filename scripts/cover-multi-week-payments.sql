-- ============================================================================
-- Backfill `covered_by` for lump payments made before multi-select existed.
--
-- One payment can settle several occurrences: you send one cheque that covers
-- two weeks of child support. The picker learned to say so (the first pick is
-- the primary and carries the full amount; the rest get `covered_by` and count
-- zero), but payments made BEFORE that shipped only ever got their primary
-- link. Their second week still reads unpaid, forever.
--
-- This finds those and finishes the job. A payment qualifies when:
--   * it is already linked to a commitment (transactions.commitment_id), and
--   * its magnitude is at least 1.8x that commitment's planned amount, so it
--     plainly paid more than one occurrence, and
--   * the NEXT occurrence in the same series is still unsettled — nothing
--     linked to it, not skipped, not already covered.
--
-- It covers as many following occurrences as the money stretches to, taking
-- them in date order, and never spends more than the payment was worth.
--
-- NO TRANSACTIONS ARE TOUCHED. The only write is `commitments.covered_by`,
-- which is reversible: `update commitments set covered_by = null where ...`.
--
-- USAGE: run STEP 1 alone and read it. If the pairings look right, run STEP 2.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1 — report. What would be covered, and by what.
-- ----------------------------------------------------------------------------
with payment as (
  select
    t.id            as txn_id,
    t.date          as paid_on,
    abs(t.amount)   as paid,
    c.id            as primary_id,
    c.series_id,
    c.name,
    abs(c.amount)   as per_occurrence
  from public.transactions t
  join public.commitments c on c.id = t.commitment_id
  where t.amount <> 0
    and abs(c.amount) > 0
    and abs(t.amount) >= abs(c.amount) * 1.8
),
-- occurrences after the one the payment is linked to, in date order
follower as (
  select
    p.txn_id,
    p.name,
    p.paid,
    p.per_occurrence,
    f.id   as cover_id,
    f.due_hint,
    row_number() over (
      partition by p.txn_id
      order by f.due_hint nulls last, f.period, f.seq
    ) as rn
  from payment p
  join public.commitments f
    on  f.series_id = p.series_id
    and f.id <> p.primary_id
    and f.skipped = false
    and f.covered_by is null
    and coalesce(f.due_hint, (f.period || '-01')::date) >= coalesce(
          (select due_hint from public.commitments where id = p.primary_id),
          (select (period || '-01')::date from public.commitments where id = p.primary_id)
        )
    -- unsettled: no payment of its own
    and not exists (
      select 1 from public.transactions x where x.commitment_id = f.id
    )
)
select
  txn_id,
  name,
  paid            as payment_amount,
  per_occurrence  as planned_each,
  cover_id,
  due_hint        as would_be_marked_covered
from follower
-- only as many extra weeks as the payment actually covers
where rn <= floor(paid / per_occurrence) - 1
order by name, due_hint;

-- ----------------------------------------------------------------------------
-- STEP 2 — apply. Same query, written down.
-- ----------------------------------------------------------------------------
-- begin;
--
-- with payment as (
--   select t.id as txn_id, abs(t.amount) as paid, c.id as primary_id,
--          c.series_id, abs(c.amount) as per_occurrence
--   from public.transactions t
--   join public.commitments c on c.id = t.commitment_id
--   where t.amount <> 0 and abs(c.amount) > 0
--     and abs(t.amount) >= abs(c.amount) * 1.8
-- ),
-- follower as (
--   select p.txn_id, p.paid, p.per_occurrence, f.id as cover_id,
--          row_number() over (partition by p.txn_id
--                             order by f.due_hint nulls last, f.period, f.seq) as rn
--   from payment p
--   join public.commitments f
--     on  f.series_id = p.series_id
--     and f.id <> p.primary_id
--     and f.skipped = false
--     and f.covered_by is null
--     and coalesce(f.due_hint, (f.period || '-01')::date) >= coalesce(
--           (select due_hint from public.commitments where id = p.primary_id),
--           (select (period || '-01')::date from public.commitments where id = p.primary_id))
--     and not exists (select 1 from public.transactions x where x.commitment_id = f.id)
-- )
-- update public.commitments c
-- set covered_by = f.txn_id, updated_at = now()
-- from follower f
-- where c.id = f.cover_id
--   and f.rn <= floor(f.paid / f.per_occurrence) - 1;
--
-- commit;
