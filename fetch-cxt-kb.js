/**
 * CXT Knowledge Base Article Fetcher
 *
 * Calls the internal CXT KB-search API (Aurora backend) to pull knowledge
 * base articles for a product line / owner / status, with pagination support.
 * Mirrors fetch-cxt-tickets.js — same auth model (manual session cookie),
 * same safety rules.
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
 * Usage:
 *   node fetch-cxt-kb.js --product-line "Traverse Global" --owner "Vishnu Asokan" --cookie-file .cxt-session
 *   node fetch-cxt-kb.js --product-line "Traverse Global" --status Online --all --output kb.json
 *
 * Options:
 *   --product-line <name>       Filter by Product_Line__c. e.g. "Traverse Global"
 *   --owner <name>              Filter by ownerName. e.g. "Vishnu Asokan"
 *   --status <status>           Filter by PublishStatus. Default: Online
 *   --limit <n>                 Page size. Default: 15 (matches observed UI default)
 *   --offset <n>                Starting offset for a single page. Default: 0
 *   --all                       Paginate through all pages (by offset) until a short/empty page.
 *   --max-pages <n>             Safety cap when using --all. Default: 20
 *   --base-url <url>            Default: https://appcentral-int.aptean.com
 *   --cookie-file <path>        Read the Cookie header value from a local file instead of CXT_COOKIE.
 *   --format json|csv           Output format. Default: json
 *   --output <path>             Write to a file instead of stdout.
 *   --help, -h                  Show this help message.
 *
 * Auth:
 *   Set CXT_COOKIE to the raw "cookie" request header value copied from your
 *   browser's Network tab for a /cxt/kb/search/ request, or pass
 *   --cookie-file pointing at a local (gitignored) file containing it.
 */

const https = require('https');
const fs = require('fs');

function printHelp() {
  console.log(`
Usage: node fetch-cxt-kb.js --product-line <name> [options]

Options:
  --product-line <name>       Filter by Product_Line__c. e.g. "Traverse Global"
  --owner <name>              Filter by ownerName.
  --status <status>           Filter by PublishStatus. Default: Online
  --limit <n>                 Page size. Default: 15
  --offset <n>                Starting offset for a single page. Default: 0
  --all                       Paginate through all pages (by offset).
  --max-pages <n>             Safety cap when using --all. Default: 20
  --base-url <url>            Default: https://appcentral-int.aptean.com
  --cookie-file <path>        Read Cookie header value from a local file instead of CXT_COOKIE env var.
  --format json|csv           Output format. Default: json
  --output <path>             Write result to a file instead of stdout.
  --help, -h                  Show this help message.

Auth:
  Set CXT_COOKIE to the raw "cookie" request header value copied from your
  browser's Network tab for a /cxt/kb/search/ request, or pass
  --cookie-file pointing at a local (gitignored) file containing it.
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    productLine: null,
    owner: null,
    status: 'Online',
    limit: 15,
    offset: 0,
    all: false,
    maxPages: 20,
    baseUrl: 'https://appcentral-int.aptean.com',
    cookieFile: null,
    format: 'json',
    output: null,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--product-line' && args[i + 1]) opts.productLine = args[++i];
    else if (a === '--owner' && args[i + 1]) opts.owner = args[++i];
    else if (a === '--status' && args[i + 1]) opts.status = args[++i];
    else if (a === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i], 10);
    else if (a === '--offset' && args[i + 1]) opts.offset = parseInt(args[++i], 10);
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
        '"cookie" request header value. In DevTools > Network, open the /cxt/kb/search/ ' +
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

function searchKb({ baseUrl, cookie, body }) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/aurora/be/api/cxt/kb/search/`);
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

  let cookie;
  try {
    cookie = resolveCookie(opts);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  const baseFilters = {};
  if (opts.productLine) baseFilters.productLine = opts.productLine;
  if (opts.owner) baseFilters.ownerName = opts.owner;
  if (opts.status) baseFilters.status = opts.status;

  const allArticles = [];
  const offsetsToFetch = opts.all
    ? Array.from({ length: opts.maxPages }, (_, i) => opts.offset + i * opts.limit)
    : [opts.offset];

  for (const offset of offsetsToFetch) {
    const body = { ...baseFilters, limit: opts.limit, offset };

    let response;
    try {
      response = await searchKb({ baseUrl: opts.baseUrl, cookie, body });
    } catch (e) {
      console.error(`Error at offset ${offset}: ${e.message}`);
      process.exit(1);
    }

    const batch = Array.isArray(response?.articles) ? response.articles : null;
    if (batch === null) {
      const dest = opts.output ? `${opts.output}.raw.json` : 'cxt-kb-raw-response.json';
      fs.writeFileSync(dest, JSON.stringify(response, null, 2));
      console.error(`Warning: could not find an "articles" array in the response shape. Wrote raw response to ${dest} for inspection.`);
      return;
    }

    allArticles.push(...batch);

    if (opts.all) {
      console.error(`Fetched offset ${offset} (${batch.length} articles, ${allArticles.length} total so far)`);
    }

    if (!opts.all || batch.length < opts.limit) break;
  }

  let output;
  if (opts.format === 'csv') {
    output = toCsv(allArticles);
  } else {
    output = JSON.stringify(allArticles, null, 2);
  }

  if (opts.output) {
    fs.writeFileSync(opts.output, output);
    console.error(`Wrote ${allArticles.length} article(s) to ${opts.output}`);
  } else {
    console.log(output);
  }
}

main();
