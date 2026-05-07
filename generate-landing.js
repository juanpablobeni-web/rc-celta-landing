// generate-landing.js
// Auth against ONEBOX, fetch /availability for one session, and rewrite the
// grada <select> in landing.html with one <option> per real sector.
//
// Usage:
//   node generate-landing.js [sessionId]   (defaults to 240895)

const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const DEFAULT_SESSION_ID = '240895';
const LANDING_PATH = join(__dirname, 'landing.html');
const ENV_PATH     = join(__dirname, '.env');

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

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

(async () => {
  const sessionId = process.argv[2] || DEFAULT_SESSION_ID;
  const env = loadEnv(ENV_PATH);
  const required = ['ONEBOX_BASE_URL', 'ONEBOX_CHANNEL_ID', 'ONEBOX_CLIENT_ID', 'ONEBOX_CLIENT_SECRET'];
  const missing = required.filter(k => !env[k]);
  if (missing.length) {
    console.error('Missing required env vars in .env:', missing.join(', '));
    process.exit(1);
  }
  const { ONEBOX_BASE_URL, ONEBOX_CHANNEL_ID, ONEBOX_CLIENT_ID, ONEBOX_CLIENT_SECRET } = env;

  // 1. Token
  const tokenRes = await fetch(`${ONEBOX_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      channel_id: ONEBOX_CHANNEL_ID,
      client_id: ONEBOX_CLIENT_ID,
      client_secret: ONEBOX_CLIENT_SECRET,
    }).toString(),
  });
  if (!tokenRes.ok) {
    console.error(`Auth failed: HTTP ${tokenRes.status}`);
    console.error(await tokenRes.text());
    process.exit(2);
  }
  const { access_token: token } = await tokenRes.json();
  if (!token) {
    console.error('No access_token in /oauth/token response.');
    process.exit(2);
  }

  // 2. Availability
  const url = `${ONEBOX_BASE_URL}/catalog-api/v1/sessions/${encodeURIComponent(sessionId)}/availability`;
  const avRes = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  if (!avRes.ok) {
    console.error(`Availability fetch failed for session ${sessionId}: HTTP ${avRes.status}`);
    console.error(await avRes.text());
    process.exit(3);
  }
  const av = await avRes.json();
  const sectors = (av.sectors || [])
    .map(s => ({ id: s.id, name: s.name }))
    .filter(s => s.id != null && s.name);
  if (sectors.length === 0) {
    console.error(`No sectors returned for session ${sessionId}. Aborting — landing.html not modified.`);
    process.exit(4);
  }

  // 3. Rewrite landing.html — replace inner content of <select id="grada">
  let html = readFileSync(LANDING_PATH, 'utf8');
  const re = /([ \t]*)(<select\b[^>]*\bid="grada"[^>]*>)([\s\S]*?)(<\/select>)/;
  const m = html.match(re);
  if (!m) {
    console.error('Could not find <select id="grada"> in landing.html.');
    process.exit(5);
  }
  const baseIndent = m[1];
  const optIndent  = baseIndent + '  ';
  const newInner = '\n' +
    optIndent + '<option value="" disabled selected>Selecciona tu grada</option>\n' +
    sectors.map(s => `${optIndent}<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('\n') +
    '\n' + baseIndent;
  html = html.replace(re, `$1$2${newInner}$4`);
  writeFileSync(LANDING_PATH, html);

  console.log(`Baked in ${sectors.length} sectors for session ${sessionId}.`);
})().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
