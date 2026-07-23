/**
 * Bulk-imports cases.json (fetched via fetch-cxt-tickets.js) into Remedium
 * by POSTing each ticket to the case intake API.
 *
 * Usage:
 *   node import-cxt-cases.js [--input cases.json] [--api-url http://localhost:8000]
 */
const fs = require('fs');
const http = require('http');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: 'cases.json', apiUrl: 'http://localhost:8000' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) opts.input = args[++i];
    else if (args[i] === '--api-url' && args[i + 1]) opts.apiUrl = args[++i].replace(/\/+$/, '');
  }
  return opts;
}

function mapPriority(cxtPriority, cxtSeverity) {
  const p = `${cxtPriority || ''} ${cxtSeverity || ''}`.toLowerCase();
  if (p.includes('urgent') || p.includes('critical')) return 'critical';
  if (p.includes('high')) return 'high';
  if (p.includes('low')) return 'low';
  return 'medium';
}

function toCaseIngest(cxtCase) {
  return {
    title: cxtCase.subject,
    description: cxtCase.description || cxtCase.subject,
    customer: cxtCase.account || null,
    product: cxtCase.product || cxtCase.productLine || null,
    version: null,
    priority: mapPriority(cxtCase.priority, cxtCase.severity),
    external_id: cxtCase.caseNumber || cxtCase.id || null,
  };
}

function postCase(apiUrl, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${apiUrl}/api/cases/`);
    const bodyStr = JSON.stringify(body);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 400)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse response as JSON: ${e.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function main() {
  const opts = parseArgs();

  if (!fs.existsSync(opts.input)) {
    console.error(`Error: input file "${opts.input}" does not exist.`);
    process.exit(1);
  }

  const cxtCases = JSON.parse(fs.readFileSync(opts.input, 'utf-8'));
  console.log(`Importing ${cxtCases.length} case(s) from ${opts.input} into ${opts.apiUrl}...`);

  let succeeded = 0;
  let failed = 0;

  for (const cxtCase of cxtCases) {
    const body = toCaseIngest(cxtCase);
    try {
      const created = await postCase(opts.apiUrl, body);
      console.log(`  OK  ${body.external_id}  ->  case id ${created.id}  "${body.title.slice(0, 60)}"`);
      succeeded++;
    } catch (e) {
      console.error(`  FAIL  ${body.external_id}  "${body.title.slice(0, 60)}"  ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
}

main();
