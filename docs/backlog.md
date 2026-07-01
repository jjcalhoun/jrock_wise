# Backlog

Small/future ideas captured for later. Not scheduled.

## Interest paid — read-only stat
Interest charges are excluded from spend/leftover (they only affect the balance —
see PR #35). Add a **read-only "interest paid" figure** so the cost of debt is
still visible without touching the budget:
- Per liability account (e.g. in the account editor or Debt screen): total
  interest charged over a period (this month / YTD / all time), summed from
  transactions with `source = 'interest'` (manual) and interest charges on synced
  accounts.
- Consider a small "interest paid" line on the Debt tab per account and/or a total.
- Purely informational; must not feed into spend, leftover, or category budgets.
