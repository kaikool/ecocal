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

for (const cur of CURRENCIES) {
  const cal = ical({
    name: `Forex Factory ${cur}`,
    timezone: 'UTC',
    prodId: { company: 'Forex Factory', product: 'ff-ics', language: 'EN' }
  });

  const items = data.filter(x => (x.currency || '').toUpperCase() === cur);

  for (const ev of items) {
    const startUtc = DateTime.fromISO(ev.startISO, { setZone: true }).toUTC();
    if (!startUtc.isValid) continue;

    const uid = `${startUtc.toISO()}__${cur}__${slugify(ev.title || '', { lower: true, strict: true })}@ecocal`;
    const dots = impactDots(ev.impact);
    const summary = `${dots ? dots + ' ' : ''}${ev.title || ''}`.trim(); // chấm tròn TRƯỚC tên

    cal.createEvent({
      id: uid,
      uid,
      start: startUtc.toJSDate(),
      end: startUtc.plus({ minutes: 30 }).toJSDate(),
      summary,         // chỉ tiêu đề
      // description: bỏ trống
      timezone: 'UTC'
    });
  }

  const icsPath = path.join(OUTPUT_DIR, `forexfactory_${cur.toLowerCase()}.ics`);
  fs.writeFileSync(icsPath, cal.toString(), 'utf8');
  console.log(`📝 Wrote ${icsPath} with ${items.length} events`);
}
