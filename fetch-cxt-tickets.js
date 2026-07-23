/**
 * CXT Ticket Fetcher
 *
 * Calls the internal CXT case-search API (Aurora backend) to pull tickets
 * assigned to a responsible party, with pagination support.
 *
 * This is a manual-session tool: CXT auth is a browser session (Django
 * sessionid/csrftoken cookies behind a Keycloak JWT), not a long-lived API
 * key. You must supply a *fresh* Cookie header each time the session
 * expires (JWT ~30 min, sessionid ~2 weeks).
 *
 * NEVER hardcode a cookie value in this file or commit one anywhere in the
 * repo. Supply it via the CXT_COOKIE env var or a local --cookie-file (both
 * paths documented below are gitignored).
 *
 * How to get a fresh cookie:
 *   1. Open the CXT app in the browser, DevTools > Network tab.
 *   2. Trigger any case search, click the `/cxt/cases/search/` request.
 *   3. Under Request Headers, copy the full value of the `cookie` header.
 *   4. Either: export CXT_COOKIE="<paste>"
 *      Or: save it to a local file (e.g. .cxt-session, gitignored) and pass --cookie-file .cxt-session
 *
 * Usage:
 *   node tools/fetch-cxt-tickets.js --responsible-party 0033i00002AZJZcAAP
 *   node tools/fetch-cxt-tickets.js --responsible-party <id1>,<id2> --all --output cases.json
 *   node tools/fetch-cxt-tickets.js --responsible-party <id> --exclude-status Closed,Cancelled --limit 100
 *   node tools/fetch-cxt-tickets.js --responsible-party <id> --cookie-file .cxt-session --format csv
 *
 * Options:
 *   --responsible-party <ids>   Required. Comma-separated CXT/Salesforce party IDs to filter on.
 *   --exclude-status <list>     Comma-separated statuses to exclude. Default: Closed
 *   --sort-by <field>           Default: lastModifiedDate
 *   --sort-order <asc|desc>     Default: desc
 *   --limit <n>                 Page size. Default: 50
 *   --page <n>                  Single page to fetch. Default: 1 (ignored if --all is set)
 *   --all                       Paginate through all pages until a short/empty page is returned.
 *   --max-pages <n>              Safety cap when using --all. Default: 20
 *   --base-url <url>            Default: https://appcentral-int.aptean.com
 *   --cookie-file <path>        Read the Cookie header value from a local file instead of CXT_COOKIE.
 *   --format json|csv           Output format. Default: json
 *   --output <path>              Write to a file instead of stdout.
 *   --help, -h                  Show this help message.
 */

const https = require('https');
const fs = require('fs');

