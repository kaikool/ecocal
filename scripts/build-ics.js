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

// Đọc dữ liệu JSON đã chuẩn hóa
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

// map impact -> dot notation
function impactDots(impact) {
  switch ((impact || '').toUpperCase()) {
    case 'LOW': return '•';
    case 'MEDIUM': return '••';
    case 'HIGH': return '•••';
    default: return '';
  }
}

for (const cur of CURRENCIES) {
  // Calendar ở UTC
  const cal = ical({
    name: `ForexFactory ${cur}`,
    timezone: 'UTC',
    prodId: { company: 'Forex Factory', product: 'ff-ics', language: 'EN' }
  });

  const items = data.filter(x => (x.currency || '').toUpperCase() === cur);
  for (const ev of items) {
    const startUtc = DateTime.fromISO(ev.startISO, { setZone: true }).toUTC();
    if (!startUtc.isValid) continue;

    const uid = `${startUtc.toISO()}__${cur}__${slugify(ev.title || '', { lower: true, strict: true })}@ecocal`;

    // Summary: chỉ tên sự kiện, không prefix/suffix
    const summary = ev.title || '';

    // Description: chấm tròn + Impact + Source
    const dots = impactDots(ev.impact);
    const desc = `${dots ? `Impact: ${dots}\n` : ''}Source: Forex Factory`;

    cal.createEvent({
      id: uid,
      uid,
      start: startUtc.toJSDate(),
      end: startUtc.plus({ minutes: 30 }).toJSDate(),
      summary,
      description: desc,
      timezone: 'UTC'
    });
  }

  const icsPath = path.join(OUTPUT_DIR, `forexfactory_${cur.toLowerCase()}.ics`);
  fs.writeFileSync(icsPath, cal.toString(), 'utf8');
  console.log(`📝 Wrote ${icsPath} with ${items.length} events (UTC, simplified summary)`);
}
