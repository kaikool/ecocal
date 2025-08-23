// scripts/build-ics.js
import fs from 'fs';
import path from 'path';
import ical from 'ical-generator';
import { DateTime } from 'luxon';
import slugify from 'slugify';

const OUTPUT_DIR = process.env.OUTPUT_DIR || 'out';
const CURRENCIES = (process.env.FF_CURRENCIES || 'USD')
  .split(',')
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);

// Mode tô màu: 'emoji' (mặc định) hoặc 'split'
const IMPACT_COLOR_MODE = (process.env.IMPACT_COLOR_MODE || 'emoji').toLowerCase();

const dataPath = path.join(OUTPUT_DIR, 'forexfactory.json');
if (!fs.existsSync(dataPath)) {
  console.error('Missing forexfactory.json. Run the feed pull step first.');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
if (!Array.isArray(data) || data.length === 0) {
  console.error('forexfactory.json is empty. Abort ICS build.');
  process.exit(2);
}

// impact -> dots & emoji
function impactDots(impact) {
  switch ((impact || '').toUpperCase()) {
    case 'LOW': return '•';
    case 'MEDIUM': return '••';
    case 'HIGH': return '•••';
    default: return '';
  }
}
function impactEmoji(impact) {
  switch ((impact || '').toUpperCase()) {
    case 'LOW': return '🟢';
    case 'MEDIUM': return '🟡';
    case 'HIGH': return '🔴';
    default: return '';
  }
}
function impactKey(impact) {
  const k = (impact || '').toUpperCase();
  return k === 'LOW' || k === 'MEDIUM' || k === 'HIGH' ? k : 'UNKNOWN';
}
function calendarColorHex(impactKey) {
  // màu VCALENDAR (tham chiếu, một số app có thể bỏ qua)
  switch (impactKey) {
    case 'LOW': return '#16a34a';    // green-600
    case 'MEDIUM': return '#f59e0b'; // amber-500
    case 'HIGH': return '#ef4444';   // red-500
    default: return '#6b7280';       // gray-500
  }
}

// Tạo 1 calendar (UTC) với tùy chọn color ở cấp VCALENDAR
function makeCalendar(name, colorHex) {
  const cal = ical({
    name,
    timezone: 'UTC',
    prodId: { company: 'Forex Factory', product: 'ff-ics', language: 'EN' }
  });
  // iCal RFC 7986 cho phép COLOR ở VCALENDAR; nhiều app có thể bỏ qua, nhưng cứ set:
  cal.color(colorHex);
  return cal;
}

for (const cur of CURRENCIES) {
  const items = data.filter(x => (x.currency || '').toUpperCase() === cur);

  if (IMPACT_COLOR_MODE === 'split') {
    // TÁCH 3 CALENDAR THEO IMPACT
    const buckets = { LOW: [], MEDIUM: [], HIGH: [] };
    for (const ev of items) {
      const key = impactKey(ev.impact);
      if (key === 'LOW' || key === 'MEDIUM' || key === 'HIGH') {
        buckets[key].push(ev);
      }
    }

    for (const key of ['LOW', 'MEDIUM', 'HIGH']) {
      const cal = makeCalendar(`Forex Factory ${cur} — ${key}`, calendarColorHex(key));
      for (const ev of buckets[key]) {
        const startUtc = DateTime.fromISO(ev.startISO, { setZone: true }).toUTC();
        if (!startUtc.isValid) continue;
        const uid = `${startUtc.toISO()}__${cur}__${slugify(ev.title || '', { lower: true, strict: true })}@ecocal`;
        const dots = impactDots(ev.impact);
        const emoji = impactEmoji(ev.impact);

        cal.createEvent({
          id: uid,
          uid,
          start: startUtc.toJSDate(),
          end: startUtc.plus({ minutes: 30 }).toJSDate(),
          summary: ev.title || '', // KHÔNG thêm tiền tố/hậu tố
          description: `${dots ? `Impact: ${dots}` : ''}${emoji ? (dots ? ` ${emoji}` : `Impact: ${emoji}`) : ''}\nSource: Forex Factory`,
          timezone: 'UTC',
          categories: [key] // nhãn impact
        });
      }

      const suffix = key.toLowerCase();
      const icsPath = path.join(OUTPUT_DIR, `forexfactory_${cur.toLowerCase()}_${suffix}.ics`);
      fs.writeFileSync(icsPath, cal.toString(), 'utf8');
      console.log(`📝 Wrote ${icsPath} with ${buckets[key].length} events (UTC, calendar color ${key})`);
    }
  } else {
    // MỘT CALENDAR DUY NHẤT, THÊM EMOJI Ở DESCRIPTION
    const cal = makeCalendar(`Forex Factory ${cur}`, '#2563eb'); // blue-600 (tùy)
    for (const ev of items) {
      const startUtc = DateTime.fromISO(ev.startISO, { setZone: true }).toUTC();
      if (!startUtc.isValid) continue;

      const uid = `${startUtc.toISO()}__${cur}__${slugify(ev.title || '', { lower: true, strict: true })}@ecocal`;
      const dots = impactDots(ev.impact);
      const emoji = impactEmoji(ev.impact);

      cal.createEvent({
        id: uid,
        uid,
        start: startUtc.toJSDate(),
        end: startUtc.plus({ minutes: 30 }).toJSDate(),
        summary: ev.title || '', // KHÔNG thêm tiền tố/hậu tố
        description: `${dots ? `Impact: ${dots}` : ''}${emoji ? (dots ? ` ${emoji}` : `Impact: ${emoji}`) : ''}\nSource: Forex Factory`,
        timezone: 'UTC',
        categories: [impactKey(ev.impact)] // để client nào hỗ trợ có thể filter
      });
    }

    const icsPath = path.join(OUTPUT_DIR, `forexfactory_${cur.toLowerCase()}.ics`);
    fs.writeFileSync(icsPath, cal.toString(), 'utf8');
    console.log(`📝 Wrote ${icsPath} with ${items.length} events (UTC, emoji in description)`);
  }
}
