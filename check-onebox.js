const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

function mask(secret) {
  if (!secret || secret.length < 8) return '****';
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

async function readJson(res) {
  const raw = await res.text();
  try { return { raw, json: JSON.parse(raw) }; } catch { return { raw, json: null }; }
}

(async () => {
  const env = loadEnv(join(__dirname, '.env'));
  const { ONEBOX_BASE_URL, ONEBOX_CHANNEL_ID, ONEBOX_CLIENT_ID, ONEBOX_CLIENT_SECRET } = env;

  const required = { ONEBOX_BASE_URL, ONEBOX_CHANNEL_ID, ONEBOX_CLIENT_ID, ONEBOX_CLIENT_SECRET };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Missing required env vars in .env: ${missing.join(', ')}`);
    process.exit(1);
  }

  const tokenUrl = `${ONEBOX_BASE_URL}/oauth/token`;
  const sessionsUrl = `${ONEBOX_BASE_URL}/catalog-api/v1/sessions`;

  console.log(`Step 1 — POST ${tokenUrl}`);
  console.log(`  grant_type:    client_credentials`);
  console.log(`  channel_id:    ${ONEBOX_CHANNEL_ID}`);
  console.log(`  client_id:     ${ONEBOX_CLIENT_ID}`);
  console.log(`  client_secret: ${mask(ONEBOX_CLIENT_SECRET)}`);
  console.log();

  let tokenRes;
  try {
    tokenRes = await fetch(tokenUrl, {
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
  } catch (err) {
    console.error('Token request failed (network/DNS/TLS):', err.message);
    process.exit(1);
  }

  const { raw: tokenRaw, json: tokenJson } = await readJson(tokenRes);
  console.log(`Status: ${tokenRes.status} ${tokenRes.statusText}`);
  console.log('Response:');
  console.log(tokenJson ? JSON.stringify(tokenJson, null, 2) : tokenRaw);
  console.log();

  if (!tokenRes.ok || !tokenJson || !tokenJson.access_token) {
    console.log('Result: INVALID — credentials rejected at /oauth/token.');
    process.exit(2);
  }

  console.log(`Step 2 — GET ${sessionsUrl}`);
  console.log(`  Authorization: Bearer ${mask(tokenJson.access_token)}`);
  console.log();

  let sessionsRes;
  try {
    sessionsRes = await fetch(sessionsUrl, {
      headers: {
        'Authorization': `Bearer ${tokenJson.access_token}`,
        'Accept': 'application/json',
      },
    });
  } catch (err) {
    console.error('Sessions request failed:', err.message);
    process.exit(1);
  }

  const { raw: sessionsRaw, json: sessionsJson } = await readJson(sessionsRes);
  console.log(`Status: ${sessionsRes.status} ${sessionsRes.statusText}`);

  if (!sessionsRes.ok) {
    console.log('Response:');
    console.log(sessionsJson ? JSON.stringify(sessionsJson, null, 2) : sessionsRaw);
    console.log('\nResult: TOKEN OK but /sessions failed.');
    process.exit(3);
  }

  const items = Array.isArray(sessionsJson)
    ? sessionsJson
    : sessionsJson?.content ?? sessionsJson?.data ?? sessionsJson?.sessions ?? [];

  console.log(`Sessions returned: ${items.length}`);
  if (items.length > 0) {
    console.log('First session (preview):');
    const s = items[0];
    console.log(JSON.stringify({
      id: s.id,
      name: s.name,
      date: s.date,
      venue: s.venue?.name ?? s.venue,
      event: s.event?.name ?? s.event,
      for_sale: s.for_sale,
      sold_out: s.sold_out,
    }, null, 2));
  }

  console.log('\nResult: VALID — token issued and /sessions returned successfully.');
  process.exit(0);
})();
