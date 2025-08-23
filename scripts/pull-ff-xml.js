// scripts/pull-ff-xml.js
import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import { XMLParser } from 'fast-xml-parser';
import iconv from 'iconv-lite';
import slugify from 'slugify';

const OUTPUT_DIR = process.env.OUTPUT_DIR || 'out';
const CURRENCIES = (process.env.FF_CURRENCIES || 'USD').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const IMPACTS = (process.env.FF_IMPACTS || 'LOW,MEDIUM,HIGH').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const FEED_URL = process.env.FF_FEED_URL || 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
// 👉 Quan trọng: múi giờ của FEED (nếu thấy lệch 7h, đặt FEED_TZ=Asia/Bangkok)
const FEED_TZ = process.env.FEED_TZ || 'UTC';

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function impactNormalize(s) {
  const t = String(s || '').toLowerCase();
  if (t.includes('high')) return 'HIGH';
  if (t.includes('medium') || t.includes('med')) return 'MEDIUM';
  if (t.includes('low')) return 'LOW';
  return 'UNKNOWN';
}
async function fetchArrayBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

(async () => {
  ensureDir(OUTPUT_DIR);

  console.log('Pulling:', FEED_URL);
  const buf = await fetchArrayBuffer(FEED_URL);
  const xml = iconv.decode(buf, 'windows-1252');

  const parser = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true, parseTagValue: true
  });
  const data = parser.parse(xml);

  const events = [].concat(data?.weeklyevents?.event || []);
  console.log('Total raw events from feed:', events.length, '| FEED_TZ =', FEED_TZ);

  const out = [];
  for (const ev of events) {
    const currency = String(ev.country || ev.currency || '').toUpperCase();
    if (!currency || !CURRENCIES.includes(currency)) continue;
    const title = String(ev.title || '').trim();
    if (!title) continue;

    const impact = impactNormalize(ev.impact);
    if (impact !== 'UNKNOWN' && !IMPACTS.includes(impact)) continue;

    const dateStr = String(ev.date || '').trim();  // ex: 08-23-2025
    const timeStr = String(ev.time || '').trim();  // ex: 5:15pm | 14:00 | All Day | -

    // Parse THEO FEED_TZ
    const base = DateTime.fromFormat(dateStr, 'MM-dd-yyyy', { zone: FEED_TZ });
    if (!base.isValid) continue;

    let startLocal;
    if (/all\s*day/i.test(timeStr) || timeStr === '-' || timeStr === '') {
      startLocal = base.set({ hour: 0, minute: 0, second: 0 });
    } else {
      let dt = DateTime.fromFormat(`${dateStr} ${timeStr}`, 'MM-dd-yyyy h:mma', { zone: FEED_TZ });
      if (!dt.isValid) dt = DateTime.fromFormat(`${dateStr} ${timeStr}`, 'MM-dd-yyyy H:mm', { zone: FEED_TZ });
      if (dt.isValid) startLocal = dt;
    }
    if (!startLocal || !startLocal.isValid) continue;

    // Chuẩn hoá về UTC để downstream đồng nhất
    const startUtc = startLocal.toUTC();

    out.push({
      id: `${startUtc.toISO()}__${currency}__${slugify(title.slice(0,100), { lower: true, strict: true })}`,
      title,
      currency,
      impact,
      startISO: startUtc.toISO(), // UTC ISO
      tz: 'UTC',
      source: 'ff_weekly_xml'
    });
  }

  out.sort((a,b) => (a.startISO||'').localeCompare(b.startISO||''));
  const seen = new Set();
  const uniq = out.filter(e => {
    const k = `${e.startISO}__${e.currency}__${e.title}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });

  const outJson = path.join(OUTPUT_DIR, 'forexfactory.json');
  fs.writeFileSync(outJson, JSON.stringify(uniq, null, 2), 'utf8');
  console.log(`✅ Saved ${uniq.length} filtered events (normalized to UTC) -> ${outJson}`);
  if (uniq.length === 0) { console.error('❌ 0 events after filters.'); process.exit(2); }
})();
