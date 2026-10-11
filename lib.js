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

/**
 * Message for a paid request whose outcome is not a success. A 402 or a network error AFTER a signed
 * payment was sent does not prove nothing was charged: the seller may answer 402 when the facilitator's
 * /settle reply is late or non-200 although the transfer went through (resolve402-mcp#1). Never tell
 * the model "nothing charged" here, and tell it not to retry before checking the wallet.
 */
export function paymentUnconfirmedMessage({ reason, offer }) {
  const where = offer?.payTo ? ` to ${offer.payTo} on ${offer.network}` : "";
  const amount = offer?.amount ? ` of ${atomicToUsd(offer.amount)} USDC` : "";
  return `Payment not confirmed: ${reason || "unknown reason"}. A signed payment${amount} was sent${where}; ` +
    "it may or may not have been settled. Do NOT retry this call automatically: first check the wallet's recent " +
    "USDC transfers (a settled payment appears as a transfer to the address above). If none appears, the wallet " +
    "probably lacks USDC on that network or the payment was rejected, and a retry is safe.";
}
