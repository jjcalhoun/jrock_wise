# SimpleFIN integration plan

Replace manual CSV imports with automatic balance + transaction retrieval via
**SimpleFIN Bridge**, while keeping CSV as a fallback. Single-user, cost-sensitive.

## Why SimpleFIN

- **Flat $1.50/month**, unlimited institutions and refreshes. No per-account or
  per-call fees.
- No hosted Link SDK / OAuth dance. One permanent credential, one endpoint.
- No webhooks — we poll on demand and on a daily schedule.

## How it works

1. User connects banks at SimpleFIN Bridge and generates a one-time **setup
   token** (base64 string).
2. App **claims** the token once: POST to the decoded URL → SimpleFIN returns a
   permanent **access URL** (`https://<user>:<pass>@bridge.simplefin.org/simplefin`).
   The access URL *is* the credential.
3. Pull balances + transactions together: `GET <accessUrl>/accounts`
   (`?start-date=<unix>&end-date=<unix>&pending=1`).

## Data model (new migration `0002_simplefin.sql`)

Keep `schema.sql`'s four transaction types and the splits model unchanged. Add:

```
simplefin_connections
  id              uuid pk
  user_id         uuid  (RLS: auth.uid())
  access_url_enc  text   -- ENCRYPTED at rest (AES-256-GCM)
  created_at      timestamptz
  last_synced_at  timestamptz

simplefin_account_map
  id                   uuid pk
  user_id              uuid
  simplefin_account_id text
  account_id           uuid fk -> accounts.id
  org_name             text
  unique (user_id, simplefin_account_id)
```

Reuse existing `transactions.external_id`, storing `simplefin:<id>` so it never
collides with CSV's `date|amount|desc` keys. SimpleFIN transaction IDs are stable
and unique → rock-solid dedupe.

## Decisions (locked)

1. **Balance model — A: trust SimpleFIN's live balance** for linked accounts.
   Store `live_balance` + `live_balance_at` on the account; balance view/UI
   prefer it when present. Manual/CSV accounts keep the computed
   (strictly-after-as-of-date) balance. Show "synced Xh ago".
2. **Initial history depth — 90 days** on the first sync.
3. **Auto-categorization — best-guess by default, toggleable.** Imported
   transactions get a best-guess category from the merchant/payee string, but a
   setting (`autocategorize_imports`, default on) disables it so they arrive
   uncategorized. Either way they land **unreviewed** and flow into the existing
   Review queue.

## Server flow (Next 16 route handlers, Node runtime, server-only)

The access URL never reaches the client.

- `POST /api/simplefin/claim` — `{ setupToken }`: decode, claim, encrypt access
  URL, insert connection, return accounts (id, org, name, balance) for mapping.
- `POST /api/simplefin/map` — `{ mappings: [{ simplefin_account_id, account_id }] }`:
  link SimpleFIN accounts to ours (or create new accounts).
- `POST /api/simplefin/sync` — pull `/accounts?start-date=…`, upsert balances onto
  mapped accounts, insert new transactions (dedupe on `external_id`), apply
  best-guess category if enabled. Returns counts.

Sync trigger: manual "Sync now" first; later a Vercel Cron (daily). No webhooks.

## UI / app changes

- **Settings → Connections**: paste setup token, see institutions, map accounts,
  "Sync now", last-synced time, disconnect, auto-categorize toggle.
- **Account mapping screen**: one-time per account.
- **Review flow**: unchanged — SimpleFIN txns arrive unreviewed like CSV imports.
- **CSV import stays** as a fallback.

## Security

- The access URL is a **bearer credential** — encrypt at rest with AES-256-GCM
  using `SIMPLEFIN_ENC_KEY` (32-byte key, Vercel env var). Decrypt only in server
  routes.
- Setup token and access URL never go to the browser or `NEXT_PUBLIC_*`.
- `.env` stays public-keys-only; encryption key lives in Vercel env vars /
  gitignored `.env.local`, never committed.

## Phasing

0. **No code:** user creates SimpleFIN Bridge account ($1.50/mo), connects one
   bank, generates a setup token to test against.
1. Migration `0002` + claim/map/sync routes + encryption util. Test the
   claim→sync round-trip with a real token.
2. Settings Connections UI + account mapping screen.
3. Live-balance model (decision 1) wired into the balance view/UI.
4. Vercel Cron daily auto-sync.
