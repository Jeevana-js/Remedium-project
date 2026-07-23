# CXT Ticket Fetcher

`tools/fetch-cxt-tickets.js` pulls cases/tickets from the internal CXT case-search
API (`/aurora/be/api/cxt/cases/search/`) for a given responsible party, with
pagination support.

## What you need to (re)run it

| Item | Where to get it | Notes |
|---|---|---|
| **Cookie header** | Browser DevTools → Network tab → a `/cxt/cases/search/` request → Request Headers → `cookie` value | Must be the **entire** cookie string (`AUT_SESSION_ID=...; X_APTEAN_TOKEN=<jwt>; sessionid=...; csrftoken=...`), not just the JWT. The embedded JWT expires ~30 min after it was minted — if you get a 401, recapture a fresh cookie. |
| **Responsible party ID** | Same request → Payload/Request tab → `filters.responsibleParty[0]` | Salesforce/CXT party ID, e.g. `0033i00002AZJZcAAP`. Comma-separate for multiple. |

Everything else has a sensible default (see Options below).

**Never paste the cookie into a chat/ticket/Slack message.** Set it as an
environment variable in your own terminal, or save it to a local file that is
gitignored (`.cxt-session*` is already excluded — see `.gitignore`).

## Setup

```powershell
$env:CXT_COOKIE = "<paste the full cookie header value>"
```

or, using a file:

```powershell
"<paste the full cookie header value>" | Out-File -NoNewline .cxt-session
node tools/fetch-cxt-tickets.js --responsible-party <id> --cookie-file .cxt-session
```

## Usage

```powershell
# Single page (default 50 results)
node tools/fetch-cxt-tickets.js --responsible-party 0033i00002AZJZcAAP

# All pages, written to a file
node tools/fetch-cxt-tickets.js --responsible-party 0033i00002AZJZcAAP --all --output cases.json

# CSV output
node tools/fetch-cxt-tickets.js --responsible-party 0033i00002AZJZcAAP --all --format csv --output cases.csv

# Multiple responsible parties, custom status filter
node tools/fetch-cxt-tickets.js --responsible-party <id1>,<id2> --exclude-status Closed,Cancelled --all
```

## Options

| Flag | Default | Description |
|---|---|---|
| `--responsible-party <ids>` | *(required)* | Comma-separated CXT/Salesforce party IDs. |
| `--exclude-status <list>` | `Closed` | Comma-separated statuses to exclude. |
| `--sort-by <field>` | `lastModifiedDate` | Sort field. |
| `--sort-order <asc\|desc>` | `desc` | Sort direction. |
| `--limit <n>` | `50` | Page size. |
| `--page <n>` | `1` | Single page to fetch (ignored with `--all`). |
| `--all` | off | Paginate through all pages. |
| `--max-pages <n>` | `20` | Safety cap when using `--all`. |
| `--base-url <url>` | `https://appcentral-int.aptean.com` | API base URL. |
| `--cookie-file <path>` | — | Read the cookie from a file instead of `CXT_COOKIE`. |
| `--format json\|csv` | `json` | Output format. |
| `--output <path>` | — | Write to a file instead of stdout. |
| `--help`, `-h` | — | Show usage. |

## How pagination works

`--all` fetches pages sequentially and stops as soon as a page returns fewer
cases than `--limit` (including an empty page). **Do not trust
`response.data.metadata.total`/`totalPages`** — verified experimentally that
those fields describe only the current page's batch size (e.g. `limit=2`
always reports `total: 2, totalPages: 1`), not the full result set, even
though consecutive pages return genuinely different cases.

## Response shape

```json
{
  "success": true,
  "data": {
    "cases": [
      {
        "id": "500a7000011HSAAAA4",
        "caseNumber": "06237463",
        "subject": "...",
        "status": "Assigned",
        "priority": "Medium",
        "severity": "Standard",
        "productLine": "Traverse Global",
        "responsibleParty": "...",
        "account": "...",
        "contact": "...",
        "contactEmail": "...",
        "contactPhone": "...",
        "url": "https://aptean.my.salesforce.com/lightning/r/Case/.../view",
        "devOps": [{ "id": "...", "name": "DEV-333135" }]
      }
    ],
    "metadata": { "total": 5, "page": 1, "pageSize": 5, "totalPages": 1 }
  }
}
```

If the API response shape changes, the script writes the raw response to a
file (never to stdout, since case data may include customer PII) and prints
a warning — update `extractCaseList()` in `fetch-cxt-tickets.js` accordingly.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `HTTP 401` / `invalid_token` / `Invalid JWT signature` | Cookie is expired, or you passed a bare JWT instead of the full cookie header | Recapture the full `cookie` header from DevTools |
| `This looks like a bare JWT...` | You set `CXT_COOKIE`/`--cookie-file` to just the token | Copy the entire `cookie:` header value, not the JWT alone |
| `could not find a case array in the response shape` | API response shape changed | Check the file it wrote the raw response to, update `extractCaseList()` |
