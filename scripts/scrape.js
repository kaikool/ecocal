// scripts/scrape.js
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import slugify from 'slugify';

const TZ = process.env.TZ || 'Asia/Bangkok';
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'out';
const CURRENCIES = (process.env.FF_CURRENCIES || 'USD')
  .split(',')
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);
const IMPACTS = (process.env.FF_IMPACTS || 'LOW,MEDIUM,HIGH')
  .split(',')
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);
const MONTHS_AHEAD = parseInt(process.env.FF_MONTHS_AHEAD || '1', 10);

// Flags giúp Playwright “đỡ lộ”
const FLAGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--lang=en-US,en;q=0.9'
];

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
  return [...m.values()];
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

async function humanize(page) {
  await page.mouse.move(100 + Math.random() * 300, 100 + Math.random() * 200);
  await page.waitForTimeout(500 + Math.floor(Math.random() * 500));
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 500 + Math.floor(Math.random() * 400));
    await page.waitForTimeout(400 + Math.floor(Math.random() * 500));
  }
}

async function tryDismissBanners(page) {
  const candidates = [
    'button:has-text("Accept")',
    'button:has-text("I Accept")',
    'button:has-text("Agree")',
    'button:has-text("Got it")',
    'text=Accept all',
    '[aria-label*="accept"]',
    '[data-testid*="accept"]',
  ];
  for (const sel of candidates) {
    const el = await page.$(sel);
    if (el) { try { await el.click({ timeout: 800 }); } catch {} }
  }
}

async function gotoSafe(page, url) {
  for (let a = 1; a <= 3; a++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await tryDismissBanners(page);
      await humanize(page);
      // KHÔNG chờ selector nào nữa
      return true;
    } catch (e) {
      console.warn(`goto attempt ${a} failed: ${e.message}`);
      await page.waitForTimeout(1000 * a + Math.floor(Math.random() * 500));
    }
  }
  return false;
}

// Parser lỏng — dựa trên văn bản, ít phụ thuộc class
async function extractLooseByText(page, params) {
  return await page.evaluate((ctx) => {
    const out = [];
    let currentDate = null;

    const months = {
      january:1,february:2,march:3,april:4,may:5,june:6,
      july:7,august:8,september:9,october:10,november:11,december:12
    };
    const isDayHeaderText = (txt) =>
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(txt) &&
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(txt);

    const blocks = Array.from(document.querySelectorAll('table tr, section, article, div, li'));
    for (const el of blocks) {
      const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!raw) continue;

      // cập nhật ngày
      if (isDayHeaderText(raw)) {
        const m = raw.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b\s+([A-Za-z]+)\s+(\d{1,2})/i);
        if (m) {
          const mm = months[m[2].toLowerCase()];
          const dd = parseInt(m[3], 10);
          if (mm) currentDate = new Date(Date.UTC(parseInt(ctx.year, 10), mm - 1, dd, 0, 0, 0));
        }
        continue;
      }
      if (!currentDate) continue;

      // time: 8:30am | 14:00 | All Day | -
      const timeMatch = raw.match(/\b(\d{1,2}:\d{2}\s*[ap]m|\d{1,2}:\d{2}|All Day|-)\b/i);
      // currency: 3 ký tự hoa (USD, EUR, GBP,...)
      const curMatch = raw.match(/\b([A-Z]{3})\b/);

      if (timeMatch && curMatch) {
        let timeStr = timeMatch[0];
        let currency = curMatch[1];

        // Tách title thô bằng cách cắt bỏ time và currency đầu tiên
        let title = raw.replace(timeStr, '').replace(currency, '').trim();
        const cutIdx = title.search(/\b(Previous|Forecast|Actual|Detail|Source)\b/i);
        if (cutIdx > 0) title = title.slice(0, cutIdx).trim();
        if (!title || title.length < 3) continue;

        out.push({
          currency,
          title,
          impactRaw: '',
          timeStr,
          dateISO: new Date(currentDate.getTime()).toISOString()
        });
      }
    }
    return out;
  }, { year: params.year, tz: params.tz });
}

(async () => {
  ensureDir(OUTPUT_DIR);

  const browser = await chromium.launch({ headless: true, args: FLAGS });
  const context = await browser.newContext({
    timezoneId: TZ,
    locale: 'en-US',
    viewport: { width: 1366, height: 900 },
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${Math.floor(120 + Math.random() * 5)}.0.0.0 Safari/537.36`,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1'
    }
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  });

  const page = await context.newPage();

  const months = monthList();
  let all = [];

  for (const m of months) {
    const url = `https://www.forexfactory.com/calendar?month=${m.y}-${m.m}`;
    console.log('⏩ Go', url);
    const ok = await gotoSafe(page, url);
    if (!ok) {
      console.warn(`Skip ${m.y}-${m.m} due to navigation issues.`);
      continue;
    }

    // cuộn thêm để chắc chắn render hết
    await humanize(page);

    const raw = await extractLooseByText(page, { year: m.y, tz: TZ });
    console.log(`Parsed (loose) ${raw.length} rows for ${m.y}-${m.m}`);

    if (!raw || raw.length === 0) {
      const html = await page.content();
      console.log('---- PAGE HTML (first 1000 chars) ----');
      console.log(html.slice(0, 1000));
      console.log('--------------------------------------');
    }

    for (const r of raw) {
      const currency = (r.currency || '').toUpperCase();
      if (!CURRENCIES.includes(currency)) continue;

      const impact = impactNormalize(r.impactRaw || '');
      if (impact !== 'UNKNOWN' && !IMPACTS.includes(impact)) continue;

      const base = DateTime.fromISO(r.dateISO, { zone: 'UTC' }).setZone(TZ);
      let start;
      if (/all\s*day/i.test(r.timeStr) || r.timeStr === '-' || !r.timeStr) {
        start = base.set({ hour: 0, minute: 0, second: 0 });
      } else {
        let dt = DateTime.fromFormat(`${base.toFormat('yyyy-LL-dd')} ${r.timeStr}`, 'yyyy-LL-dd h:mma', { zone: TZ });
        if (!dt.isValid) dt = DateTime.fromFormat(`${base.toFormat('yyyy-LL-dd')} ${r.timeStr}`, 'yyyy-LL-dd H:mm', { zone: TZ });
        if (dt.isValid) start = dt;
      }
      if (!start || !start.isValid) continue;

      all.push({
        id: `${start.toISO()}__${currency}__${slugify((r.title || '').slice(0, 100), { lower: true, strict: true })}`,
        title: r.title || '',
        currency,
        impact,
        startISO: start.toISO(),
        tz: TZ,
        year: m.y,
        month: m.m
      });
    }

    await page.waitForTimeout(1000 + Math.floor(Math.random() * 1000));
  }

  const uniq = dedupeByKey(all, x => `${x.startISO}__${x.currency}__${x.title}`);
  uniq.sort((a, b) => (a.startISO || '').localeCompare(b.startISO));

  ensureDir(OUTPUT_DIR);
  const outJson = path.join(OUTPUT_DIR, 'forexfactory.json');
  fs.writeFileSync(outJson, JSON.stringify(uniq, null, 2), 'utf8');
  console.log(`✅ Saved ${uniq.length} events -> ${outJson}`);

  if (uniq.length === 0) {
    console.error('❌ No events parsed. Failing the job to avoid publishing empty ICS.');
    await browser.close();
    process.exit(2);
  }

  await browser.close();
  process.exit(0);
})();
