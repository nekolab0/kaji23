// 調査用: 報道からの火事の取り込み漏れを調べる（GitHub Actions の probe/news-* ブランチで実行）
//  1. いまの検索（news_run.mjs と同じ）で、検索ごとの記事数（100件で頭打ち＝取りこぼし）を数える
//  2. 読めなかった記事を理由別に数える（火事の語なし・対象外・古い・場所が読めない）。場所が読めない見出しは改善用に控える
//  3. 追加候補の検索で、新しい火事が何件増えるかを数える
// 結果: verify/probe_news.json
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { buildGeo, extractFireNewsJP, parseRSS } = require('./news_jp.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(root, 'data', 'raw');
const areas = JSON.parse(fs.readFileSync(path.join(RAW, 'areas.json'), 'utf8'));
const geo = buildGeo(areas, JSON.parse(fs.readFileSync(path.join(RAW, 'towns_jp.json'), 'utf8')).towns);
const PREFS = Object.keys(areas.prefs);
const TOKYO23 = areas.prefs['東京都'].slice(0, 23).map(x => x[0]);
const BIG = Object.keys(areas.parents || {}).flatMap(p => areas.parents[p].map(x => x[0]));
const W = process.env.NEWS_WINDOW || 'when:1d';
const base = ['火事', '火災', '全焼', '建物火災'].map(q => `${q} ${W}`)
  .concat(PREFS.map(p => `(火事 OR 火災) ${p} ${W}`), PREFS.map(p => `(全焼 OR 半焼 OR 焼ける OR 燃える OR 焼損) ${p} ${W}`), TOKYO23.map(w => `(火事 OR 火災) "${w}" when:2d`));
const extra = ['出火', '焼損', '消防車', '火の手', '住宅火災', '車両火災', '火災 けが', '火災 死亡', '火災 遺体', '燃える 住宅', '焼け跡', '延焼', '火事 けが人なし', '炎上 車']
  .map(q => `${q} ${W}`)
  .concat(BIG.map(c => `(火事 OR 火災 OR 全焼 OR 出火) ${c} ${W}`), PREFS.map(p => `(出火 OR 延焼 OR 消防車) ${p} ${W}`));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function search(q) {
  try {
    const r = await fetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=ja&gl=JP&ceid=JP:ja', { headers: { 'User-Agent': 'kaji23-news/1.0 (+https://github.com/nekolab0/kaji23)' } });
    if (!r.ok) return { q, err: r.status, items: [] };
    return { q, items: parseRSS(await r.text()) };
  } catch (e) { return { q, err: String(e.message).slice(0, 40), items: [] }; } finally { await sleep(400); }
}
const NOT_INCIDENT_SRC = fs.readFileSync(path.join(root, 'collector', 'news_jp.js'), 'utf8').match(/const NOT_INCIDENT = (\/.*\/);/)[1];
const NOT_INCIDENT = eval(NOT_INCIDENT_SRC);
function reason(it) {
  const t = String(it.title || '').replace(/\s+-\s+[^-]+$/, '');
  if (!/火事|火災|全焼|半焼|燃え|焼け/.test(t)) return 'no_fire_word';
  if (NOT_INCIDENT.test(t)) return 'not_incident';
  const pub = new Date(it.pubDate); if (isNaN(pub) || (Date.now() - pub) / 36e5 > 48) return 'old';
  return extractFireNewsJP([it], geo, { maxAgeHours: 48 }).length ? 'ok' : 'no_place';
}
function run(results) {
  const seen = new Set(), items = [];
  for (const r of results) for (const it of r.items) if (!seen.has(it.link)) { seen.add(it.link); items.push(it); }
  return { items, inc: extractFireNewsJP(items, geo, { maxAgeHours: 48 }) };
}
const baseRes = []; for (const q of base) baseRes.push(await search(q));
const extraRes = []; for (const q of extra) extraRes.push(await search(q));
const b = run(baseRes), all = run([...baseRes, ...extraRes]);
const reasons = {}; const noPlace = [], notInc = [];
for (const it of all.items) {
  const k = reason(it); reasons[k] = (reasons[k] || 0) + 1;
  const t = String(it.title).replace(/\s+-\s+[^-]+$/, '').slice(0, 70);
  if (k === 'no_place' && noPlace.length < 400) noPlace.push(t);
  if (k === 'not_incident' && notInc.length < 80) notInc.push(t);
}
const baseIds = new Set(b.inc.map(x => x.id));
const gain = extraRes.map(r => {
  const one = run([...baseRes, r]).inc.filter(x => !baseIds.has(x.id));
  return { q: r.q, n: r.items.length, err: r.err, newInc: one.length };
}).filter(x => x.newInc || x.n >= 90).sort((a, b) => b.newInc - a.newInc);
const out = {
  generatedAt: new Date().toISOString(), window: W,
  base: { queries: base.length, items: b.items.length, incidents: b.inc.length, withTown: b.inc.filter(x => x.town).length,
    saturated: baseRes.filter(r => r.items.length >= 90).map(r => r.q), errors: baseRes.filter(r => r.err).length },
  withExtra: { queries: base.length + extra.length, items: all.items.length, incidents: all.inc.length, withTown: all.inc.filter(x => x.town).length },
  reasons, gain, noPlace, notInc,
};
fs.mkdirSync(path.join(root, 'verify'), { recursive: true });
fs.writeFileSync(path.join(root, 'verify', 'probe_news.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ base: out.base, withExtra: out.withExtra, reasons }, null, 1));
