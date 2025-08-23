// scripts/build-ics.js
import fs from 'fs';
import path from 'path';
import ical from 'ical-generator';
import { DateTime } from 'luxon';
import slugify from 'slugify';

const TZ = process.env.TZ || 'Asia/Bangkok';
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'out';
const CURRENCIES = (process.env.FF_CURRENCIES || 'USD').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

const dataPath = path.join(OUTPUT_DIR, 'forexfactory.json');
if (!fs.existsSync(dataPath)) {
  console.error('Missing forexfactory.json. Run scrape first.');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

ensureDir(OUTPUT_DIR);

for (const cur of CURRENCIES) {
  const cal = ical({ name: `ForexFactory ${cur}`, timezone: TZ });
  const items = data.filter(x => x.currency === cur);

  for (const ev of items) {
    const start = DateTime.fromISO(ev.startISO).setZone(TZ);
    if (!start.isValid) continue;
    const uid = `${start.toISO()}__${cur}__${slugify(ev.title, { lower: true, strict: true })}@ecocal`;

    cal.createEvent({
      id: uid,
      uid,
      start: start.toJSDate(),
      end: start.plus({ minutes: 30 }).toJSDate(),
      summary: `[${cur}] ${ev.title}${ev.impact && ev.impact !== 'UNKNOWN' ? ' ('+ev.impact+')' : ''}`,
      description: `Source: ForexFactory\nTZ: ${TZ}\nImpact: ${ev.impact || 'UNKNOWN'}`,
      timezone: TZ
    });
  }

  const icsPath = path.join(OUTPUT_DIR, `forexfactory_${cur.toLowerCase()}.ics`);
  fs.writeFileSync(icsPath, cal.toString(), 'utf8');
  console.log('Wrote', icsPath);
}
