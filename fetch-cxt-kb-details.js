/**
 * CXT KB Article Detail Fetcher
 *
 * Reads kb.json (produced by fetch-cxt-kb.js — list-level metadata only) and
 * fetches full body content for each article via the CXT KB article-details
 * endpoint, then writes a new file with title + rendered plain-text content.
 *
 * Same auth model as fetch-cxt-tickets.js / fetch-cxt-kb.js — manual session
 * cookie, never hardcoded or committed.
 *
 * Usage:
 *   node fetch-cxt-kb-details.js --input kb.json --cookie-file .cxt-session --output kb-full.json
 *
 * Resumable: writes --output incrementally every --save-every articles, and on
 * a fresh run skips any article whose Id is already present with real content
 * in an existing --output file (so a rerun after a 401/interruption continues
 * where it left off instead of starting over — just recapture a fresh cookie
 * and rerun the same command). Stops immediately on the first 401/403 rather
 * than burning through the rest of the batch with a dead cookie.
 */
const https = require('https');
const fs = require('fs');

function printHelp() {
  console.log(`
Usage: node fetch-cxt-kb-details.js --input kb.json --cookie-file <path> [options]

Options:
  --input <path>        Input file from fetch-cxt-kb.js. Default: kb.json
  --base-url <url>       Default: https://appcentral-int.aptean.com
  --cookie-file <path>   Read Cookie header value from a local file instead of CXT_COOKIE env var.
  --output <path>        Output file. Default: kb-full.json
  --delay-ms <n>         Delay between requests to avoid hammering the API. Default: 300
  --save-every <n>       Write progress to --output every N articles. Default: 25
  --help, -h             Show this help message.
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    input: 'kb.json',
    baseUrl: 'https://appcentral-int.aptean.com',
    cookieFile: null,
    output: 'kb-full.json',
    delayMs: 300,
    saveEvery: 25,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--input' && args[i + 1]) opts.input = args[++i];
    else if (a === '--base-url' && args[i + 1]) opts.baseUrl = args[++i].replace(/\/+$/, '');
    else if (a === '--cookie-file' && args[i + 1]) opts.cookieFile = args[++i];
    else if (a === '--output' && args[i + 1]) opts.output = args[++i];
    else if (a === '--delay-ms' && args[i + 1]) opts.delayMs = parseInt(args[++i], 10);
    else if (a === '--save-every' && args[i + 1]) opts.saveEvery = parseInt(args[++i], 10);
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
      'This looks like a bare JWT, not the full "cookie" request header value. ' +
        'Copy the entire cookie string from DevTools, not just the JWT.'
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
    throw new Error('No session cookie provided. Set CXT_COOKIE env var or pass --cookie-file <path>.');
  }
  assertLooksLikeCookieHeader(cookie);
  return cookie;
}

function extractCsrfToken(cookieHeader) {
  const match = cookieHeader.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? match[1] : null;
}

function getArticleDetails({ baseUrl, cookie, articleId }) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/aurora/be/api/cxt/kb/article-details/${articleId}/`);
    const headers = {
      Accept: '*/*',
      Origin: baseUrl,
      Referer: `${baseUrl}/aurora/cxt?iframe=true`,
      Cookie: cookie,
    };
    const csrfToken = extractCsrfToken(cookie);
    if (csrfToken) headers['X-CSRFToken'] = csrfToken;

    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method: 'GET', headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new Error(`HTTP ${res.statusCode} — session cookie likely expired. Body: ${data.slice(0, 300)}`));
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 400)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// Minimal HTML-to-text: strip tags, decode common entities, collapse whitespace,
// keep paragraph/list breaks readable.
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function buildContent(record) {
  const sections = [];
  const problem = htmlToText(record.Problem__c);
  const cause = htmlToText(record.Cause__c);
  const resolution = htmlToText(record.Resolution__c);
  const answer = htmlToText(record.Answer__c);
  const details = htmlToText(record.Details__c);
  const body = htmlToText(record.Article_Body__c);

  if (problem) sections.push(`Problem\n${problem}`);
  if (cause) sections.push(`Cause\n${cause}`);
  if (resolution) sections.push(`Resolution\n${resolution}`);
  if (answer) sections.push(`Answer\n${answer}`);
  if (details) sections.push(`Details\n${details}`);
  if (body) sections.push(body);

  return sections.length ? sections.join('\n\n') : record.Title;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = parseArgs();

  if (!fs.existsSync(opts.input)) {
    console.error(`Error: input file "${opts.input}" does not exist.`);
    process.exit(1);
  }

  let cookie;
  try {
    cookie = resolveCookie(opts);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  const articles = JSON.parse(fs.readFileSync(opts.input, 'utf-8'));

  // Resume support: reuse already-fetched (non-title-only) results from a prior run.
  const done = new Map();
  if (fs.existsSync(opts.output)) {
    try {
      const prior = JSON.parse(fs.readFileSync(opts.output, 'utf-8'));
      for (const a of prior) {
        if (a.Id && a.content && a.content !== a.Title) done.set(a.Id, a);
      }
      if (done.size) console.error(`Resuming: ${done.size} article(s) already fetched in ${opts.output}, skipping those.`);
    } catch {
      // Corrupt/partial prior output — ignore and start fresh.
    }
  }

  const results = articles.map((a) => done.get(a.Id) || null);
  const pending = articles.filter((a) => !done.has(a.Id));

  const save = () => {
    fs.writeFileSync(opts.output, JSON.stringify(results.filter(Boolean), null, 2));
  };

  let fetchedThisRun = 0;
  for (let i = 0; i < articles.length; i++) {
    if (results[i]) continue; // already resumed from prior output
    const article = articles[i];
    const id = article.Id;
    try {
      const response = await getArticleDetails({ baseUrl: opts.baseUrl, cookie, articleId: id });
      const record = response?.records?.[0];
      if (!record) {
        console.error(`  WARN  ${id}  no record in response, keeping title-only`);
        results[i] = { ...article, content: article.Title };
      } else {
        const content = buildContent(record);
        results[i] = { ...article, content };
        console.log(`  OK  ${article.ArticleNumber}  "${article.Title.slice(0, 60)}"  (${content.length} chars)`);
      }
    } catch (e) {
      const isAuthError = /401|403|session cookie likely expired/i.test(e.message);
      if (isAuthError) {
        console.error(`\nFATAL  ${e.message}`);
        console.error(`Stopping early — recapture a fresh cookie and rerun the same command to resume (${pending.length - fetchedThisRun} article(s) left).`);
        save();
        process.exit(1);
      }
      console.error(`  FAIL  ${article.ArticleNumber}  "${article.Title.slice(0, 60)}"  ${e.message}`);
      results[i] = { ...article, content: article.Title };
    }

    fetchedThisRun++;
    if (fetchedThisRun % opts.saveEvery === 0) {
      save();
      console.error(`  ...saved progress (${fetchedThisRun}/${pending.length} this run)`);
    }
    await sleep(opts.delayMs);
  }

  save();
  console.log(`\nWrote ${results.filter(Boolean).length} article(s) with full content to ${opts.output}`);
}

main();
