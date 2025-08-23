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

// Đọc dữ liệu đã chuẩn hoá từ pull-ff-xml (hoặc scraper)
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

for (const cur of CURRENCIES) {
  // Lịch đặt timezone = UTC để client tự chuyển về local (GMT+7 hay gì khác)
  const cal = ical({
    name: `ForexFactory ${cur}`,
    timezone: 'UTC',         // <- Quan trọng: dùng UTC
    prodId: { company: 'ecocal', product: 'ff-ics', language: 'EN' }
  });

  const items = data.filter(x => (x.currency || '').toUpperCase() === cur);
  for (const ev of items) {
    // Ép mốc thời gian về UTC
    const startUtc = DateTime.fromISO(ev.startISO, { setZone: true }).toUTC(); // giữ nguyên instant, convert sang UTC

    if (!startUtc.isValid) continue;
    const uid = `${startUtc.toISO()}__${cur}__${slugify(ev.title || '', { lower: true, strict: true })}@ecocal`;

    cal.createEvent({
      id: uid,
      uid,
      start: startUtc.toJSDate(),
      end: startUtc.plus({ minutes: 30 }).toJSDate(),
      summary: `[${cur}] ${ev.title}${ev.impact && ev.impact !== 'UNKNOWN' ? ' (' + ev.impact + ')' : ''}`,
      description: `Source: ${ev.source || 'ForexFactory'}\nTime base: UTC\nOriginal TZ: ${ev.tz || 'unknown'}`,
      timezone: 'UTC'
    });
  }

  const icsPath = path.join(OUTPUT_DIR, `forexfactory_${cur.toLowerCase()}.ics`);
  fs.writeFileSync(icsPath, cal.toString(), 'utf8');
  console.log(`📝 Wrote ${icsPath} with ${items.length} events (UTC)`);
}
