# resolve402-mcp

MCP server for [Resolve402](https://resolve402.dev): **company directors in France with their probable business email**, people search by sector and place, and counterparty checks before invoicing or paying, in one call. Official RNE registry, paid per call with x402 (USDC on Base or Solana). Nothing stored.

## Install

Claude Code:
```
claude mcp add resolve402 -e EVM_PRIVATE_KEY=0x... -- npx -y resolve402-mcp
```

Claude Desktop / Cursor (`mcpServers`):
```json
{ "resolve402": { "command": "npx", "args": ["-y", "resolve402-mcp"], "env": { "EVM_PRIVATE_KEY": "0x..." } } }
```

Use a dedicated wallet holding a few USDC on Base (or `SVM_PRIVATE_KEY`, base58, for Solana).

## Tools

| Tool | Price | Returns |
|---|---|---|
| `find_decision_makers` (`siren` or `company`) | 0.02 USDC, only if found | officers (name, role, birth year), domain, mail provider, probable email + alternatives (`verified:false`) |
| `people_search` (`role?`, `sector`, `department` / `region` / `postal_code`, `min_employees?`, `keywords?`, `limit?`, `page?`) | 0.05 USDC, only if someone matches | up to 25 decision makers of French companies by sector, place and size (official registry), each with the `find_decision_makers` call for emails |
| `counterparty_check` (`siren`, `siret`, `vat` or `company`; `iban?`) | 0.02 USDC, only if found | before invoicing or paying: active, VAT valid (VIES), insolvency (BODACC), sanctions / asset freeze (DG Trésor), IBAN; verdict ok / review / block |
| `hiring_signals` (`domain`, or `siren` / `company`) | 0.01 USDC, only if open jobs found | open jobs from the public ATS board + signals: volume, last 30 days, intent, functions, leadership roles |
| `verify_email` (`email`) | 0.003 USDC | syntax, MX, provider, disposable, webmail, role account |
| `doc_to_markdown` (`url` or `file_path`) | 0.005 USDC | PDF, DOCX, HTML or TXT (max 10 MB) to clean Markdown, tables as rows, page and char counts |
| `markdown_to_pdf` (`markdown`, `title?`, `paper?`, `output_path?`) | 0.01 USDC | Markdown (max 200k chars) rendered to a PDF: headings, lists, code, blockquotes, tables, page numbers |

## Safety

- Per-call cap: `RESOLVE402_MAX_USD_PER_CALL` (default 0.05). Nothing is paid above it.
- Without a key, tools return the price and setup steps; nothing is paid.
- Keys are read from env only and never logged.

GDPR opt-out: `POST https://resolve402.dev/api/opt-out`.
