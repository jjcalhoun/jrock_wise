/* SimpleFIN Bridge client. Server-only — the access URL is a bearer credential
   and must never reach the browser.

   Flow:
   1. claimSetupToken(token): the setup token is base64 of a "claim URL". POST to
      it once → the body is the permanent access URL (with embedded credentials).
   2. fetchAccounts(accessUrl, opts): GET <accessUrl>/accounts → balances +
      transactions for every connected account. */

export interface SimplefinTransaction {
  id: string;
  posted: number; // unix seconds
  amount: string; // signed decimal string
  description: string;
  payee?: string;
  memo?: string;
  pending?: boolean;
}

export interface SimplefinAccount {
  id: string;
  org: { name?: string; domain?: string };
  name: string;
  currency: string;
  balance: string; // signed decimal string
  "available-balance"?: string;
  "balance-date": number; // unix seconds
  transactions: SimplefinTransaction[];
}

export interface SimplefinAccountSet {
  errors: string[];
  accounts: SimplefinAccount[];
}

/** Exchange a one-time setup token for a permanent access URL. */
export async function claimSetupToken(setupToken: string): Promise<string> {
  const claimUrl = Buffer.from(setupToken.trim(), "base64").toString("utf8");
  if (!/^https:\/\//.test(claimUrl)) {
    throw new Error("Invalid setup token");
  }
  const res = await fetch(claimUrl, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Claim failed (${res.status})`);
  }
  const accessUrl = (await res.text()).trim();
  if (!/^https:\/\/.+@/.test(accessUrl)) {
    throw new Error("Claim did not return a valid access URL");
  }
  return accessUrl;
}

interface FetchOpts {
  startDate?: number; // unix seconds
  endDate?: number;
  pending?: boolean;
  balancesOnly?: boolean;
}

/** Pull accounts (balances + transactions) from a claimed access URL. */
export async function fetchAccounts(
  accessUrl: string,
  opts: FetchOpts = {},
): Promise<SimplefinAccountSet> {
  const url = new URL(`${accessUrl.replace(/\/$/, "")}/accounts`);
  if (opts.startDate) url.searchParams.set("start-date", String(opts.startDate));
  if (opts.endDate) url.searchParams.set("end-date", String(opts.endDate));
  if (opts.pending) url.searchParams.set("pending", "1");
  if (opts.balancesOnly) url.searchParams.set("balances-only", "1");

  // fetch() refuses URLs with embedded credentials, so move SimpleFIN's
  // user:pass@ into an HTTP Basic auth header and strip them from the URL.
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = "";
  url.password = "";
  const headers: Record<string, string> = {};
  if (username || password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  const res = await fetch(url, { cache: "no-store", headers });
  if (!res.ok) {
    throw new Error(`SimpleFIN fetch failed (${res.status})`);
  }
  const json = (await res.json()) as SimplefinAccountSet;
  return { errors: json.errors ?? [], accounts: json.accounts ?? [] };
}
