#!/usr/bin/env node
/**
 * resolve402-mcp — MCP server (stdio) for Resolve402.
 * Tools: find_decision_makers, people_search, counterparty_check, hiring_signals, verify_email, doc_to_markdown, markdown_to_pdf.
 * Paid per call with x402 v2 (USDC on Base or Solana).
 * Keys are read from env and never logged: EVM_PRIVATE_KEY (0x…, Base) and/or SVM_PRIVATE_KEY (base58, Solana).
 * Without a key, tools return the price and setup instructions instead of paying.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DEFAULT_BASE_URL, DEFAULT_MAX_USD, buildUrl, decodePaymentRequired, summarizeOffers, selectOffer, validateSiren, atomicToUsd } from "./lib.js";

const BASE_URL = process.env.RESOLVE402_BASE_URL || DEFAULT_BASE_URL;
const MAX_USD = Number(process.env.RESOLVE402_MAX_USD_PER_CALL || DEFAULT_MAX_USD);
const hasEvm = Boolean(process.env.EVM_PRIVATE_KEY);
const hasSvm = Boolean(process.env.SVM_PRIVATE_KEY);

let paidFetchPromise = null;
async function getPaidFetch() {
  if (paidFetchPromise) return paidFetchPromise;
  paidFetchPromise = (async () => {
    const { wrapFetchWithPaymentFromConfig } = await import("@x402/fetch");
    const schemes = [];
    if (hasEvm) {
      const { privateKeyToAccount } = await import("viem/accounts");
      const { ExactEvmScheme } = await import("@x402/evm");
      schemes.push({ network: "eip155:*", client: new ExactEvmScheme(privateKeyToAccount(process.env.EVM_PRIVATE_KEY)) });
    }
    if (hasSvm) {
      const { createKeyPairSignerFromBytes } = await import("@solana/kit");
      const { base58 } = await import("@scure/base");
      const { ExactSvmScheme, toClientSvmSigner } = await import("@x402/svm");
      const kp = await createKeyPairSignerFromBytes(base58.decode(process.env.SVM_PRIVATE_KEY));
      schemes.push({ network: "solana:*", client: new ExactSvmScheme(toClientSvmSigner(kp)) });
    }
    return wrapFetchWithPaymentFromConfig(fetch, {
      schemes,
      paymentRequirementsSelector: (_v, accepts) => {
        const ok = selectOffer(accepts, { hasEvm, hasSvm, maxUsd: MAX_USD });
        if (!ok.length) throw new Error(`No payable offer within the ${MAX_USD} USD per-call cap.`);
        return ok[0];
      },
    });
  })();
  return paidFetchPromise;
}

const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], isError });

/**
 * Probe (free 402), then pay and call. `init` carries method/body/headers for POST routes;
 * `onSuccess` turns a successful Response into tool content (default: body text).
 */
async function call(path, params, init = {}, onSuccess) {
  const url = buildUrl(BASE_URL, path, params);
  const mk = () => ({ ...init, headers: { accept: "application/json, application/pdf", ...(init.headers ?? {}) }, body: typeof init.body === "function" ? init.body() : init.body });
  const probe = await fetch(url, mk());
  if (probe.status !== 402) {
    if (probe.ok && onSuccess) return onSuccess(probe);
    const body = await probe.text();
    if (probe.status === 404) return text(`Not found (not charged): ${body}`);
    return text(body, !probe.ok);
  }
  const pr = decodePaymentRequired(probe.headers.get("payment-required"));
  const price = summarizeOffers(pr);
  if (!hasEvm && !hasSvm) {
    return text(`Payment required: ${price}. Configure a wallet for this MCP server: set EVM_PRIVATE_KEY (Base, holds USDC) or SVM_PRIVATE_KEY (Solana, base58) in its env. Per-call cap: RESOLVE402_MAX_USD_PER_CALL (default ${DEFAULT_MAX_USD}).`, true);
  }
  const offers = selectOffer(pr?.accepts ?? [], { hasEvm, hasSvm, maxUsd: MAX_USD });
  if (!offers.length) return text(`Price ${price} exceeds the per-call cap (${MAX_USD} USD) or no configured network matches. Nothing paid.`, true);
  const paidFetch = await getPaidFetch();
  const res = await paidFetch(url, mk());
  if (res.status === 402) {
    const again = decodePaymentRequired(res.headers.get("payment-required"));
    return text(`Payment refused: ${again?.error ?? "unknown reason"} (check the wallet holds USDC on the chosen network). Nothing charged.`, true);
  }
  if (res.ok && onSuccess) return onSuccess(res);
  const body = await res.text();
  return text(res.ok ? body : `HTTP ${res.status}: ${body}`, !res.ok);
}

