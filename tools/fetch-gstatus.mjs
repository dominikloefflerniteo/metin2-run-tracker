/**
 * Holt g-status.com und schreibt die Channel-Zeiten in die Supabase-Tabelle
 * `channels`.
 *
 * Warum ueberhaupt ein Skript: g-status schickt keinen CORS-Header, eine
 * statische Seite auf GitHub Pages kann die Seite also nicht selbst laden.
 * Dieses Skript laeuft deshalb im GitHub-Actions-Cron (stuendlich) —
 * oft genug, denn die Werte aendern sich nur bei einem Serverneustart.
 *
 * Aufruf:
 *   SUPABASE_URL=... SUPABASE_KEY=... node tools/fetch-gstatus.mjs
 *   node tools/fetch-gstatus.mjs --dry     (nur anzeigen, nichts schreiben)
 *
 * Der Parser entspricht metin2-mob-alert/gstatus.py.
 */

const URL_GSTATUS = 'https://www.g-status.com/en-gb/game/metin2';

const SERVERS = [
  '[RUBY] Chimera',
  'Germania',
  'Teutonia',
  'Europe',
  'Iberia',
  'Tigerghost'
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120 Safari/537.36';

const TS_RE = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/;

async function fetchHtml() {
  const res = await fetch(URL_GSTATUS, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' }
  });
  if (!res.ok) throw new Error('g-status HTTP ' + res.status);
  return res.text();
}

/** Alle Server/Channels der Seite als flache Liste. */
function parse(html) {
  const out = [];
  for (const block of html.split('server_wrap')) {
    const nameMatch = /server_name">([^<]+)<\/div>/.exec(block);
    if (!nameMatch) continue;
    const full = nameMatch[1].trim();

    const chMatch = /Channel\s*(\d+)/i.exec(full);
    if (!chMatch) continue;                       // Login-Zeilen interessieren nicht

    // "Germania - Channel 3" -> "Germania"
    const server = full.replace(/\s*[-–]\s*Channel\s*\d+.*$/i, '').trim();
    if (!SERVERS.includes(server)) continue;

    const status = block.includes('status online') ? 'online'
                 : block.includes('status offline') ? 'offline'
                 : 'unknown';

    const off = /last_offline_date[^>]*>([\s\S]*?)<\/div>/.exec(block);
    const ts = off ? TS_RE.exec(off[1]) : null;

    out.push({
      server,
      channel: 'CH' + chMatch[1],
      status,
      // Serverzeit als Text — bewusst nicht in eine Zeitzone gezwungen,
      // siehe Kommentar in sql/schema.sql.
      last_restart: ts ? ts[0] : null,
      fetched_at: new Date().toISOString()
    });
  }
  return out;
}

async function upsert(rows, url, key) {
  const res = await fetch(url.replace(/\/+$/, '') + '/rest/v1/channels?on_conflict=server,channel', {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error('Supabase HTTP ' + res.status + ': ' + (await res.text()));
}

const dry = process.argv.includes('--dry');
const rows = parse(await fetchHtml());

if (!rows.length) {
  console.error('Keine Channels erkannt — hat g-status sein HTML geändert?');
  process.exit(1);
}

const servers = [...new Set(rows.map(r => r.server))];
console.log(`${rows.length} Channels auf ${servers.length} Servern: ${servers.join(', ')}`);
for (const r of rows.filter(r => !r.last_restart)) {
  console.log(`  ohne Neustart-Zeit: ${r.server} ${r.channel} (${r.status})`);
}

if (dry) {
  // kein process.exit hier: Node auf Windows wirft dann eine libuv-Assertion,
  // weil console.table noch schreibt.
  console.table(rows);
} else {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL und SUPABASE_KEY fehlen.');
    process.exitCode = 1;
  } else {
    await upsert(rows, url, key);
    console.log('geschrieben.');
  }
}
