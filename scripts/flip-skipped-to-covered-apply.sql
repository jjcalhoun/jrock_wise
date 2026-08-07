-- ============================================================================
-- Apply the flip: 7/24 is covered by the 7/17 lump, not skipped.
--
-- Runnable as-is. Read flip-skipped-to-covered.sql first and check that its
-- `payer_is_a_lump` column says true — that is the evidence this is a record
-- of what happened rather than an assertion about it.
--
-- Guarded three ways, so running it twice is a no-op: the row must still be
-- skipped, still uncovered, and have no payment of its own.
--
-- NO TRANSACTIONS ARE TOUCHED. Reversible:
--   update public.commitments
--   set covered_by = null, skipped = true
--   where name ilike '%child support%' and due_hint = date '2026-07-24';
-- ============================================================================

begin;

update public.commitments c
set covered_by = 'ee303af8-66c8-4fa9-b652-4c0988a4a46f'::uuid,
    skipped    = false,
    updated_at = now()
where c.name ilike '%child support%'
  and c.due_hint = date '2026-07-24'
  and c.skipped
  and c.covered_by is null
  and not exists (
    select 1 from public.transactions x where x.commitment_id = c.id
  );

commit;
