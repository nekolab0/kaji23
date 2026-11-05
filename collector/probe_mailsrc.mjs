// 調査用: 全国の市町村の「火災メール」と、その公開バックナンバー（Webで読める配信履歴）を洗い出す（GitHub Actions の probe/mailsrc-* で実行）
//
// 1. shobo.info の市町村ページの「WEB・MAILで確認」「WEBで確認」「TELで確認」から、公式のページ・メール配信サービスのURL・電話番号を集める
//    （shobo.info の文章は使わない。公式のURLと番号だけを控え、中身は必ず公式側から読む）
// 2. メール配信サービス（すぐメール・ktaiwork・mailio・mpme など）のURLは、公開バックナンバーかを確かめ、
//    robots.txt が許す場合だけ1回読んで、火災が読み取れるかを数える
// 3. 登録用の空メールアドレスがページにあれば控える（登録の一覧づくり用）
// 結果: verify/probe_mailsrc.json
import fs from 'node:fs';
import { parseSource, robotsAllows, htmlText } from '../worker/src/official.js';
import { AREAS } from '../worker/src/areas.js';
import { decode } from './fetchutil.mjs';

const UA = 'kaji23-bot/1.0 (+https://kajisoku.jp/about.html; fire dispatch info by town)';
const OUT = new URL('../verify/probe_mailsrc.json', import.meta.url);
const LIMIT = +process.env.PROBE_LIMIT || 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const robotsCache = new Map(), lastHit = new Map();
async function politeFetch(url) {
  let u; try { u = new URL(url); } catch (e) { return { status: 'bad url' }; }
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
    return { status: 'ok', html: decode(await r.arrayBuffer(), r.headers.get('content-type')), finalUrl: r.url };
  } catch (e) { return { status: 'エラー: ' + String(e && e.message || e).slice(0, 60) }; }
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const DIR = 'https://shobo.info';
function section(html, labels) {
  for (const label of labels) {
    const i = html.indexOf(label); if (i < 0) continue;
    const rest = html.slice(i + label.length); const j = rest.search(/<h[23][\s>]/i);
    return j < 0 ? rest.slice(0, 6000) : rest.slice(0, j);
  }
  return '';
}
const anchors = html => [...html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => {
  let h; try { h = new URL(m[1].replace(/&amp;/g, '&'), DIR + '/').href; } catch (e) { return null; }
  return { url: h, text: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) };
}).filter(Boolean);
// メール配信サービスの見分け
const MAIL_SVC = [
  ['sugumail', /sugumail\.com|sg-p\.jp/], ['ktaiwork', /ktaiwork\.jp/], ['mailio', /mailio\.jp/], ['mpme', /mpme\.jp/],
  ['cous', /cous\.jp|mail-dpt\.jp|cousmail/], ['smart-lgov', /smart-lgov\.jp/], ['raiden', /raiden/], ['anshin', /anshin-?mail|bousai-?mail|mail\.(?:city|town|vill)/],
  ['line', /line\.me|lin\.ee/],
];
const svcOf = u => (MAIL_SVC.find(([, re]) => re.test(u)) || [null])[0];

