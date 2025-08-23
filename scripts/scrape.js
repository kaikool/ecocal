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
const FLAGS = (process.env.FLAGS || '--no-sandbox --disable-dev-shm-usage').split(' ');

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

async function gotoSafe(page, url) {
  for (let a = 1; a <= 3; a++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1500 + Math.floor(Math.random() * 1500));
      await Promise.race([
        page.waitForSelector('[class*="calendar"] table, table[class*="calendar"]', { timeout: 8000 }),
        page.waitForSelector('[class*="calendar__row"]', { timeout: 8000 }),
        page.waitForSelector('td.currency, td.event, [class*="currency"], [class*="event"]', { timeout: 8000 })
      ]);
      return;
    } catch (e) {
      console.warn(`goto attempt ${a} failed: ${e.message}`);
      if (a === 3) throw e;
      await page.waitForTimeout(1000 * a + Math.floor(Math.random() * 500));
    }
  }
}

// Chiến lược 1: DOM theo class phổ biến của FF
async function extractByKnownClasses(page, params) {
  // params = { year: 2025, tz: "Asia/Bangkok" }
  return await page.evaluate((ctx) => {
    const out = [];
    const toIso = (d) => d.toISOString();
    let currentDate = null;

    const rows = Array.from(document.querySelectorAll('tr, div'));
    const isDayHeader = (el) => {
      const txt = (el.textContent || '').trim();
      return /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(txt) &&
             /(january|february|march|april|may|june|july|august|september|october|november|december)/i.test(txt);
    };

    for (const row of rows) {
      // Cập nhật ngày khi gặp header kiểu "Monday August 18"
      if (isDayHeader(row)) {
        const txt = (row.textContent || '').replace(/\s+/g,' ').trim();
        const m = txt.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+([a-z]+)\s+(\d{1,2})/i);
        if (m) {
          const monthName = m[2];
          const dayNum = parseInt(m[3],10);
          const months = {
            january:1,february:2,march:3,april:4,may:5,june:6,
            july:7,august:8,september:9,october:10,november:11,december:12
          };
          const mm = months[monthName.toLowerCase()];
          if (mm) {
            currentDate = new Date(Date.UTC(parseInt(ctx.year,10), mm-1, dayNum, 0,0,0));
          }
        }
        continue;
      }

      // Các cột thường gặp
      const timeEl = row.querySelector('td.time, [class*="cell"][class*="time"], [class*="time"]');
      const curEl  = row.querySelector('td.currency, [class*="cell"][class*="currency"], [class*="currency"]');
      const evtEl  = row.querySelector('td.event a, td.event, [class*="cell"][class*="event"] a, [class*="event"] a, [class*="event"]');
      const impEl  = row.querySelector('td.impact [title], td.impact img[title], [class*="impact"] [title], [class*="impact"] img[title]');

      if (!timeEl || !curEl || !evtEl) continue;

      const timeStr = (timeEl.textContent || '').trim();
      const currency= (curEl.textContent || '').trim().toUpperCase();
      const title   = (evtEl.textContent || '').trim();
      const impact  = (impEl && (impEl.getAttribute('title') || '').trim()) || '';

      if (!currency || !title) continue;
      if (!currentDate) continue;

      // parse time: "8:30am" | "14:00" | "All Day" | "-"
      let start = null;
      if (/all\s*day/i.test(timeStr) || timeStr === '-' || timeStr === '') {
        start = new Date(currentDate.getTime()); // 00:00
      } else {
        // 12h
        let m12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
        if (m12) {
          let hh = parseInt(m12[1],10);
          const mm = parseInt(m12[2],10);
          const ap = m12[3].toLowerCase();
          if (ap==='pm' && hh!==12) hh+=12;
          if (ap==='am' && hh===12) hh=0;
          start = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate(), hh, mm, 0));
        } else {
          // 24h
          let m24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
          if (m24) {
            const hh = parseInt(m24[1],10);
            const mm = parseInt(m24[2],10);
            start = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate(), hh, mm, 0));
          }
        }
      }
      if (!start) continue;

      out.push({
        currency,
        title,
        impactRaw: impact,
        timeStr,
        dateISO: toIso(start)
      });
    }
    return out;
  }, { year: params.year, tz: params.tz });
}

