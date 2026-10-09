import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUrl, atomicToUsd, decodePaymentRequired, summarizeOffers, selectOffer, validateSiren } from "./lib.js";

const pr = { accepts: [
  { network: "eip155:8453", amount: "20000", payTo: "0xabc" },
  { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amount: "20000", payTo: "55q" },
] };

test("buildUrl drops empty params", () => {
  assert.equal(buildUrl("https://resolve402.dev/", "/api/decision-makers", { siren: "552032534", company: "" }),
    "https://resolve402.dev/api/decision-makers?siren=552032534");
});
test("atomicToUsd", () => assert.equal(atomicToUsd("3000"), 0.003));
test("decode header", () => {
  const h = Buffer.from(JSON.stringify(pr)).toString("base64");
  assert.equal(decodePaymentRequired(h).accepts.length, 2);
  assert.equal(decodePaymentRequired("%%"), null);
});
test("summary", () => assert.equal(summarizeOffers(pr), "0.02 USDC on Base or 0.02 USDC on Solana"));
test("select respects networks and cap", () => {
  assert.equal(selectOffer(pr.accepts, { hasEvm: true, hasSvm: false, maxUsd: 0.05 }).length, 1);
  assert.equal(selectOffer(pr.accepts, { hasEvm: true, hasSvm: true, maxUsd: 0.01 }).length, 0);
});
test("siren", () => { assert.ok(validateSiren("552 032 534")); assert.ok(!validateSiren("12")); });
