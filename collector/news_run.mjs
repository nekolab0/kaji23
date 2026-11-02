// 報道からの火事速報（30分ごと）: Googleニュースの検索RSSを取得 → 区・町名を抽出 → data/raw/news.json に30日分を保持
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { extractFireNews, parseRSS } = require('./news.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(root, 'data', 'raw');

// 町名リスト（東京消防庁の管轄表から作ったもの）
const tfdFile = fs.readdirSync(RAW).filter(f => /^tfd_.*\.json$/.test(f)).sort().pop();
const tfd = JSON.parse(fs.readFileSync(path.join(RAW, tfdFile), 'utf8'));
const towns = {};
for (const w of tfd.wards) towns[w.name] = Object.values(w.st).flat().filter(t => !t.endsWith('の区域'));

const WARDS = Object.keys(towns);
const queries = ['火事 東京 when:2d', '火災 東京 when:2d', ...WARDS.map(w => `(火事 OR 火災) "${w}" when:2d`)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const items = []; const seen = new Set(); let failed = 0;
for (const q of queries) {
  try {
    const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=ja&gl=JP&ceid=JP:ja';
    const r = await fetch(url, { headers: { 'User-Agent': 'kaji23-news/1.0' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    for (const it of parseRSS(await r.text())) if (!seen.has(it.link)) { seen.add(it.link); items.push(it); }
  } catch (e) { failed++; console.error(q, e.message); }
  await sleep(500);
}
if (failed > queries.length / 2) { console.error('取得失敗が多いため前回のデータを維持'); process.exit(1); }

const fresh = extractFireNews(items, towns, { maxAgeHours: 48 });
// 既存分とまとめる（同じidは新しい情報で上書き、媒体は合算）。30日より古いものは捨てる
const file = path.join(RAW, 'news.json');
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).incidents : [];
const byId = new Map(prev.map(x => [x.id, x]));
for (const x of fresh) {
  const o = byId.get(x.id);
  if (o) { const names = new Set(o.sources.map(s => s.name)); x.sources = [...o.sources, ...x.sources.filter(s => !names.has(s.name))].slice(0, 3); x.first = o.first < x.first ? o.first : x.first; }
  byId.set(x.id, x);
}
const cutoff = Date.now() - 30 * 864e5;
const incidents = [...byId.values()].filter(x => new Date(x.first) > cutoff).sort((a, b) => b.first.localeCompare(a.first));
fs.writeFileSync(file, JSON.stringify({ collectedAt: new Date().toISOString(), window_hours: 48, queries: queries.length, items: items.length, incidents }));
console.log(`news: ${items.length}件の記事 → ${fresh.length}件の火事（保持 ${incidents.length}件）`);
