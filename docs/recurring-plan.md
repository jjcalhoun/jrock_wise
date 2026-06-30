# Recurring transactions plan

Auto-generate predictable transactions for manual (non-synced) accounts, so a
paycheck-allocation setup runs itself: a transfer in on paydays, fixed
withdrawals on set days.

## Driving example (locked from discussion)
- **Payday transfer** — a fixed amount moved **into** a checking account, **twice
  a month** (two fixed days, e.g. 15th and last day). This is a *transfer* from a
  tracked account.
- **3 fixed payments** — fixed **expenses** that leave that checking account on
  specific days each month (outside payees, each with a category).
- **Auto-review on** — generated transactions are marked reviewed and
  pre-categorized; they skip the Review queue (still editable).

## Accounts
No new account concept. These are ordinary **manual** accounts (no SimpleFIN
mapping), so they keep the computed-balance rule (starting_balance + transactions
after as_of). The grayed-balance change (#29) only affects linked accounts, so
manual balances stay editable — correct here.

## Data model — new migration `recurring_rules`
Replaces the unused, too-thin `recurring_bills` table.

```
recurring_rules
  id, user_id
  name                text
  account_id          uuid          -- the account this hits
  type                text          -- expense | income | transfer
  amount              numeric        -- magnitude; signing handled by type
  transfer_account_id uuid null      -- transfer counterpart
  category_id         uuid null      -- expense/income → drives the split
  bucket              text null
  frequency           text           -- monthly | semimonthly | weekly | biweekly
  day_of_month        int null        -- monthly / semimonthly day 1
  day_of_month_2      int null        -- semimonthly day 2
  weekday             int null        -- weekly / biweekly anchor (0-6)
  interval            int default 1   -- weekly/biweekly step
  start_date          date
  end_date            date null
  auto_review         bool default true
  last_generated      date null       -- watermark of materialized occurrences
  active              bool default true
  created_at, updated_at
```

Owner-only RLS, same pattern as the rest of the schema.

## Generation engine — `lib/recurring.ts`
`generateRecurring(supabase, userId)`:
1. For each active rule, compute occurrence dates from `max(last_generated+1,
   start_date)` **through today only** (never future-dated — future occurrences
   would inflate computed balances).
2. Insert one transaction per occurrence:
   - **expense**: amount negative, single split (category/bucket).
   - **income**: amount positive, no split.
   - **transfer**: paired two-sided rows (source/destination), reusing existing
     transfer logic + a shared transfer_group_id.
   - `external_id = recurring:<rule_id>:<YYYY-MM-DD>` → dedupe via the existing
     partial unique index, so re-runs never double-insert.
   - `reviewed = auto_review`.
3. Advance `last_generated` to today.

Date math:
- **monthly** — `day_of_month`, clamped to month length.
- **semimonthly** — `day_of_month` and `day_of_month_2` each month.
- **weekly / biweekly** — step `7 * interval` days from the anchor.

## When it runs
- **Daily cron** — extend `/api/cron/sync` to call `generateRecurring` for each
  user after the SimpleFIN sync. One job does both.
- **On app open** — generate on load too, so you never wait for the cron.

## UI — "Recurring" manager in Settings
New settings row → sheet:
- List rules (name, account, amount, cadence, next date).
- Add/edit/delete with: name, account, type, amount, transfer counterpart (if
  transfer), category (if expense/income), frequency + day(s), start/end,
  auto-review toggle.
- Optional "Upcoming" preview of the next few projected dates (display only, not
  counted in balances).

## Phasing
1. Migration `recurring_rules` + `lib/recurring.ts` (monthly + semimonthly +
   weekly/biweekly; expense/income/transfer) + unit tests for date math.
2. Wire generation into the cron and on app open.
3. Settings "Recurring" manager UI.