// ---------- 1. 市町村ページを集める ----------
const top = await politeFetch(DIR + '/');
if (top.status !== 'ok') throw new Error('入口を読めない: ' + top.status);
const prefPages = [...new Set(anchors(top.html).map(a => a.url).filter(h => /^https:\/\/shobo\.info\/[a-z-]+\/$/.test(h) && !/\/(column|profile|privacy-policy|disclaimer|contact|category|tag|page)\/$/.test(h)))];
let muniPages = [];
for (const pu of prefPages) {
  const p = await politeFetch(pu); if (p.status !== 'ok') continue;
  const re = new RegExp('^' + pu.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '[a-z0-9-]+/$');
  muniPages.push(...[...new Set(anchors(p.html).map(a => a.url).filter(h => re.test(h)))]);
}
if (LIMIT) muniPages = muniPages.slice(0, LIMIT);
console.log(`市町村ページ ${muniPages.length}`);
const munis = await pool(muniPages, 3, async (url, k) => {
  const r = await politeFetch(url); if (r.status !== 'ok') return { page: url, status: r.status };
  const title = (r.html.match(/<title>([^<]+)/) || [])[1] || '';
  const name = (title.match(/^(.+?)の火災/) || [])[1] || '';
  const pref = Object.keys(AREAS).find(p => name.startsWith(p)) || '';
  const city = name.slice(pref.length);
  const webSec = section(r.html, ['WEB・MAILで確認', 'WEB・メールで確認', 'WEBで確認']);
  const links = anchors(webSec).filter(a => !/shobo\.info|google\.|twitter|x\.com|facebook|instagram|youtube/.test(a.url));
  const tel = [...new Set((htmlText(section(r.html, ['TELで確認'])).join(' ').match(/0\d{1,4}-\d{1,4}-\d{3,4}/g) || []))];
  const sns = anchors(section(r.html, ['SNSで確認'])).filter(a => /x\.com|twitter\.com/.test(a.url)).map(a => a.url);
  if (k % 100 === 0) console.log(`  ${k}/${muniPages.length} ${pref}${city}`);
  return { pref, city, page: url, links: links.map(a => ({ ...a, svc: svcOf(a.url) })), tel, sns };
});

// ---------- 2. メール配信サービスのページを確かめる ----------
const svcUrls = new Map();
for (const m of munis) for (const a of m.links || []) if (a.svc && a.svc !== 'line') {
  if (!svcUrls.has(a.url)) svcUrls.set(a.url, { url: a.url, svc: a.svc, text: a.text, munis: [] });
  svcUrls.get(a.url).munis.push(m.pref + m.city);
}
console.log(`メール配信サービスのURL ${svcUrls.size}`);
const ADDR = /[\w.+-]+@(?:[\w-]+\.)*(?:sg-p\.jp|ktaiwork\.jp|mailio\.jp|mpme\.jp|cous\.jp|cousmail[\w.-]*|mail-dpt\.jp|smart-lgov\.jp|[\w-]+\.lg\.jp|[\w-]+\.jp)/g;
const checks = await pool([...svcUrls.values()], 4, async (s) => {
  const r = await politeFetch(s.url);
  const o = { ...s, status: r.status };
  if (r.status !== 'ok') return o;
  o.final = r.finalUrl;
  const lines = htmlText(r.html);
  o.fireLines = lines.filter(l => /火災|火事/.test(l) && l.length < 200).slice(0, 8);
  o.addrs = [...new Set((r.html.match(ADDR) || []).filter(a => !/^(info|webmaster|soumu|kouhou)@/.test(a)))].slice(0, 6);
  const pref = (s.munis[0] || '').match(/^(.+?[都道府県])/); const p = pref ? pref[1] : '';
  const cities = [...new Set(s.munis.map(x => x.slice(p.length)))];
  const src = { id: 'probe', name: s.url, url: s.url, pref: p, type: 'sentence' };
  if (cities.length === 1 && (AREAS[p] || []).includes(cities[0])) src.city = cities[0];
  try { o.items30d = parseSource(r.html, src, new Date(), { hours: 24 * 31 }).length; o.items48h = parseSource(r.html, src, new Date()).length; } catch (e) { o.parseError = String(e.message).slice(0, 80); }
  o.sample = (o.items30d ? parseSource(r.html, src, new Date(), { hours: 24 * 31 }).slice(0, 4).map(x => `${x.at.slice(0, 16)} ${x.city}${x.town} ${x.kind}`) : []);
  return o;
});
const out = { generatedAt: new Date().toISOString(), municipalities: munis.length, withMailSvc: munis.filter(m => (m.links || []).some(a => a.svc)).length,
  svcCount: Object.fromEntries(MAIL_SVC.map(([k]) => [k, [...svcUrls.values()].filter(s => s.svc === k).length])), checks, munis };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`市町村 ${munis.length}・メール配信のある市町村 ${out.withMailSvc}・サービスURL ${checks.length}・公開で火災が読めたもの ${checks.filter(c => c.items30d).length}`);
