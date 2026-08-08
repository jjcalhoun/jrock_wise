-- ============================================================================
-- Which view of a credit card free-to-spend takes.
--
--   false (CASH)  — a card purchase doesn't reduce free-to-spend; the monthly
--                   card payment does. True to the bank balance.
--   true  (SPEND) — a card purchase reduces it the moment it posts, and the
--                   card payment then counts zero.
--
-- Exactly one side of that pair is ever counted. Counting both charges you
-- twice for one dinner; counting neither is the hole this was found through —
-- $316 of spending on a card with no payment line reduced nothing at all.
--
-- Defaults to TRUE. The cash view is only honest when every card has a payment
-- line to carry it, and nothing guarantees that; the spend view is correct
-- whether or not a card is planned for, which makes it the safer default for a
-- screen whose whole job is "don't overspend this month".
-- ============================================================================

alter table public.settings
  add column count_card_purchases boolean not null default true;