function printHelp() {
  console.log(`
Usage: node tools/fetch-cxt-tickets.js --responsible-party <id>[,<id>...] [options]

Options:
  --responsible-party <ids>   Required. Comma-separated CXT/Salesforce party IDs.
  --exclude-status <list>     Comma-separated statuses to exclude. Default: Closed
  --sort-by <field>           Default: lastModifiedDate
  --sort-order <asc|desc>     Default: desc
  --limit <n>                 Page size. Default: 50
  --page <n>                  Single page to fetch. Default: 1 (ignored with --all)
  --all                       Paginate through all pages.
  --max-pages <n>             Safety cap when using --all. Default: 20
  --base-url <url>            Default: https://appcentral-int.aptean.com
  --cookie-file <path>        Read Cookie header value from a local file instead of CXT_COOKIE env var.
  --format json|csv           Output format. Default: json
  --output <path>             Write result to a file instead of stdout.
  --help, -h                  Show this help message.

Auth:
  Set CXT_COOKIE to the raw "cookie" request header value copied from your
  browser's Network tab for a /cxt/cases/search/ request, or pass
  --cookie-file pointing at a local (gitignored) file containing it.
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    responsibleParty: null,
    excludeStatus: ['Closed'],
    sortBy: 'lastModifiedDate',
    sortOrder: 'desc',
    limit: 50,
    page: 1,
    all: false,
    maxPages: 20,
    baseUrl: 'https://appcentral-int.aptean.com',
    cookieFile: null,
    format: 'json',
    output: null,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--responsible-party' && args[i + 1]) opts.responsibleParty = args[++i].split(',').map((s) => s.trim());
    else if (a === '--exclude-status' && args[i + 1]) opts.excludeStatus = args[++i].split(',').map((s) => s.trim());
    else if (a === '--sort-by' && args[i + 1]) opts.sortBy = args[++i];
    else if (a === '--sort-order' && args[i + 1]) opts.sortOrder = args[++i];
    else if (a === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i], 10);
    else if (a === '--page' && args[i + 1]) opts.page = parseInt(args[++i], 10);
    else if (a === '--all') opts.all = true;
    else if (a === '--max-pages' && args[i + 1]) opts.maxPages = parseInt(args[++i], 10);
    else if (a === '--base-url' && args[i + 1]) opts.baseUrl = args[++i].replace(/\/+$/, '');
    else if (a === '--cookie-file' && args[i + 1]) opts.cookieFile = args[++i];
    else if (a === '--format' && args[i + 1]) opts.format = args[++i];
    else if (a === '--output' && args[i + 1]) opts.output = args[++i];
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function assertLooksLikeCookieHeader(cookie) {
  const isBareJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cookie);
  const hasCookiePairs = /[A-Za-z0-9_]+=[^;]+/.test(cookie) && cookie.includes(';');
  if (isBareJwt || !hasCookiePairs) {
    throw new Error(
      'This looks like a bare JWT (or something that is not a full cookie header), not the ' +
        '"cookie" request header value. In DevTools > Network, open the /cxt/cases/search/ ' +
        'request, go to Request Headers, and copy the entire "cookie" value ' +
        '(e.g. "AUT_SESSION_ID=...; X_APTEAN_TOKEN=<jwt>; sessionid=...; csrftoken=..."), not just the JWT.'
    );
  }
}

function resolveCookie(opts) {
  let cookie;
  if (opts.cookieFile) {
    if (!fs.existsSync(opts.cookieFile)) {
      throw new Error(`--cookie-file "${opts.cookieFile}" does not exist.`);
    }
    cookie = fs.readFileSync(opts.cookieFile, 'utf-8').trim();
  } else if (process.env.CXT_COOKIE) {
    cookie = process.env.CXT_COOKIE.trim();
  } else {
    throw new Error(
      'No session cookie provided. Set CXT_COOKIE env var or pass --cookie-file <path>. Run with --help for details.'
    );
  }
  assertLooksLikeCookieHeader(cookie);
  return cookie;
}

function extractCsrfToken(cookieHeader) {
  const match = cookieHeader.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? match[1] : null;
}

function searchCases({ baseUrl, cookie, body }) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/aurora/be/api/cxt/cases/search/`);
    const bodyStr = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      Accept: '*/*',
      Origin: baseUrl,
      Referer: `${baseUrl}/aurora/cxt?iframe=true`,
      Cookie: cookie,
      'Content-Length': Buffer.byteLength(bodyStr),
    };
    const csrfToken = extractCsrfToken(cookie);
    if (csrfToken) headers['X-CSRFToken'] = csrfToken;

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(
              new Error(
                `CXT rejected the request (HTTP ${res.statusCode}). Your session cookie is likely expired or invalid — capture a fresh one and retry. Body: ${data.slice(0, 300)}`
              )
            );
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`CXT API HTTP ${res.statusCode}: ${data.slice(0, 400)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse CXT response as JSON: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function extractCaseList(response) {
  if (Array.isArray(response)) return { cases: response, metadata: null };
  for (const key of ['cases', 'results', 'items', 'records', 'data']) {
    if (Array.isArray(response?.[key])) {
      return { cases: response[key], metadata: response.metadata ?? null };
    }
  }
  if (response?.data && typeof response.data === 'object') {
    for (const key of ['cases', 'results', 'items', 'records']) {
      if (Array.isArray(response.data[key])) {
        return { cases: response.data[key], metadata: response.data.metadata ?? null };
      }
    }
  }
  return null;
}

function toCsv(rows) {
  if (rows.length === 0) return '';
  const columns = Array.from(rows.reduce((set, row) => {
    Object.keys(row || {}).forEach((k) => set.add(k));
    return set;
  }, new Set()));
  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((col) => escape(row[col])).join(','));
  }
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs();

  if (!opts.responsibleParty) {
    console.error('Error: --responsible-party is required.\n');
    printHelp();
    process.exit(1);
  }

  let cookie;
  try {
    cookie = resolveCookie(opts);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  const baseFilters = {
    excludeStatus: opts.excludeStatus,
    responsibleParty: opts.responsibleParty,
    sortBy: opts.sortBy,
    sortOrder: opts.sortOrder,
  };

  const allCases = [];
  const pagesToFetch = opts.all ? Array.from({ length: opts.maxPages }, (_, i) => i + 1) : [opts.page];

  for (const page of pagesToFetch) {
    const body = {
      queryType: 'cases',
      filters: baseFilters,
      sortBy: opts.sortBy,
      sortOrder: opts.sortOrder,
      limit: opts.limit,
      page,
    };

    let response;
    try {
      response = await searchCases({ baseUrl: opts.baseUrl, cookie, body });
    } catch (e) {
      console.error(`Error on page ${page}: ${e.message}`);
      process.exit(1);
    }

    const result = extractCaseList(response);
    if (result === null) {
      // Written to a file, never printed: the response may contain customer case data.
      const dest = opts.output || 'cxt-raw-response.json';
      fs.writeFileSync(dest, JSON.stringify(response, null, 2));
      console.error(`Warning: could not find a case array in the response shape. Wrote raw response to ${dest} for inspection (not printed, may contain case data).`);
      return;
    }

    const { cases: batch } = result;
    allCases.push(...batch);

    if (opts.all) {
      console.error(`Fetched page ${page} (${batch.length} cases, ${allCases.length} total so far)`);
    }

    // NOTE: response.data.metadata.total/totalPages describe only the current
    // page's batch size, not the full result set (verified: page N+1 returns
    // different cases than page N while metadata still reports total=limit).
    // Do not use metadata for the stop condition - a short/empty page is the
    // only reliable end-of-results signal.
    if (!opts.all || batch.length < opts.limit) break;
  }

  let output;
  if (opts.format === 'csv') {
    output = toCsv(allCases);
  } else {
    output = JSON.stringify(allCases, null, 2);
  }

  if (opts.output) {
    fs.writeFileSync(opts.output, output);
    console.error(`Wrote ${allCases.length} case(s) to ${opts.output}`);
  } else {
    console.log(output);
  }
}

main();
