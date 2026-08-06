-- ============================================================================
-- Debt payment terms: what you're required to pay vs what you actually pay,
-- and the part of a payment that isn't debt at all.
--
--   min_payment      the lender's minimum (already here) — the contractual floor
--   monthly_payment  what you ACTUALLY pay each month, total. Paying more than
--                    the minimum is the single biggest lever on a payoff date,
--                    so the projection has to know the real figure.
--   escrow_amount    the portion of the payment that is NOT debt paydown —
--                    property taxes and insurance on a mortgage. It leaves your
--                    checking account like the rest of the payment, but it never
--                    touches the principal.
--
-- Escrow is why this can't be a single number. A $583.57 mortgage payment made
-- of $352.66 principal-and-interest plus $230.91 escrow pays down far less than
-- $583.57 would suggest; feeding the gross figure to the projection produces a
-- payoff date that is simply wrong. Debt paydown is therefore
-- (monthly_payment ?? min_payment) − escrow_amount.
-- ============================================================================

alter table public.accounts
  add column monthly_payment numeric(12,2),
  add column escrow_amount   numeric(12,2) not null default 0;

comment on column public.accounts.monthly_payment is
  'What is actually paid each month, total, including any escrow. Null falls back to min_payment.';
comment on column public.accounts.escrow_amount is
  'Portion of the monthly payment that is not debt paydown (taxes/insurance). Excluded from payoff math.';
