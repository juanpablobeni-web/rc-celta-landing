// setup-mailchimp.js
// One-time (re-runnable, idempotent) provisioner for the audience's merge fields.
// Reads MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID from .env.
// EMAIL/FNAME/LNAME are Mailchimp built-ins and are NOT created here.
//
// Usage:  node setup-mailchimp.js

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// Custom merge fields. Tags must be ≤10 char uppercase.
const FIELDS = [
  { tag: 'GRADA',      name: 'Grada (sector name)',         type: 'text' },
  { tag: 'GRADAID',    name: 'Grada (sector ID)',           type: 'text' },
  { tag: 'MATCH',      name: 'Partido',                     type: 'text' },
  { tag: 'MATCHID',    name: 'Session ID',                  type: 'text' },
  { tag: 'MATCHDATE',  name: 'Fecha del partido',           type: 'date' },
  { tag: 'VENUE',      name: 'Estadio',                     type: 'text' },
  { tag: 'MATCHPRICE', name: 'Rango de precio',             type: 'text' },
  { tag: 'MATCHSTAT',  name: 'Estado de venta',             type: 'text' },
  { tag: 'PRIVACYTS',  name: 'Privacy consent timestamp',   type: 'text' },
  { tag: 'SOURCE',     name: 'Signup source',               type: 'text' },
];

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return env;
}

(async () => {
  const env = loadEnv(join(__dirname, '.env'));
  const key    = env.MAILCHIMP_API_KEY;
  const listId = env.MAILCHIMP_AUDIENCE_ID;
  if (!key || !listId) {
    console.error('Missing MAILCHIMP_API_KEY or MAILCHIMP_AUDIENCE_ID in .env');
    process.exit(1);
  }
  const dc = key.includes('-') ? key.split('-')[1] : '';
  if (!dc) {
    console.error('API key has no data-center suffix (expected like "abc…-us21")');
    process.exit(1);
  }
  const base = `https://${dc}.api.mailchimp.com/3.0/lists/${listId}/merge-fields`;
  const auth = 'Basic ' + Buffer.from(`anystring:${key}`).toString('base64');
  const headers = { 'Authorization': auth, 'Accept': 'application/json' };

  // 1. Fetch existing merge fields (paginated).
  const existing = new Set();
  let offset = 0;
  for (;;) {
    const r = await fetch(`${base}?count=100&offset=${offset}`, { headers });
    if (!r.ok) {
      console.error(`GET merge-fields failed: HTTP ${r.status}`);
      console.error((await r.text()).slice(0, 500));
      process.exit(2);
    }
    const body = await r.json();
    const batch = body.merge_fields || [];
    for (const f of batch) existing.add(f.tag);
    const total = body.total_items || 0;
    offset += batch.length;
    if (!batch.length || offset >= total) break;
  }

  console.log(`Audience: ${listId}  (data-center ${dc})`);
  console.log(`Existing custom merge tags: ${[...existing].sort().join(', ') || '(none)'}\n`);

  // 2. Create only the missing ones.
  let created = 0, skipped = 0, failed = 0;
  for (const f of FIELDS) {
    if (existing.has(f.tag)) {
      console.log(`  ·  skip    ${f.tag.padEnd(11)}  (already exists)`);
      skipped++;
      continue;
    }
    const r = await fetch(base, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag: f.tag, name: f.name, type: f.type,
        required: false, public: false,
      }),
    });
    if (r.ok) {
      console.log(`  +  create  ${f.tag.padEnd(11)}  (${f.type}) ${f.name}`);
      created++;
    } else {
      const txt = (await r.text()).slice(0, 300).replace(/\s+/g, ' ');
      console.log(`  !  fail    ${f.tag.padEnd(11)}  HTTP ${r.status}: ${txt}`);
      failed++;
    }
  }

  console.log(`\nDone. created ${created}, skipped ${skipped}, failed ${failed}.`);
  if (failed > 0) process.exit(3);
})().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
