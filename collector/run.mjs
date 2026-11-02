// 毎日の自動収集（サーバー／GitHub Actions 用）
// 使い方: npm i jsdom && node collector/run.mjs
// 出力: data/raw/tfd_YYYY-MM-DD.json（サイト生成 site/build.py が読む形式）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// ブラウザで検証済みの解析コードをそのまま読み込む
const ctx = vm.createContext({ console, URL, Math, Date, JSON, Number, String, Array, Object, Set, Map, RegExp, setTimeout });
for (const f of ['parse_station.js', 'collect_tfd.js']) {
  const src = fs.readFileSync(path.join(here, f), 'utf8').replace(/^if \(typeof (module|require).*$/gm, '');
  vm.runInContext(src, ctx, { filename: f });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'kaji23-collector/1.0 (+https://github.com/nekolab0/kaji23; public fire statistics, about 1 request per second)';
async function fetchText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      await sleep(800); // 東京消防庁のサーバーに負荷をかけないよう間隔をあける
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
      if (r.status === 404) throw Object.assign(new Error('HTTP 404'), { final: true });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (e.final || i === tries - 1) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}
const parseHTML = html => new JSDOM(html).window.document;

export async function collect({ fetchFn = fetchText, thisYear = new Date().getFullYear() } = {}) {
  const res = await ctx.collectTFD(fetchFn, parseHTML, { thisYear });
  // サイト生成用の形式に変換（ブラウザ版の書き出しと同じ）
  const stations = {};
  for (const s of Object.values(res.stations)) {
    stations[s.slug] = { n: s.name, u: (s.url || '').replace(res.source, ''), s: s.status, y: s.ytd, p: s.ytdPrev, a: s.annual,
                         as: s.asof, up: s.updated, src: s.sources, w: s.warnings };
  }
  const wards = res.wards.map(w => { const g = {}; w.towns.forEach(t => (g[t.station] = g[t.station] || []).push(t.town)); return { slug: w.slug, name: w.name, st: g }; });
  return { out: { fetchedAt: res.fetchedAt, daily: res.daily && { up: res.daily.updated, label: res.daily.dayLabel, rows: res.daily.rows, url: res.daily.url }, wards, stations }, errors: res.errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { out, errors } = await collect();
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const file = path.join(root, 'data', 'raw', `tfd_${day}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  const counts = Object.values(out.stations).reduce((a, s) => (a[s.s] = (a[s.s] || 0) + 1, a), {});
  console.log('saved', file, counts, errors.length ? 'errors: ' + errors.join(', ') : '');
  // 取得が大きく欠けた日は失敗にして、前日のデータのまま公開を続ける
  if ((counts.ok || 0) < 40 || out.wards.length !== 23) { console.error('取得件数が少なすぎるため中止'); fs.unlinkSync(file); process.exit(1); }
}
