// generate-landing.js
// Auth against ONEBOX, fetch the watched session, and rewrite landing.html
// with two pieces of fresh data:
//   1. The "match card" at the top (title, date, venue, price, availability,
//      status) — bound via [data-bind] attributes.
//   2. The grada <select> options — one <option> per real sector.
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

const numFmt  = new Intl.NumberFormat('es-ES');
const dateFmt = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

function formatDate(iso) {
  if (!iso) return '';
  try {
    return dateFmt.format(new Date(iso))
      .replace(/\bsept\.?\b/i, 'sept.') // keep month abbrevs tidy
      .replace(/,\s+(\d)/, ', $1');
  } catch { return iso; }
}

function formatPrice(min, max) {
  if (min == null || max == null) return '';
  if (min === max) return `${min} €`;
  return `${min} € – ${max} €`;
}

function statusOf(s) {
  if (s.sold_out) return { label: 'AGOTADO', cls: 'sold-out' };
  if (s.for_sale) return { label: 'EN VENTA', cls: 'on-sale' };
  return { label: 'PRÓXIMAMENTE', cls: 'upcoming' };
}

// Replace the inner text of an element matched by a data-bind attribute.
function replaceBind(html, key, text) {
  const re = new RegExp(`(<[^>]+\\bdata-bind="${key}"[^>]*>)[^<]*(<\\/[^>]+>)`);
  if (!re.test(html)) {
    console.warn(`  warning: data-bind="${key}" not found in landing.html`);
    return html;
  }
  return html.replace(re, (_, open, close) => `${open}${escapeHtml(text)}${close}`);
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
  if (!token) { console.error('No access_token returned.'); process.exit(2); }
  const auth = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

  // 2. Sessions list (for match metadata) + availability (for sectors)
  const [sessionsRes, availRes] = await Promise.all([
    fetch(`${ONEBOX_BASE_URL}/catalog-api/v1/sessions`, { headers: auth }),
    fetch(`${ONEBOX_BASE_URL}/catalog-api/v1/sessions/${encodeURIComponent(sessionId)}/availability`, { headers: auth }),
  ]);
  if (!sessionsRes.ok) {
    console.error(`Sessions fetch failed: HTTP ${sessionsRes.status}`); process.exit(3);
  }
  if (!availRes.ok) {
    console.error(`Availability fetch failed for session ${sessionId}: HTTP ${availRes.status}`); process.exit(3);
  }
  const sessionsBody = await sessionsRes.json();
  const items = sessionsBody.content || sessionsBody.data || sessionsBody.sessions ||
                (Array.isArray(sessionsBody) ? sessionsBody : []);
  const session = items.find(s => String(s.id) === String(sessionId));
  if (!session) {
    console.error(`Session ${sessionId} not found in /sessions list (got ${items.length} items).`);
    process.exit(4);
  }
  const av = await availRes.json();

  // 3. Build match-card values
  const eventName = (session.event && session.event.name) || session.name || '—';
  const subtitle  = (session.event && session.event.texts && session.event.texts.subtitle && session.event.texts.subtitle['es-ES']) || '';
  const venueName = (session.venue && session.venue.name) || '';
  const venueCity = (session.venue && session.venue.location && session.venue.location.city) || '';
  const venueText = [venueName, venueCity].filter(Boolean).join(', ');
  const dateText  = formatDate(session.date && session.date.start);
  const priceMin  = session.price && session.price.min && session.price.min.value;
  const priceMax  = session.price && session.price.max && session.price.max.value;
  const priceText = formatPrice(priceMin, priceMax);

  const pt = (session.availability && session.availability.price_types) || [];
  const total = pt.reduce((acc, p) => acc + (((p.availability) || {}).total    || 0), 0);
  const avail = pt.reduce((acc, p) => acc + (((p.availability) || {}).available || 0), 0);
  const pct = total ? Math.round(100 * avail / total) : 0;
  const availText = total ? `${numFmt.format(avail)} / ${numFmt.format(total)} (${pct}%)` : '—';

  const status = statusOf(session);

  // 4. Sectors for the grada <select>
  const sectors = (av.sectors || [])
    .map(s => ({ id: s.id, name: s.name }))
    .filter(s => s.id != null && s.name);
  if (sectors.length === 0) {
    console.error(`No sectors returned for session ${sessionId}. Aborting — landing.html not modified.`);
    process.exit(5);
  }

  // 5. Rewrite landing.html
  let html = readFileSync(LANDING_PATH, 'utf8');

  // 5a. Match-card binds
  html = replaceBind(html, 'event-name',     eventName);
  html = replaceBind(html, 'event-subtitle', subtitle);
  html = replaceBind(html, 'date',           dateText);
  html = replaceBind(html, 'venue',          venueText);
  html = replaceBind(html, 'price',          priceText);
  html = replaceBind(html, 'availability',   availText);

  // Status: replace label text + data-status attribute on the same element.
  html = html.replace(
    /(<[^>]+\bdata-bind="status"[^>]*\bdata-status=")[^"]*("[^>]*>)[^<]*(<\/[^>]+>)/,
    (_, p1, p2, p3) => `${p1}${status.cls}${p2}${escapeHtml(status.label)}${p3}`
  );

  // 5b. Sector replacement (existing logic)
  const re = /([ \t]*)(<select\b[^>]*\bid="grada"[^>]*>)([\s\S]*?)(<\/select>)/;
  const m = html.match(re);
  if (!m) {
    console.error('Could not find <select id="grada"> in landing.html.');
    process.exit(6);
  }
  const baseIndent = m[1];
  const optIndent  = baseIndent + '  ';
  const newInner = '\n' +
    optIndent + '<option value="" disabled selected>Selecciona tu grada</option>\n' +
    sectors.map(s => `${optIndent}<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('\n') +
    '\n' + baseIndent;
  html = html.replace(re, `$1$2${newInner}$4`);

  writeFileSync(LANDING_PATH, html);

  console.log(`Match card baked for session ${sessionId}:`);
  console.log(`  event:        ${eventName}${subtitle ? ' (' + subtitle + ')' : ''}`);
  console.log(`  date:         ${dateText || '—'}`);
  console.log(`  venue:        ${venueText || '—'}`);
  console.log(`  price:        ${priceText || '—'}`);
  console.log(`  availability: ${availText} [${status.label}]`);
  console.log(`Sectors baked:  ${sectors.length}`);
})().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
