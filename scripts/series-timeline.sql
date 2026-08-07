-- ============================================================================
-- One series, week by week: what's planned, what paid it, what covers it.
--
-- Read-only. The picture you need before deciding whether a lump payment still
-- has an unclaimed week behind it.
-- ============================================================================
select
  c.due_hint,
  c.period,
  c.seq,
  c.amount                                  as planned,
  c.skipped,
  t.id                                      as paid_by,
  t.date                                    as paid_on,
  t.amount                                  as paid_amount,
  c.covered_by                              as covered_by_txn,
  case
    when c.skipped               then 'skipped'
    when t.id is not null        then 'paid directly'
    when c.covered_by is not null then 'covered by a lump'
    else 'OPEN'
  end                                       as state
from public.commitments c
left join public.transactions t on t.commitment_id = c.id
where c.name ilike '%child support%'
order by c.due_hint nulls last, c.period, c.seq;
