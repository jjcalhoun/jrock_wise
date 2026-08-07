-- ============================================================================
-- Say WHY a week counts zero: covered by a lump, not skipped.
--
-- A week that a lump payment paid for and a week you decided not to pay both
-- count zero (lib/commitments/ledger.ts: `c.skipped || covered ? 0`). The
-- arithmetic is identical either way, which is why this changes no number
-- anywhere. What it changes is what the row says when you look back at it:
-- "covered by Zelle" instead of a dimmed, unticked line with no explanation.
--
-- Child support 7/24 was settled by the $412 Zelle of 7/17 (ee303af8) — that
-- payment covered two weeks — but predates multi-select, so the second week got
-- ticked off as skipped instead. This records what actually happened.
--
-- Both flags move together and both matter:
--   covered_by  -> the row can name the payment that settled it
--   skipped     -> false, or the row still renders dimmed and unticked
--
-- NO TRANSACTIONS ARE TOUCHED. Reversible:
--   update public.commitments
--   set covered_by = null, skipped = true
--   where id = '<the id STEP 1 printed>';
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Confirm it's the row we mean, and that the payer is real.
-- ----------------------------------------------------------------------------
select
  c.id            as commitment_id,
  c.due_hint,
  c.amount        as planned,
  c.skipped       as currently_skipped,
  c.covered_by    as currently_covered_by,
  t.id            as payer_txn,
  t.date          as payer_date,
  t.amount        as payer_amount,
  -- the payer must actually be a lump, or covering with it is a lie
  abs(t.amount) >= abs(c.amount) * 1.8 as payer_is_a_lump
from public.commitments c
cross join public.transactions t
where c.name ilike '%child support%'
  and c.due_hint = date '2026-07-24'
  and t.id = 'ee303af8-66c8-4fa9-b652-4c0988a4a46f'::uuid;
