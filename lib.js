/** Pure helpers (no network, no keys) — unit-tested. */
export const DEFAULT_BASE_URL = "https://resolve402.dev";
export const DEFAULT_MAX_USD = 0.05;

export function buildUrl(base, path, params) {
  const u = new URL(path, base.replace(/\/+$/, "") + "/");
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  return u.toString();
}

/** USDC has 6 decimals; x402 v2 amounts are atomic strings. */
export function atomicToUsd(amount) {
  return Number(amount) / 1e6;
}

/** Decode the base64 PAYMENT-REQUIRED header of a 402 response. */
export function decodePaymentRequired(header) {
  if (!header) return null;
  try { return JSON.parse(Buffer.from(header, "base64").toString("utf8")); } catch { return null; }
}

/** Human summary of the price offers in a 402. */
export function summarizeOffers(pr) {
  if (!pr?.accepts?.length) return "Payment required (no offer parsed).";
  return pr.accepts.map((a) => `${atomicToUsd(a.amount)} USDC on ${a.network.startsWith("eip155:8453") ? "Base" : a.network.startsWith("solana:") ? "Solana" : a.network}`).join(" or ");
}

/** Keep only offers we can pay (configured networks) and that are within the per-call cap. */
export function selectOffer(accepts, { hasEvm, hasSvm, maxUsd }) {
  const ok = accepts.filter((a) =>
    ((hasEvm && a.network.startsWith("eip155:")) || (hasSvm && a.network.startsWith("solana:"))) &&
    atomicToUsd(a.amount) <= maxUsd);
  return ok;
}

export function validateSiren(s) {
  return typeof s === "string" && /^[0-9]{9}$/.test(s.replace(/\s+/g, ""));
}