// Chiến lược 2: Fallback lỏng, quét text
async function extractFallbackLoose(page, params) {
  return await page.evaluate((ctx) => {
    const out = [];
    let currentDate = null;
    const months = {
      january:1,february:2,march:3,april:4,may:5,june:6,
      july:7,august:8,september:9,october:10,november:11,december:12
    };

    const blocks = Array.from(document.querySelectorAll('table tr, div'));
    for (const el of blocks) {
      const txt = (el.textContent || '').replace(/\s+/g,' ').trim();

      // detect day header
      const mday = txt.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b\s+([A-Za-z]+)\s+(\d{1,2})/i);
      if (mday) {
        const mm = months[mday[2].toLowerCase()];
        const dd = parseInt(mday[3],10);
        if (mm) currentDate = new Date(Date.UTC(parseInt(ctx.year,10), mm-1, dd, 0,0,0));
        continue;
      }

      // detect row with time + currency + title (thô)
      const curMatch = txt.match(/\b([A-Z]{3})\b/);
      const timeMatch = txt.match(/\b(\d{1,2}:\d{2}\s*[ap]m|\d{1,2}:\d{2}|All Day|-)\b/i);
      if (currentDate && curMatch && timeMatch) {
        let title = txt.replace(timeMatch[0], '').replace(curMatch[0], '').trim();
        const cutIdx = title.search(/\b(Previous|Forecast|Actual)\b/i);
        if (cutIdx > 0) title = title.slice(0, cutIdx).trim();

        out.push({
          currency: curMatch[1],
          title,
          impactRaw: '',
          timeStr: timeMatch[0],
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
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${Math.floor(120+Math.random()*5)}.0.0.0 Safari/537.36`
  });
  const page = await context.newPage();

  const months = monthList();
  let all = [];

  for (const m of months) {
    const url = `https://www.forexfactory.com/calendar?month=${m.y}-${m.m}`;
    console.log('⏩ Go', url);
    await gotoSafe(page, url);

    let raw = await extractByKnownClasses(page, { year: m.y, tz: TZ });
    if (!raw || raw.length === 0) {
      console.warn('⚠️ Primary extractor returned 0. Trying fallback...');
      raw = await extractFallbackLoose(page, { year: m.y, tz: TZ });
    }
    console.log(`Parsed ${raw.length} raw rows for ${m.y}-${m.m}`);

    // chuyển về Luxon + lọc
    for (const r of raw) {
      const currency = (r.currency || '').toUpperCase();
      if (!CURRENCIES.includes(currency)) continue;

      const impact = impactNormalize(r.impactRaw || '');
      if (impact !== 'UNKNOWN' && !IMPACTS.includes(impact)) continue;

      // r.timeStr + r.dateISO => build start (TZ Asia/Bangkok)
      let start;
      const base = DateTime.fromISO(r.dateISO, { zone: 'UTC' }).setZone(TZ); // date part
      if (/all\s*day/i.test(r.timeStr) || r.timeStr === '-' || !r.timeStr) {
        start = base.set({ hour:0, minute:0, second:0 });
      } else {
        let dt = DateTime.fromFormat(`${base.toFormat('yyyy-LL-dd')} ${r.timeStr}`, 'yyyy-LL-dd h:mma', { zone: TZ });
        if (!dt.isValid) dt = DateTime.fromFormat(`${base.toFormat('yyyy-LL-dd')} ${r.timeStr}`, 'yyyy-LL-dd H:mm', { zone: TZ });
        if (dt.isValid) start = dt;
      }
      if (!start || !start.isValid) continue;

      all.push({
        id: `${start.toISO()}__${currency}__${slugify((r.title||'').slice(0,100), { lower:true, strict:true })}`,
        title: r.title || '',
        currency,
        impact,
        startISO: start.toISO(),
        tz: TZ,
        year: m.y,
        month: m.m
      });
    }

    await page.waitForTimeout(1200 + Math.floor(Math.random() * 1200));
  }

  // dedupe + sort
  const uniq = dedupeByKey(all, x => `${x.startISO}__${x.currency}__${x.title}`);
  uniq.sort((a,b) => (a.startISO || '').localeCompare(b.startISO));

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
