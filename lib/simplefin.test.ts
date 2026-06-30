import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAccounts } from "./simplefin";

afterEach(() => vi.restoreAllMocks());

describe("fetchAccounts", () => {
  it("moves URL credentials into a Basic auth header (no credentials in URL)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [], accounts: [] }), { status: 200 }),
    );

    await fetchAccounts("https://user:p@ss@bridge.simplefin.org/simplefin", {
      balancesOnly: true,
    });

    const [url, init] = spy.mock.calls[0];
    const requested = url instanceof URL ? url : new URL(String(url));
    expect(requested.username).toBe("");
    expect(requested.password).toBe("");
    expect(requested.searchParams.get("balances-only")).toBe("1");
    const auth = (init?.headers as Record<string, string>).Authorization;
    expect(Buffer.from(auth.split(" ")[1], "base64").toString()).toBe("user:p@ss");
  });
});
