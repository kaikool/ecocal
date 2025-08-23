// scripts/scrape.js
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import slugify from 'slugify';

const TZ = process.env.TZ || 'Asia/Bangkok';
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'out';
const CURRENCIES = (process.env.FF_CURRENCIES || 'USD').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const IMPACTS = (process.env.FF_IMPACTS || 'LOW,MEDIUM,HIGH').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const MONTHS_AHEAD = parseInt(process.env.FF_MONTHS_AHEAD || '1', 10);

const HEADLESS_FLAGS = (process.env.FLAGS || '--no-sandbox --disable-dev-shm-usage').split(' ');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function impactNormalize(s) {
  const t = (s || '').toLowerCase();
  if (t.includes('high')) return 'HIGH';
  if (t.includes('medium') || t.includes('med')) return 'MEDIUM';
  if (t.includes('low')) return 'LOW';
  return 'UNKNOWN';
}

function dedupeByKey(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, x);
  }
  return Array.from(m.values());
}

function monthList() {
  const now = DateTime.now().setZone(TZ).startOf('month');
  const list = [];
  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    const d = now.plus({ months: i });
    list.push({ y: d.year, m: String(d.month).padStart(2, '0') });
  }
  return list;
}

async function scrapeMonth(page, year, mm) {
  const url = `https://www.forexfactory.com/calendar?month=${year}-${mm}`;
  console.log('Go:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1500 + Math.floor(Math.random() * 1500)); // “giống người”

  // Đặt timezone & locale trong context đã set ở launch; page content hiển thị theo TZ
  // Lấy toàn bộ rows. DOM FF có thể thay đổi, ta bắt “rộng” rồi lọc.
  const rows = await page.$$('[class*="calendar"], table tr, div[class*="row"]');

  const items = [];
  let currentDate = null;

  for (const row of rows) {
    const text = (await row.innerText().catch(() => '')) || '';
    const lowText = text.toLowerCase();

    // Cập nhật ngày khi gặp header kiểu "Monday August 18"
    if (/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(text) &&
        /(january|february|march|april|may|june|july|august|september|october|november|december)/i.test(text)) {
      // Tách ngày từ chuỗi
      const dt = DateTime.fromFormat(text.trim(), 'cccc LLLL d', { zone: TZ });
      if (dt.isValid) currentDate = dt.set({ year: parseInt(year, 10) });
      continue;
    }

    // Thử tìm cột thời gian + currency + impact + title
    // Cách bắt linh hoạt: tìm bởi selector phổ biến trước
    const timeSel = await row.$('td.time, [class*="time"]');
    const curSel  = await row.$('td.currency, [class*="currency"]');
    const impSel  = await row.$('td.impact [title], td.impact img[title], [class*="impact"] [title], [class*="impact"] img[title]');
    const titleSel= await row.$('td.event a, td.event, [class*="event"] a, [class*="event"]');

    if (!timeSel || !curSel || !titleSel) continue;

    const timeStr = ((await timeSel.innerText().catch(()=>'')) || '').trim();          // ví dụ "8:30am"
    const currency= ((await curSel.innerText().catch(()=>'')) || '').trim().toUpperCase();
    let impact    = ((await impSel?.getAttribute('title').catch(()=>null)) || '').trim();
    const title   = ((await titleSel.innerText().catch(()=>'')) || '').trim();

    if (!title || !currency) continue;

    impact = impactNormalize(impact);

    // Lọc theo currency/impact
    if (!CURRENCIES.includes(currency)) continue;
    if (impact !== 'UNKNOWN' && !IMPACTS.includes(impact)) continue;

    // Xác định ngày giờ: nếu currentDate null, fallback: lấy từ URL (đầu tháng), nhưng cố gắng bám theo currentDate
    let start = null;
    if (currentDate && timeStr) {
      // Các format có thể như "All Day", "-", "8:30am", "14:00"
      if (/all\s*day/i.test(timeStr) || timeStr === '-' || timeStr === '') {
        start = currentDate.set({ hour: 0, minute: 0, second: 0 });
      } else {
        // Thử 12h, rồi 24h
        let dt = DateTime.fromFormat(`${currentDate.toFormat('yyyy-LL-dd')} ${timeStr}`, 'yyyy-LL-dd h:mma', { zone: TZ });
        if (!dt.isValid) {
          dt = DateTime.fromFormat(`${currentDate.toFormat('yyyy-LL-dd')} ${timeStr}`, 'yyyy-LL-dd H:mm', { zone: TZ });
        }
        if (dt.isValid) start = dt;
      }
    }

    // Nếu vẫn không parse được time, bỏ qua cho sạch
    if (!start) continue;

    // Build record
    const id = `${start.toISO()}__${currency}__${slugify(title, { lower: true, strict: true })}`;
    const rec = {
      id,
      title,
      currency,
      impact,
      startISO: start.toISO(),   // TZ Asia/Bangkok
      tz: TZ,
      source: 'forexfactory',
      year,
      month: mm
    };
    items.push(rec);
  }

  return items;
}

(async () => {
  ensureDir(OUTPUT_DIR);
  const browser = await chromium.launch({ headless: true, args: HEADLESS_FLAGS });
  const context = await browser.newContext({
    timezoneId: TZ,
    locale: 'en-US',
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${Math.floor(120+Math.random()*5)}.0.0.0 Safari/537.36`
  });
  const page = await context.newPage();

  const months = monthList();
  let all = [];
  for (const m of months) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const part = await scrapeMonth(page, m.y, m.m);
        all = all.concat(part);
        break;
      } catch (e) {
        console.warn(`Month ${m.y}-${m.m} attempt ${attempt} failed:`, e.message);
        await page.waitForTimeout(1000 * attempt + Math.floor(Math.random()*500));
        if (attempt === 3) console.error('Give up this month.');
      }
    }
    await page.waitForTimeout(1200 + Math.floor(Math.random() * 1200));
  }

  // dedupe theo (startISO + currency + title)
  const uniq = dedupeByKey(all, x => `${x.startISO}__${x.currency}__${x.title}`);
  // sort
  uniq.sort((a,b) => (a.startISO || '').localeCompare(b.startISO));

  const outJson = path.join(OUTPUT_DIR, 'forexfactory.json');
  fs.writeFileSync(outJson, JSON.stringify(uniq, null, 2), 'utf8');

  console.log(`Saved ${uniq.length} events -> ${outJson}`);
  await browser.close();
  process.exit(0);
})();
