-- ============================================================================
-- Scheduled (future-dated) transactions
--   Recurring items on manual accounts are now pre-posted for the whole current
--   month so they're committed to the budget from the 1st. Those rows are dated
--   in the future (e.g. a payment on the 30th), so the balance must NOT count
--   them until their date actually arrives — otherwise checking/loan balances
--   would move early.
--
--   So the computed balance now sums only transactions dated on or before the
--   app's current day. The monthly budget rollup (client-side) still counts the
--   whole month, which is what makes a scheduled payment reduce Net/Available
--   immediately while leaving the balance accurate to today.
-- ============================================================================

create or replace view public.account_balances with (security_invoker = true) as
select
  a.id      as account_id,
  a.user_id as user_id,
  coalesce(
    a.live_balance,
    a.starting_balance
      + coalesce(
          sum(t.amount) filter (
            where t.date > a.as_of_date
              and t.date <= (now() at time zone 'America/Indiana/Indianapolis')::date
          ),
          0
        )
  ) as balance
from public.accounts a
left join public.transactions t on t.account_id = a.id
group by a.id;
