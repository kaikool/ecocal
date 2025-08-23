// scripts/pull-ff-xml.js
import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import { XMLParser } from 'fast-xml-parser';
import iconv from 'iconv-lite';
import slugify from 'slugify';

const TZ = process.env.TZ || 'Asia/Bangkok';
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'out';
const CURRENCIES = (process.env.FF_CURRENCIES || 'USD').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const IMPACTS = (process.env.FF_IMPACTS || 'LOW,MEDIUM,HIGH').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

// Weekly feed chính thức của FF (XML). Có cả CSV/JSON nhưng XML ổn định nhất.
const FEED_URL = process.env.FF_FEED_URL || 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';

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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

(async () => {
  ensureDir(OUTPUT_DIR);

  // 1) Tải XML tuần hiện tại
  console.log('Pulling:', FEED_URL);
  const buf = await fetchArrayBuffer(FEED_URL); // encoding windows-1252
  const xml = iconv.decode(buf, 'windows-1252');

  // 2) Parse XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    parseTagValue: true
  });
  const data = parser.parse(xml);

  // Cấu trúc: <weeklyevents><event>...</event></weeklyevents>
  const events = [].concat(data?.weeklyevents?.event || []);
  console.log('Total raw events:', events.length);

  const out = [];
  for (const ev of events) {
    const currency = String(ev.country || ev.currency || '').toUpperCase();
    if (!currency || !CURRENCIES.includes(currency)) continue;

    const title = String(ev.title || '').trim();
    if (!title) continue;

    const impact = impactNormalize(ev.impact);
    if (impact !== 'UNKNOWN' && !IMPACTS.includes(impact)) continue;

    // XML có date "MM-DD-YYYY" và time "h:mma" hoặc "HH:mm" hoặc "All Day"/"-"
    const dateStr = String(ev.date || '').trim();     // ex: 08-17-2025
    const timeStr = String(ev.time || '').trim();     // ex: 5:15pm

    let start;
    const base = DateTime.fromFormat(dateStr, 'MM-dd-yyyy', { zone: TZ });
    if (!base.isValid) continue;

    if (/all\s*day/i.test(timeStr) || timeStr === '-' || !timeStr) {
      start = base.set({ hour: 0, minute: 0, second: 0 });
    } else {
      let dt = DateTime.fromFormat(`${dateStr} ${timeStr}`, 'MM-dd-yyyy h:mma', { zone: TZ });
      if (!dt.isValid) dt = DateTime.fromFormat(`${dateStr} ${timeStr}`, 'MM-dd-yyyy H:mm', { zone: TZ });
      if (dt.isValid) start = dt;
    }
    if (!start || !start.isValid) continue;

    out.push({
      id: `${start.toISO()}__${currency}__${slugify(title.slice(0,100), { lower: true, strict: true })}`,
      title,
      currency,
      impact,
      startISO: start.toISO(),
      tz: TZ,
      source: 'ff_weekly_xml'
    });
  }

  // sort + dedupe
  out.sort((a,b) => (a.startISO||'').localeCompare(b.startISO||''));
  const seen = new Set();
  const uniq = out.filter(e => {
    const k = `${e.startISO}__${e.currency}__${e.title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const outJson = path.join(OUTPUT_DIR, 'forexfactory.json');
  fs.writeFileSync(outJson, JSON.stringify(uniq, null, 2), 'utf8');
  console.log(`✅ Saved ${uniq.length} filtered events -> ${outJson}`);

  if (uniq.length === 0) {
    console.error('❌ Feed parsed but 0 events after filters. Check FF_CURRENCIES/FF_IMPACTS or rate-limit blocking.');
    process.exit(2);
  }
})();