const server = new McpServer({ name: "resolve402", version: "0.3.0" });

server.tool(
  "find_decision_makers",
  "Company directors in France (dirigeants: CEO, président, gérant, DG, administrateurs) with their probable business email, from a SIREN or a company name. Official RNE registry data, company web domain, mail provider, probable email per officer (pattern-based, not SMTP-verified) and alternatives. 0.02 USDC per call, charged only if found. Nothing stored (GDPR).",
  {
    siren: z.string().optional().describe("9-digit French SIREN (preferred)"),
    company: z.string().optional().describe("Company name, if no SIREN"),
    domain: z.string().optional().describe("Optional company web domain hint"),
  },
  async ({ siren, company, domain }) => {
    if (!siren && !company) return text("Provide siren or company.", true);
    if (siren && !validateSiren(siren)) return text("siren must be 9 digits.", true);
    return call("/api/decision-makers", { siren: siren?.replace(/\s+/g, ""), company, domain });
  },
);

server.tool(
  "people_search",
  "List decision makers (CEO, président, DG, gérant) of French companies matching a sector (NAF section A-U or code like 62.01Z), a place (department, region or postal code) and a minimum headcount, from the official registry (Sirene + RNE). Up to 25 people per call, one per company, with SIREN, NAF, city and size; each result gives the find_decision_makers call for their email. 0.05 USDC per call, charged only if someone matches.",
  {
    role: z.enum(["ceo", "president", "dg", "gerant", "any_executive"]).optional().describe("Default ceo"),
    sector: z.string().optional().describe("NAF section letter (A-U) or NAF code (62.01Z)"),
    department: z.string().optional().describe("French department code, e.g. 75, 69, 2A"),
    region: z.string().optional().describe("INSEE region code, e.g. 11"),
    postal_code: z.string().optional().describe("5-digit postal code"),
    min_employees: z.number().int().min(0).optional().describe("Minimum headcount"),
    keywords: z.string().optional().describe("Free text on company name or activity"),
    limit: z.number().int().min(1).max(25).optional().describe("1-25, default 10"),
    page: z.number().int().min(1).optional().describe("Page of companies, default 1"),
  },
  async (args) => {
    if (!args.sector && !args.department && !args.region && !args.postal_code && !args.keywords && args.min_employees === undefined)
      return text("Provide at least one filter: sector, department, region, postal_code, min_employees or keywords.", true);
    return call("/api/people-search", args);
  },
);

server.tool(
  "counterparty_check",
  "Check a company before invoicing or paying it, in one call: active or closed (French registry), EU VAT number valid (VIES), insolvency proceedings (BODACC: liquidation, redressement, sauvegarde), asset-freeze and sanctions match (DG Trésor register, incl. EU and UN), and optional IBAN checksum, country and SEPA. Returns a verdict ok / review / block with reasons; on review or block, ask a human. From a SIREN, SIRET, EU VAT number or French company name. 0.02 USDC per call, charged only if found.",
  {
    siren: z.string().optional().describe("9-digit French SIREN"),
    siret: z.string().optional().describe("14-digit French SIRET"),
    vat: z.string().optional().describe("EU VAT number, e.g. FR27552032534 or DE123456789"),
    company: z.string().optional().describe("French company name"),
    iban: z.string().optional().describe("Optional IBAN to check"),
  },
  async ({ siren, siret, vat, company, iban }) => {
    if (!siren && !siret && !vat && !company) return text("Provide siren, siret, vat or company.", true);
    if (siren && !validateSiren(siren)) return text("siren must be 9 digits.", true);
    return call("/api/counterparty-check", { siren: siren?.replace(/\s+/g, ""), siret: siret?.replace(/\s+/g, ""), vat, company, iban: iban?.replace(/\s+/g, "") });
  },
);

