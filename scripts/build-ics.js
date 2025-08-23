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

// Múi giờ để đặt báo 8:00 sáng (theo yêu cầu)
const NOTIFY_TZ = process.env.NOTIFY_TZ || 'Asia/Bangkok';

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

    const event = cal.createEvent({
      id: uid,
      uid,
      start: startUtc.toJSDate(),
      end: startUtc.plus({ minutes: 30 }).toJSDate(),
      summary,
      // description: bỏ trống theo yêu cầu
      timezone: 'UTC'
    });

    // Alarm 1: trước sự kiện 30 phút (relative)
    // ical-generator: trigger âm là giây trước event
    event.createAlarm({
      type: 'display',
      trigger: -30 * 60 // -1800s = 30 phút trước
    });

    // Alarm 2: lúc 08:00 sáng (Asia/Bangkok) cùng NGÀY với sự kiện
    const eventLocalDay = startUtc.setZone(NOTIFY_TZ);
    const eightLocal = DateTime.fromObject(
      { year: eventLocalDay.year, month: eventLocalDay.month, day: eventLocalDay.day, hour: 8, minute: 0, second: 0 },
      { zone: NOTIFY_TZ }
    );
    const eightUtc = eightLocal.toUTC(); // chuyển sang UTC để đặt absolute trigger

    // Chỉ tạo nếu 08:00 không invalid
    if (eightUtc.isValid) {
      event.createAlarm({
        type: 'display',
        trigger: eightUtc.toJSDate() // absolute trigger (UTC)
      });
    }
  }

  const icsPath = path.join(OUTPUT_DIR, `forexfactory_${cur.toLowerCase()}.ics`);
  fs.writeFileSync(icsPath, cal.toString(), 'utf8');
  console.log(`📝 Wrote ${icsPath} with ${items.length} events (with 08:00 + -30min alarms)`);
}
