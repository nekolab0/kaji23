// 調査用: 全国の消防の「出動情報」ページを洗い出し、取り込めるかを判定する（GitHub Actions で手動実行）
//
// 1. shobo.info（市町村ごとに公式の出動情報ページ・案内ダイヤルをまとめた民間サイト）を入口に、
//    各市町村ページの「WEBで確認」にある公式ページのURLと「TELで確認」の電話番号を集める
//    （shobo.info の文章は使わない。公式ページのURLと番号だけを控え、中身は必ず公式ページから読む）
// 2. 公式ページを1回ずつ読み、worker の読み取り（official.js）で火災が何件取れるかを数える
// 3. 結果を verify/probe_sources.json に書く（どのページを本番の一覧に入れるかの判断材料）
//
// 礼儀: robots.txt を守り、同じサイトへは間を空け、同時に読むのは4ページまで。
import fs from 'node:fs';
import { parseSource, robotsAllows, htmlText } from '../worker/src/official.js';
import { AREAS } from '../worker/src/areas.js';
import { decode } from './fetchutil.mjs';

const UA = 'kaji23-bot/1.0 (+https://kajisoku.jp/about.html; fire dispatch info by town)';
const OUT = new URL('../verify/probe_sources.json', import.meta.url);
const LIMIT = +process.env.PROBE_LIMIT || 0;   // テスト用に市町村数を絞る
const sleep = ms => new Promise(r => setTimeout(r, ms));

