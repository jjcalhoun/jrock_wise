-- ============================================================================
-- Which view of a credit card free-to-spend takes.
--
--   false (CASH)  — a card purchase doesn't reduce free-to-spend; the monthly
--                   card payment does. True to the bank balance.
--   true  (SPEND) — the same, PLUS the purchases as you make them.
--
-- The card payment counts either way. When a card is paid in full monthly the
-- purchases and the payment clearing them are one event seen twice; when a
-- BALANCE IS CARRIED they are different money, the payment retiring old debt
-- while this month's purchases create new. Both are real claims on this
-- month's income.
--
-- Defaults to TRUE. The cash view is only honest when every card has a payment
-- line to carry it, and nothing guarantees that — $316 of spending on a card
-- with no payment line reduced nothing at all, which is how this was found.
-- ============================================================================

alter table public.settings
  add column count_card_purchases boolean not null default true;
