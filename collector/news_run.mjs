// 報道からの火事速報（30分ごと・全国）: Googleニュースの検索RSSを取得 → 都道府県・市区町村・町名を抽出
//  - data/raw/news.json    … 直近30日の火事（サイトの一覧・火事のページ用）
//  - data/raw/news_archive.json … これまでの全件（場所と日付だけ。検索候補の「記録○件」に使う）
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { buildGeo, extractFireNewsJP, parseRSS } = require('./news_jp.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(root, 'data', 'raw');
const areas = JSON.parse(fs.readFileSync(path.join(RAW, 'areas.json'), 'utf8'));
const townsJP = JSON.parse(fs.readFileSync(path.join(RAW, 'towns_jp.json'), 'utf8')).towns;
const geo = buildGeo(areas, townsJP);

const PREFS = Object.keys(areas.prefs);
const TOKYO23 = areas.prefs['東京都'].slice(0, 23).map(x => x[0]);
const queries = ['火事 when:1d', '火災 when:1d', '全焼 when:1d', '建物火災 when:1d',
  ...PREFS.map(p => `(火事 OR 火災) ${p} when:1d`),
  // 見出しに「火事・火災」が入らない報道（「住宅1棟全焼」「倉庫焼ける」など）も拾う
  ...PREFS.map(p => `(全焼 OR 半焼 OR 焼ける OR 燃える OR 焼損) ${p} when:1d`),
  ...TOKYO23.map(w => `(火事 OR 火災) "${w}" when:2d`)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const items = []; const seen = new Set(); let failed = 0;
for (const q of queries) {
  try {
    const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=ja&gl=JP&ceid=JP:ja';
    const r = await fetch(url, { headers: { 'User-Agent': 'kaji23-news/1.0 (+https://github.com/nekolab0/kaji23)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    for (const it of parseRSS(await r.text())) if (!seen.has(it.link)) { seen.add(it.link); items.push(it); }
  } catch (e) { failed++; console.error(q, e.message); }
  await sleep(400);
}
if (failed > queries.length / 2) { console.error('取得失敗が多いため前回のデータを維持'); process.exit(1); }

const fresh = extractFireNewsJP(items, geo, { maxAgeHours: 48 });
// 既存分とまとめる（同じidは新しい情報で上書き、媒体は合算）。23区だけだった頃の記録は東京都として引き継ぐ
const file = path.join(RAW, 'news.json');
const prev = (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).incidents : []).map(x => {
  if (x.pref) return x;
  const y = { ...x, pref: '東京都', city: x.ward };
  y.id = `東京都-${x.ward}-${x.town || 'x'}-${x.first.slice(0, 10)}`;
  return y;
});
const byId = new Map(prev.map(x => [x.id, x]));
for (const x of fresh) {
  const o = byId.get(x.id);
  if (o) { const names = new Set(o.sources.map(s => s.name)); x.sources = [...o.sources, ...x.sources.filter(s => !names.has(s.name))].slice(0, 3); x.first = o.first < x.first ? o.first : x.first; }
  byId.set(x.id, x);
}
const cutoff = Date.now() - 30 * 864e5;
const incidents = [...byId.values()].filter(x => new Date(x.first) > cutoff).sort((a, b) => b.first.localeCompare(a.first));
fs.writeFileSync(file, JSON.stringify({ collectedAt: new Date().toISOString(), window_hours: 48, queries: queries.length, items: items.length, incidents }));

// 全件の記録（id → [都道府県, 市区町村, 町名, 日付]）
const afile = path.join(RAW, 'news_archive.json');
const archive = fs.existsSync(afile) ? JSON.parse(fs.readFileSync(afile, 'utf8')) : { note: '報道から取り出した火事の場所と日付（全期間）', fires: {} };
for (const x of incidents) archive.fires[x.id] = [x.pref, x.city, x.town || '', x.first.slice(0, 10)];
fs.writeFileSync(afile, JSON.stringify(archive));
const byPref = {}; fresh.forEach(x => { byPref[x.pref] = (byPref[x.pref] || 0) + 1; });
console.log(`news: ${queries.length}本の検索・${items.length}件の記事 → ${fresh.length}件の火事（保持 ${incidents.length}件・記録 ${Object.keys(archive.fires).length}件）`);
console.log('都道府県別:', Object.entries(byPref).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + v).join(' '));