server.tool(
  "hiring_signals",
  "Is a company hiring, how much and for which functions? Open jobs read from its public ATS job board (Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Personio), summarized as buying signals: open_jobs, posted_last_30d, hiring_intent (low/medium/high), jobs by function (sales, engineering, data...), leadership roles. From a web domain (any country), a French SIREN or a French company name. Chain with find_decision_makers to know who to contact. 0.01 USDC per call, charged only if open jobs are found.",
  {
    domain: z.string().optional().describe("Company web domain, e.g. acme.com (any country)"),
    siren: z.string().optional().describe("9-digit French SIREN"),
    company: z.string().optional().describe("French company name"),
    limit: z.number().int().min(1).max(200).optional().describe("Max jobs returned (default 50)"),
  },
  async ({ domain, siren, company, limit }) => {
    if (!domain && !siren && !company) return text("Provide domain, siren or company.", true);
    if (siren && !validateSiren(siren)) return text("siren must be 9 digits.", true);
    return call("/api/hiring-signals", { domain, siren: siren?.replace(/\s+/g, ""), company, limit });
  },
);

server.tool(
  "verify_email",
  "Pre-check a business email: syntax, MX, mail provider (Google, Microsoft 365, Proofpoint...), disposable, free webmail, role account. No mailbox test. 0.003 USDC per call.",
  { email: z.string().describe("Email address to check") },
  async ({ email }) => call("/api/verify-email", { email }),
);

server.tool(
  "doc_to_markdown",
  "Convert a document (PDF, DOCX, HTML, TXT) into clean Markdown for an LLM, with tables extracted as rows, page and char counts. Give a public URL or a local file path (max 10 MB). 0.005 USDC per call. Nothing stored.",
  {
    url: z.string().url().optional().describe("Public http(s) URL of the document"),
    file_path: z.string().optional().describe("Local file path (PDF, DOCX, HTML, TXT), sent as the request body instead of url"),
  },
  async ({ url, file_path }) => {
    if (!url && !file_path) return text("Provide url or file_path.", true);
    if (url) return call("/api/doc-to-markdown", { url });
    const { readFile } = await import("node:fs/promises");
    const { basename } = await import("node:path");
    let bytes;
    try { bytes = await readFile(file_path); } catch (e) { return text(`Cannot read ${file_path}: ${e.message}`, true); }
    if (bytes.length > 10 * 1024 * 1024) return text("File exceeds 10 MB.", true);
    return call("/api/doc-to-markdown", {}, { method: "POST", headers: { "content-type": "application/octet-stream", "x-filename": basename(file_path) }, body: () => new Uint8Array(bytes) });
  },
);

server.tool(
  "markdown_to_pdf",
  "Render Markdown into a clean PDF (headings, lists, code, blockquotes, simple tables, page numbers). Max 200k characters. Returns the PDF as an embedded resource, or writes it to output_path when given. 0.01 USDC per call. Nothing stored.",
  {
    markdown: z.string().min(1).max(200_000).describe("Markdown source (CommonMark + GFM tables)"),
    title: z.string().max(200).optional().describe("Document title printed on top"),
    paper: z.enum(["A4", "Letter"]).optional().describe("Page size, default A4"),
    output_path: z.string().optional().describe("Local path to write the .pdf to (recommended for large documents)"),
  },
  async ({ markdown, title, paper, output_path }) =>
    call("/api/markdown-to-pdf", {}, { method: "POST", headers: { "content-type": "application/json" }, body: () => JSON.stringify({ markdown, title, paper }) }, async (res) => {
      const buf = Buffer.from(await res.arrayBuffer());
      if (output_path) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(output_path, buf);
        return text(`PDF written to ${output_path} (${buf.length} bytes).`);
      }
      return { content: [{ type: "resource", resource: { uri: `resolve402://markdown-to-pdf/${encodeURIComponent(title || "document")}.pdf`, mimeType: "application/pdf", blob: buf.toString("base64") } }] };
    }),
);

await server.connect(new StdioServerTransport());
console.error(`[resolve402-mcp] ready · ${BASE_URL} · wallets: ${[hasEvm && "base", hasSvm && "solana"].filter(Boolean).join("+") || "none"} · cap ${MAX_USD} USD/call`);
