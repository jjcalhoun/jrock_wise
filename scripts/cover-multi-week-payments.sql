-- ============================================================================
-- Backfill `covered_by` for lump payments made before multi-select existed.
--
-- One payment can settle several occurrences: you send one cheque that covers
-- two weeks of child support. The picker learned to say so (the first pick is
-- the primary and carries the full amount; the rest get `covered_by` and count
-- zero), but payments made BEFORE that shipped only ever got their primary
-- link. Their second week still reads unpaid, forever.
--
-- A payment qualifies when:
--   * it is already linked to a commitment (transactions.commitment_id), and
--   * its magnitude is at least 1.8x that commitment's planned amount, so it
--     plainly paid more than one occurrence, and
--   * the occurrences IMMEDIATELY AFTER its own are still open.
--
-- ---------------------------------------------------------------------------
-- That last word — immediately — is the whole correctness argument, and the
-- first draft of this script got it wrong. It looked for the next *unsettled*
-- occurrence, which let a payment reach forward across weeks that were already
-- settled and land on one months away. Two separate $412 payments both
-- selected the same August commitment; whichever the UPDATE reached second
-- would have won, silently, and one payment's coverage would have vanished.
--
-- Contiguity fixes both halves at once. A payment only ever looks at the weeks
-- directly following its own, so two payments cannot select the same week, and
-- a payment whose next week is ALREADY settled covers nothing — because its
-- extra money is evidently already accounted for. Doing nothing is the correct
-- answer there, and the old version could not express it.
-- ---------------------------------------------------------------------------
--
-- NO TRANSACTIONS ARE TOUCHED. The only write is `commitments.covered_by`,
-- which is reversible: `update commitments set covered_by = null where ...`.
--
-- USAGE: run STEP 1 alone and read it. Every row should name a DISTINCT
-- cover_id — if a cover_id appears twice, stop and say so. Then run STEP 2.
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
    abs(c.amount)   as per_occurrence,
    coalesce(c.due_hint, (c.period || '-01')::date) as primary_due
  from public.transactions t
  join public.commitments c on c.id = t.commitment_id
  where t.amount <> 0
    and abs(c.amount) > 0
    and abs(t.amount) >= abs(c.amount) * 1.8
),
-- Every occurrence after the payment's own, in date order — settled ones
-- INCLUDED, because their position is what makes "immediately after" mean
-- anything. Excluding them is exactly how the first draft reached too far.
follower as (
  select
    p.txn_id,
    p.name,
    p.paid,
    p.per_occurrence,
    p.paid_on,
    f.id          as cover_id,
    f.due_hint,
    f.skipped,
    f.covered_by,
    exists (select 1 from public.transactions x where x.commitment_id = f.id) as settled,
    row_number() over (
      partition by p.txn_id
      order by coalesce(f.due_hint, (f.period || '-01')::date), f.period, f.seq
    ) as step
  from payment p
  join public.commitments f
    on  f.series_id = p.series_id
    and f.id <> p.primary_id
    and coalesce(f.due_hint, (f.period || '-01')::date) >= p.primary_due
)
select
  txn_id,
  name,
  paid_on,
  paid            as payment_amount,
  per_occurrence  as planned_each,
  cover_id,
  due_hint        as would_be_marked_covered
from follower
-- only as many extra weeks as the payment actually covers ...
where step <= floor(paid / per_occurrence) - 1
  -- ... and only while those weeks are genuinely still open
  and not settled
  and covered_by is null
  and skipped = false
order by name, due_hint;

-- ----------------------------------------------------------------------------
-- STEP 2 — apply. Same query, written down.
-- ----------------------------------------------------------------------------
-- begin;
--
-- with payment as (
--   select t.id as txn_id, abs(t.amount) as paid, c.id as primary_id,
--          c.series_id, abs(c.amount) as per_occurrence,
--          coalesce(c.due_hint, (c.period || '-01')::date) as primary_due
--   from public.transactions t
--   join public.commitments c on c.id = t.commitment_id
--   where t.amount <> 0 and abs(c.amount) > 0
--     and abs(t.amount) >= abs(c.amount) * 1.8
-- ),
-- follower as (
--   select p.txn_id, p.paid, p.per_occurrence, f.id as cover_id,
--          f.skipped, f.covered_by,
--          exists (select 1 from public.transactions x
--                   where x.commitment_id = f.id) as settled,
--          row_number() over (
--            partition by p.txn_id
--            order by coalesce(f.due_hint, (f.period || '-01')::date),
--                     f.period, f.seq) as step
--   from payment p
--   join public.commitments f
--     on  f.series_id = p.series_id
--     and f.id <> p.primary_id
--     and coalesce(f.due_hint, (f.period || '-01')::date) >= p.primary_due
-- )
-- update public.commitments c
-- set covered_by = f.txn_id, updated_at = now()
-- from follower f
-- where c.id = f.cover_id
--   and f.step <= floor(f.paid / f.per_occurrence) - 1
--   and not f.settled
--   and f.covered_by is null
--   and f.skipped = false;
--
-- commit;