const robotsCache = new Map(), lastHit = new Map();
async function politeFetch(url, { raw = false } = {}) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let txt = '';
    try { const r = await fetch(u.origin + '/robots.txt', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }); txt = r.ok ? await r.text() : ''; } catch (e) {}
    robotsCache.set(u.origin, txt);
  }
  if (!robotsAllows(robotsCache.get(u.origin), url)) return { status: 'robots' };
  const wait = (lastHit.get(u.host) || 0) + 1200 - Date.now(); if (wait > 0) await sleep(wait);
  lastHit.set(u.host, Date.now());
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (!r.ok) return { status: 'HTTP ' + r.status };
    const buf = await r.arrayBuffer();
    if (raw) return { status: 'ok', buf, type: r.headers.get('content-type') || '', finalUrl: r.url };
    return { status: 'ok', html: decode(buf, r.headers.get('content-type')), finalUrl: r.url };
  } catch (e) { return { status: 'エラー: ' + String(e && e.message || e).slice(0, 60) }; }
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ---------- 1. 入口のサイトから市町村ごとの公式ページを集める ----------
const DIR = 'https://shobo.info';
const links = (html, re) => [...new Set([...html.matchAll(/href=["']([^"']+)["']/g)].map(m => new URL(m[1], DIR + '/').href).filter(h => re.test(h)))];
function section(html, label) {
  const i = html.indexOf(label); if (i < 0) return '';
  const rest = html.slice(i + label.length); const j = rest.search(/<h[23][\s>]/i);
  return j < 0 ? rest.slice(0, 4000) : rest.slice(0, j);
}
async function discover() {
  const top = await politeFetch(DIR + '/');
  if (top.status !== 'ok') throw new Error('入口サイトを読めない: ' + top.status);
  const prefs = links(top.html, /^https:\/\/shobo\.info\/[a-z-]+\/$/).filter(h => !/\/(column|profile|privacy-policy|disclaimer|contact|category|tag|page)\/$/.test(h));
  const munis = [];
  for (const pu of prefs) {
    const p = await politeFetch(pu); if (p.status !== 'ok') continue;
    const prefName = ((p.html.match(/–\s*([^\s<]+?[都道府県])INDEX/) || p.html.match(/([^\s>]+?[都道府県])INDEX/) || [])[1] || '').replace(/^.*[\s–]/, '');
    for (const mu of links(p.html, new RegExp('^' + pu.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '[a-z0-9-]+/$'))) munis.push({ prefUrl: pu, pref: prefName, url: mu });
  }
  const list = LIMIT ? munis.slice(0, LIMIT) : munis;
  console.log(`都道府県 ${prefs.length}・市町村ページ ${list.length}`);
  return pool(list, 4, async (m, k) => {
    const r = await politeFetch(m.url); if (r.status !== 'ok') return { ...m, status: r.status };
    const title = (r.html.match(/<title>([^<]+)/) || [])[1] || '';
    const name = (title.match(/^(.+?)の火災/) || [])[1] || '';
    const pref = m.pref || (Object.keys(AREAS).find(p => name.startsWith(p)) || '');
    const city = name.slice(pref.length);
    const web = links(section(r.html, 'WEBで確認'), /^https?:\/\//).filter(h => !/shobo\.info|google|twitter|x\.com|facebook|line\.me|instagram|youtube/.test(h));
    const tel = [...new Set((htmlText(section(r.html, 'TELで確認')).join(' ').match(/0\d{1,4}-\d{1,4}-\d{3,4}/g) || []))];
    if (k % 100 === 0) console.log(`  ${k}/${list.length} ${pref}${city}`);
    return { pref, city, page: m.url, web, tel };
  });
}

// ---------- 2. 公式ページを読んで、火災が取れるか判定 ----------
function srcFor(url, munis) {
  const pref = munis[0].pref, cities = [...new Set(munis.map(m => m.city))];
  const s = { id: 'probe', name: url, url, pref, type: 'sentence' };
  const desig = cities.find(c => (AREAS[pref] || []).some(n => n.startsWith(c) && n !== c && n.endsWith('区')));
  if (desig) s.wardCity = desig;
  if (cities.length === 1 && (AREAS[pref] || []).includes(cities[0])) s.city = cities[0];
  if (/119\.city\.sapporo/.test(url)) { s.type = 'sapporo'; s.sections = { '札幌市': '札幌市', '江別市': '江別市', '千歳市': '千歳市', '恵庭市': '恵庭市', '北広島市': '北広島市', '石狩北部地区消防事務組合': null }; }
  return s;
}
async function check(url, munis) {
  const r = await politeFetch(url);
  const res = { url, pref: munis[0].pref, cities: [...new Set(munis.map(m => m.city))], status: r.status };
  if (r.status !== 'ok') return res;
  let src; try { src = srcFor(url, munis); } catch (e) { res.status = 'エラー: ' + e.message; return res; }
  res.src = { pref: src.pref, wardCity: src.wardCity || null, city: src.city || null };
  res.final = r.finalUrl;
  const lines = htmlText(r.html);
  res.fireLines = lines.filter(l => /火災|火事/.test(l) && l.length < 200).slice(0, 10);
  res.dates = lines.filter(l => /\d{1,2}[月/]\d{1,2}/.test(l)).length;
  res.ktaiwork = /ktaiwork/.test(url);
  let recent = [], wide = [];
  try {
    recent = parseSource(r.html, src, new Date());
    wide = parseSource(r.html, src, new Date(), { hours: 24 * 31 });   // 過去分も（小さな市は48時間に火事がないことが多い）
  } catch (e) { res.parseError = String(e.message).slice(0, 100); }
  res.items48h = recent.length; res.items30d = wide.length;
  res.sample = wide.slice(0, 5).map(x => `${x.at.slice(0, 16)} ${x.city}${x.town} ${x.kind}${x.status ? '・' + x.status : ''}`);
  // ページ送り（WordPress の ?paged=2 など）があるか
  res.paged = /[?&]paged=2|\/page\/2\//.test(r.html);
  return res;
}

// 市町村の一覧は一度集めたら保存して使い回す（入口サイトへの負担を減らす）
const MF = new URL('../verify/probe_munis.json', import.meta.url);
let munis;
if (fs.existsSync(MF) && !process.env.PROBE_REDISCOVER) munis = JSON.parse(fs.readFileSync(MF, 'utf8'));
else { munis = await discover(); fs.writeFileSync(MF, JSON.stringify(munis, null, 1)); }
const byUrl = new Map();
for (const m of munis) for (const u of m.web || []) { if (!byUrl.has(u)) byUrl.set(u, []); byUrl.get(u).push(m); }
console.log(`公式ページ ${byUrl.size}件を確認`);
const checks = await pool([...byUrl.entries()], 4, async ([u, ms], k) => { if (k % 50 === 0) console.log(`  ${k}/${byUrl.size}`); return check(u, ms); });
const good = checks.filter(c => c.items30d > 0).sort((a, b) => b.items30d - a.items30d);
const out = { generatedAt: new Date().toISOString(), municipalities: munis.length, pages: checks.length,
  withFires30d: good.length, items30d: good.reduce((a, c) => a + c.items30d, 0), items48h: good.reduce((a, c) => a + c.items48h, 0), checks, munis };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`市町村 ${munis.length}・公式ページ ${checks.length}・過去30日の火災が読めたページ ${good.length}（30日 計${out.items30d}件・48時間 ${out.items48h}件）`);
for (const c of good.slice(0, 60)) console.log(`  ${c.items30d}件 ${c.pref}${c.cities.join('・')} ${c.url}`);
