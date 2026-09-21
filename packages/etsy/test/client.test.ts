import assert from "node:assert/strict";
import test from "node:test";

import { EtsyClient, EtsyTransportError, type FetchLike } from "../src/client.ts";
import { buildEtsyAuthorizationUrl, exchangeEtsyAuthorizationCode, refreshEtsyToken } from "../src/oauth.ts";

test("GET and PATCH use exact endpoints, manual redirects, and title-only bodies", async () => {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetcher: FetchLike = async (input, init) => {
    calls.push({ input: String(input), init: init ?? {} });
    return Response.json({ listing_id: 1001, title: init?.method === "PATCH" ? "Desired" : "Baseline" });
  };
  const client = new EtsyClient({ apiKey: "key", accessToken: "token", fetcher });
  await client.getListing("1001");
  await client.patchTitle("2002", "1001", "Desired");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.input, "https://openapi.etsy.com/v3/application/listings/1001");
  assert.equal(calls[1]?.input, "https://openapi.etsy.com/v3/application/shops/2002/listings/1001");
  assert.equal(calls[0]?.init.redirect, "manual");
  assert.equal(calls[1]?.init.redirect, "manual");
  assert.equal(calls[1]?.init.body, "title=Desired");
  assert.equal(new Headers(calls[1]?.init.headers).get("authorization"), "Bearer token");
});

test("all redirects are terminal and sanitized", async () => {
  const client = new EtsyClient({
    apiKey: "secret-key",
    accessToken: "secret-token",
    fetcher: async () => new Response(null, { status: 302, headers: { location: "https://attacker.example/" } }),
  });
  await assert.rejects(
    () => client.getListing("1001"),
    (error: unknown) => {
      assert.ok(error instanceof EtsyTransportError);
      assert.equal(error.code, "redirect_disallowed");
      assert.doesNotMatch(error.message, /attacker|secret/);
      return true;
    },
  );
});

test("mutation transport is attempted once on ambiguous failure", async () => {
  let calls = 0;
  const client = new EtsyClient({
    apiKey: "key",
    accessToken: "token",
    fetcher: async () => { calls += 1; throw new Error("socket reset"); },
  });
  await assert.rejects(() => client.patchTitle("2002", "1001", "Desired"), /transport_ambiguous/);
  assert.equal(calls, 1);
});

test("OAuth authorization and token requests use PKCE, exact scopes, and manual redirects", async () => {
  const authorization = new URL(buildEtsyAuthorizationUrl({
    clientId: "client-id",
    redirectUri: "https://app.example/api/v1/oauth/etsy/callback",
    state: "bound-state",
    codeChallenge: "challenge",
    scopes: ["listings_r", "listings_w"],
  }));
  assert.equal(authorization.origin, "https://www.etsy.com");
  assert.equal(authorization.searchParams.get("scope"), "listings_r listings_w");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");

  const calls: Array<{ input: string; init: RequestInit }> = [];
  const fetcher: FetchLike = async (input, init) => {
    calls.push({ input: String(input), init: init ?? {} });
    return Response.json({ access_token: "1.access", refresh_token: "refresh", token_type: "Bearer", expires_in: 3600 });
  };
  await exchangeEtsyAuthorizationCode({
    clientId: "client-id", redirectUri: "https://app.example/callback", code: "code", codeVerifier: "verifier", fetcher,
  });
  await refreshEtsyToken("client-id", "refresh", fetcher);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.input, "https://api.etsy.com/v3/public/oauth/token");
  assert.equal(calls[0]?.init.redirect, "manual");
  assert.match(String(calls[0]?.init.body), /code_verifier=verifier/);
  assert.match(String(calls[1]?.init.body), /client_id=client-id/);
});

test("authorized-shop discovery is bound to the token subject", async () => {
  let requested = "";
  const client = new EtsyClient({
    apiKey: "key",
    accessToken: "12345.access-token",
    fetcher: async (input) => {
      requested = String(input);
      return Response.json({ results: [{ shop_id: 2002 }] });
    },
  });
  assert.deepEqual(await client.getAuthorizedShopIds(), ["2002"]);
  assert.equal(requested, "https://openapi.etsy.com/v3/application/users/12345/shops?limit=100");
});

test("read-only collection whitelists listing and receipt fields and never retains buyer data", async () => {
  const client = new EtsyClient({
    apiKey: "key",
    accessToken: "12345.access-token",
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/listings")) return Response.json({ count: 1, results: [{
        listing_id: 1001, title: "Botanical &amp; Notes", state: "active", views: 42,
        created_timestamp: 100, updated_timestamp: 200, tags: ["paper"], description: "do not retain",
      }] });
      return Response.json({ count: 1, results: [{
        receipt_id: 9001, created_timestamp: 300, was_paid: true, name: "Private Buyer", first_line: "Private address",
        transactions: [{ transaction_id: 7001, listing_id: 1001, quantity: 2, price: { amount: 1200, divisor: 100, currency_code: "USD" }, personalization: "private" }],
        refunds: [],
      }] });
    },
  });
  const listings = await client.getListingsByShop("2002", "active", 0, 100);
  const receipts = await client.getShopReceipts("2002", 0, 0, 100);
  assert.deepEqual(listings.results[0], { listingId: "1001", title: "Botanical & Notes", state: "active", views: 42, createdTimestamp: 100, updatedTimestamp: 200, tags: ["paper"] });
  assert.equal(JSON.stringify(receipts).includes("Private"), false);
  assert.deepEqual(receipts.results[0]?.transactions[0], { transactionId: "7001", listingId: "1001", quantity: 2, price: { amount: 1200, divisor: 100, currencyCode: "USD" } });
});

test("read-only collection uses bounded pagination parameters and manual redirects", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const client = new EtsyClient({ apiKey: "key", accessToken: "token", fetcher: async (input, init) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    return Response.json({ count: 0, results: [] });
  } });
  await client.getListingsByShop("2002", "inactive", 100, 50);
  await client.getShopReceipts("2002", 1_700_000_000, 200, 100);
  assert.equal(calls[0]?.url.searchParams.get("state"), "inactive");
  assert.equal(calls[0]?.url.searchParams.get("offset"), "100");
  assert.equal(calls[0]?.url.searchParams.get("limit"), "50");
  assert.equal(calls[1]?.url.searchParams.get("min_created"), "1700000000");
  assert.equal(calls[1]?.init.redirect, "manual");
});
