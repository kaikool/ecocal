// scripts/build-ics.js
import fs from 'fs';
import path from 'path';
import ical from 'ical-generator';
import { DateTime } from 'luxon';
import slugify from 'slugify';

const OUTPUT_DIR = process.env.OUTPUT_DIR || 'out';
const CURRENCIES = (process.env.FF_CURRENCIES || 'USD').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const IMPACT_COLOR_MODE = (process.env.IMPACT_COLOR_MODE || 'emoji').toLowerCase(); // vẫn cho phép split nếu bạn dùng

const dataPath = path.join(OUTPUT_DIR, 'forexfactory.json');
if (!fs.existsSync(dataPath)) { console.error('Missing forexfactory.json.'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
if (!Array.isArray(data) || data.length === 0) { console.error('Empty data.'); process.exit(2); }

function impactDots(impact) {
  switch ((impact || '').toUpperCase()) {
    case 'LOW': return '•';
    case 'MEDIUM': return '••';
    case 'HIGH': return '•••';
    default: return '';
  }
}
function impactKey(impact) {
  const k = (impact || '').toUpperCase();
  return k === 'LOW' || k === 'MEDIUM' || k === 'HIGH' ? k : 'UNKNOWN';
}
function calendarColorHex(k) {
  switch (k) {
    case 'LOW': return '#16a34a'; case 'MEDIUM': return '#f59e0b'; case 'HIGH': return '#ef4444';
    default: return '#6b7280';
  }
}
function injectCalendarColor(icsString, colorHex) {
  if (!colorHex) return icsString;
  const lines = icsString.split(/\r?\n/);
  const idx = lines.findIndex(l => l.trim() === 'BEGIN:VCALENDAR');
  if (idx !== -1) lines.splice(idx + 1, 0, `COLOR:${colorHex}`, `X-APPLE-CALENDAR-COLOR:${colorHex}`);
  return lines.join('\n');
}
function makeCalendar(name) {
  return ical({ name, timezone: 'UTC', prodId: { company: 'Forex Factory', product: 'ff-ics', language: 'EN' } });
}

for (const cur of CURRENCIES) {
  const items = data.filter(x => (x.currency || '').toUpperCase() === cur);

  if (IMPACT_COLOR_MODE === 'split') {
    const buckets = { LOW: [], MEDIUM: [], HIGH: [] };
    for (const ev of items) {
      const key = impactKey(ev.impact);
      if (key in buckets) buckets[key].push(ev);
    }
    for (const key of ['LOW', 'MEDIUM', 'HIGH']) {
      const cal = makeCalendar(`Forex Factory ${cur} — ${key}`);
      for (const ev of buckets[key]) {
        const startUtc = DateTime.fromISO(ev.startISO, { setZone: true }).toUTC();
        if (!startUtc.isValid) continue;
        const uid = `${startUtc.toISO()}__${cur}__${slugify(ev.title || '', { lower: true, strict: true })}@ecocal`;
        const dots = impactDots(ev.impact);
        const summary = `${dots ? dots + ' ' : ''}${ev.title || ''}`.trim(); // chấm tròn TRƯỚC tên

        cal.createEvent({
          id: uid, uid,
          start: startUtc.toJSDate(),
          end: startUtc.plus({ minutes: 30 }).toJSDate(),
          summary,
          timezone: 'UTC',
          categories: [key] // không có description
        });
      }
      const icsRaw = cal.toString();
      const icsWithColor = injectCalendarColor(icsRaw, calendarColorHex(key));
      const icsPath = path.join(OUTPUT_DIR, `forexfactory_${cur.toLowerCase()}_${key.toLowerCase()}.ics`);
      fs.writeFileSync(icsPath, icsWithColor, 'utf8');
      console.log(`📝 Wrote ${icsPath} with ${buckets[key].length} events`);
    }
  } else {
    const cal = makeCalendar(`Forex Factory ${cur}`);
    for (const ev of items) {
      const startUtc = DateTime.fromISO(ev.startISO, { setZone: true }).toUTC();
      if (!startUtc.isValid) continue;
      const uid = `${startUtc.toISO()}__${cur}__${slugify(ev.title || '', { lower: true, strict: true })}@ecocal`;
      const dots = impactDots(ev.impact);
      const summary = `${dots ? dots + ' ' : ''}${ev.title || ''}`.trim();

      cal.createEvent({
        id: uid, uid,
        start: startUtc.toJSDate(),
        end: startUtc.plus({ minutes: 30 }).toJSDate(),
        summary,
        timezone: 'UTC',
        categories: [impactKey(ev.impact)]
        // description: bỏ trống theo yêu cầu
      });
    }
    const icsPath = path.join(OUTPUT_DIR, `forexfactory_${cur.toLowerCase()}.ics`);
    fs.writeFileSync(icsPath, cal.toString(), 'utf8');
    console.log(`📝 Wrote ${icsPath} with ${items.length} events`);
  }
}
