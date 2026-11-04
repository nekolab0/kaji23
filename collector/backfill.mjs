// 過去の発表をさかのぼって記録に入れる（GitHub Actions で手動実行。1回きり、または時々）
//
// 消防メールのブログ版（WordPress）は、配信した火災情報が何年分もページ送りで残っている。
// その一覧ページを古い方へたどり、「日時・市区町村・町名・種別」だけを取り出して
// verify/backfill_official.json に書く（取り込みは official_archive.json へ手で合流させる）。
//  - 本文の文章は保存しない。場所は町名まで（丁目・番地は捨てる）
//  - 礼儀: robots.txt を守り、同じサイトは2秒に1ページ。BACKFILL_YEARS 年より古くなったら止める
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseSource, robotsAllows } from '../worker/src/official.js';
import { SOURCES } from '../worker/src/official.js';
import { decode } from './fetchutil.mjs';

const UA = 'kaji23-bot/1.0 (+https://kajisoku.jp/about.html; fire dispatch info by town)';
const YEARS = +process.env.BACKFILL_YEARS || 3;
const MAXP = +process.env.BACKFILL_MAX_PAGES || 400;
const OUT = new URL('../verify/backfill_official.json', import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cutoff = Date.now() - YEARS * 365 * 864e5;

export function pageUrl(base, n) {
  if (n === 1) return base;
  const u = new URL(base);
  if (/\/category\//.test(u.pathname)) { u.pathname = u.pathname.replace(/\/?$/, '/') + `page/${n}/`; return u.href; }
  u.searchParams.set('paged', String(n)); return u.href;
}
const baseTown = t => String(t || '').replace(/([0-9０-９]+|[一二三四五六七八九十]+)丁目.*$/, '');

async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) return { status: r.status };
    return { status: 200, html: decode(await r.arrayBuffer(), r.headers.get('content-type') || '') };
  } catch (e) { return { status: 0, error: String(e.message || e) }; }
}

const targets = SOURCES.filter(s => /ktaiwork\.jp/.test(s.url) || (process.env.BACKFILL_URLS || '').split(',').includes(s.url));
const fires = {}, report = [];
await Promise.all(targets.map(async src => {
  const rep = { url: src.url, pages: 0, items: 0, oldest: null, stop: '' };
  const rb = await get(new URL('/robots.txt', src.url).href);
  if (!robotsAllows(rb.status === 200 ? rb.html : '', src.url)) { rep.stop = 'robots'; report.push(rep); return; }
  let empty = 0;
  for (let n = 1; n <= MAXP; n++) {
    const r = await get(pageUrl(src.url, n)); rep.pages = n;
    if (r.status !== 200) { rep.stop = 'HTTP ' + r.status; break; }
    // 年が書かれていない日付は「いま」から推定されるので、そのページの一番新しい年を基準にせず、年つきの日付だけを使う
    const items = parseSource(r.html, src, new Date(), { hours: 24 * 365 * (YEARS + 1) }).filter(x => x.at);
    const yearDated = /20\d{2}年\d{1,2}月\d{1,2}日/.test(r.html);
    if (!items.length || !yearDated) { if (++empty >= 3) { rep.stop = '火災のないページが続いた'; break; } }
    else empty = 0;
    let oldestOnPage = Infinity;
    for (const x of yearDated ? items : []) {
      const t = +new Date(x.at); oldestOnPage = Math.min(oldestOnPage, t);
      if (t < cutoff) continue;
      const town = baseTown(x.town);
      const key = 'o-b-' + crypto.createHash('sha1').update(`${src.id}|${x.city}|${town}|${x.at.slice(0, 13)}`).digest('hex').slice(0, 10);
      const day = new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
      const cur = fires[key];
      if (!cur) { fires[key] = [x.pref, x.city, town, day, x.kind, x.at, src.name, src.url, x.status || '']; rep.items++; }
      else { if (x.status === '鎮火') cur[8] = '鎮火'; if (cur[4] === '火災' && x.kind !== '火災') cur[4] = x.kind; }
    }
    if (oldestOnPage < Infinity) rep.oldest = new Date(oldestOnPage).toISOString().slice(0, 10);
    if (oldestOnPage < cutoff) { rep.stop = `${YEARS}年より古くなった`; break; }
    await sleep(2000);
  }
  report.push(rep);
  console.log(`${src.name}: ${rep.pages}ページ・${rep.items}件（${rep.oldest || '-'}まで、${rep.stop}）`);
}));
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), years: YEARS, total: Object.keys(fires).length, report, fires }));
console.log(`計 ${Object.keys(fires).length}件`);
