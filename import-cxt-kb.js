/**
 * Bulk-imports kb.json / kb-full.json (fetched via fetch-cxt-kb.js and
 * optionally enriched by fetch-cxt-kb-details.js) into Remedium's LiveKB.
 *
 * If an article with the same external_id already exists in Remedium, its
 * content is updated in place (PATCH) instead of creating a duplicate.
 *
 * Usage:
 *   node import-cxt-kb.js [--input kb.json] [--api-url http://localhost:8000]
 */
const fs = require('fs');
const http = require('http');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: 'kb.json', apiUrl: 'http://localhost:8000' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) opts.input = args[++i];
    else if (args[i] === '--api-url' && args[i + 1]) opts.apiUrl = args[++i].replace(/\/+$/, '');
  }
  return opts;
}

function toArticleIngest(cxtArticle) {
  const content = cxtArticle.content || cxtArticle.Summary || cxtArticle.Title;
  return {
    external_id: cxtArticle.ArticleNumber || cxtArticle.Id || null,
    title: cxtArticle.Title,
    content,
    product: cxtArticle.Product_Line__c || null,
    tags: [],
  };
}

function request(method, apiUrl, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${apiUrl}${path}`);
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = bodyStr
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
      : {};
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 400)}`));
            return;
          }
          try {
            resolve(data ? JSON.parse(data) : null);
          } catch (e) {
            reject(new Error(`Failed to parse response as JSON: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function main() {
  const opts = parseArgs();

  if (!fs.existsSync(opts.input)) {
    console.error(`Error: input file "${opts.input}" does not exist.`);
    process.exit(1);
  }

  const cxtArticles = JSON.parse(fs.readFileSync(opts.input, 'utf-8'));
  console.log(`Importing ${cxtArticles.length} article(s) from ${opts.input} into ${opts.apiUrl}...`);

  const existing = await request('GET', opts.apiUrl, '/api/kb/articles');
  const existingByExternalId = new Map(
    existing.filter((a) => a.external_id).map((a) => [a.external_id, a])
  );

  let created = 0;
  let updated = 0;
  let failed = 0;
  const total = cxtArticles.length;

  for (let i = 0; i < total; i++) {
    const cxtArticle = cxtArticles[i];
    const body = toArticleIngest(cxtArticle);
    const match = body.external_id ? existingByExternalId.get(body.external_id) : null;

    try {
      if (match) {
        await request('PATCH', opts.apiUrl, `/api/kb/articles/${match.id}`, { content: body.content });
        updated++;
      } else {
        await request('POST', opts.apiUrl, '/api/kb/articles', body);
        created++;
      }
    } catch (e) {
      console.error(`  FAIL  ${body.external_id}  "${body.title.slice(0, 60)}"  ${e.message}`);
      failed++;
    }

    if ((i + 1) % 25 === 0 || i === total - 1) {
      console.log(`  ${i + 1}/${total}  (${created} created, ${updated} updated, ${failed} failed)`);
    }
  }

  console.log(`\nDone. ${created} created, ${updated} updated, ${failed} failed.`);
}

main();
