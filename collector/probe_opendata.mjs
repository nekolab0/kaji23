// 調査用: 自治体のオープンデータから「1件ごとの火災の記録」を探す（GitHub Actions で手動実行）
//
// CKAN（データカタログの共通の仕組み）の検索APIで「火災」を含むデータセットを集め、CSVを開いて
// 「日付の列」と「場所（町名）の列」があり、行が1件ずつの火災になっているものを見分ける。
// 結果は verify/probe_opendata.json（列名・行数・見本3行・ライセンス・URL）。取り込むかの判断材料。
import fs from 'node:fs';
import { decode } from './fetchutil.mjs';

const UA = 'kaji23-bot/1.0 (+https://kajisoku.jp/about.html)';
const OUT = new URL('../verify/probe_opendata.json', import.meta.url);
// 自治体のデータが集まっているカタログ（CKAN の API）
const CATALOGS = [
  'https://data.bodik.jp/api/3/action',
  'https://data.e-gov.go.jp/data/api/action',
  'https://catalog.data.metro.tokyo.lg.jp/api/3/action',
  'https://ckan.odp.jig.jp/api/3/action',
  'https://www.geospatial.jp/ckan/api/3/action',
  'https://data.city.osaka.lg.jp/api/3/action',
  'https://opendata.pref.chiba.lg.jp/api/3/action',
  'https://data.pref.fukuoka.lg.jp/api/3/action',
  'https://catalog.opendata.pref.aichi.jp/api/3/action',
  'https://opendata.pref.kagawa.lg.jp/api/3/action',
  'https://ckan.open-governmentdata.org/api/3/action',
  'https://catalog.city.utsunomiya.tochigi.jp/api/3/action',
  'https://data.city.sapporo.jp/api/3/action',
  'https://ckan.pref.kanagawa.jp/api/3/action',
  'https://odcs.bodik.jp/api/3/action',
];
const QUERIES = ['火災発生', '火災 一覧', '火災', '出火', '火災 件数', '火災出動'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(u) {
  try { const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }); if (!r.ok) return { error: 'HTTP ' + r.status }; return await r.json(); }
  catch (e) { return { error: String(e && e.message || e).slice(0, 80) }; }
}

// CSV を行・列に（引用符の中のカンマ・改行に対応）
export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
// 1件ごとの記録か: 日付の列と場所の列があり、日付の列の値が日付として読める行が多い
const DATE_COL = /覚知|発生日|出火日|年月日|日時|発生時刻|出火時刻|発生年月|^日付$|月日/;
const PLACE_COL = /町名|町丁|字|発生場所|出火場所|場所|地区|住所|所在地|発生地|町域/;
const looksDate = v => /\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}|^[RHS令平]\d{1,2}[-/.年]\d{1,2}[-/.月]\d{1,2}|令和\d+年\d+月\d+日|^\d{8}$/.test(String(v).trim());
export function classify(rows) {
  let hi = rows.findIndex(r => r.some(x => DATE_COL.test(x)) && r.some(x => PLACE_COL.test(x)));
  if (hi < 0 || hi > 5) return { perIncident: false, reason: rows.length ? '日付・場所の列なし' : '空' };
  const head = rows[hi].map(x => x.trim());
  const di = head.findIndex(x => DATE_COL.test(x)), pi = head.findIndex(x => PLACE_COL.test(x) && !DATE_COL.test(x));
  const body = rows.slice(hi + 1);
  const dated = body.filter(r => looksDate(r[di] || '')).length;
  return { perIncident: dated >= Math.max(3, body.length * 0.6), head, dateCol: head[di], placeCol: head[pi], rows: body.length, dated, sample: body.slice(0, 3) };
}

const seen = new Set(), found = [], errors = {};
for (const base of CATALOGS) {
  for (const q of QUERIES) {
    for (let start = 0; start < 2000; start += 500) {
      const j = await getJSON(`${base}/package_search?q=${encodeURIComponent(q)}&rows=500&start=${start}`);
      if (j.error || !j.result) { errors[base] = j.error || 'no result'; break; }
      for (const pk of j.result.results) {
        const key = base + '|' + pk.id; if (seen.has(key)) continue; seen.add(key);
        if (!/火災|火事|出火|消防/.test((pk.title || '') + (pk.notes || '').slice(0, 300))) continue;
        for (const rs of pk.resources || []) {
          const fmt = String(rs.format || '').toLowerCase(), url = rs.url || '';
          if (!(fmt.includes('csv') || /\.csv(\?|$)/i.test(url))) continue;
          found.push({ catalog: base, org: (pk.organization || {}).title || '', dataset: pk.title, resource: rs.name || '', url, license: pk.license_title || pk.license_id || '', modified: rs.last_modified || pk.metadata_modified || '' });
        }
      }
      if (j.result.results.length < 500) break;
      await sleep(500);
    }
  }
  console.log(`${base}: 候補 ${found.filter(f => f.catalog === base).length}${errors[base] ? '（' + errors[base] + '）' : ''}`);
}
console.log(`CSV 候補 ${found.length}件を開く`);
const uniq = [...new Map(found.map(f => [f.url, f])).values()];
let i = 0;
for (const f of uniq) {
  i++; if (i % 50 === 0) console.log(`  ${i}/${uniq.length}`);
  try {
    const r = await fetch(f.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!r.ok) { f.status = 'HTTP ' + r.status; continue; }
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 30e6) { f.status = '大きすぎ'; continue; }
    const rows = parseCSV(decode(buf, r.headers.get('content-type') || ''));
    Object.assign(f, { status: 'ok', bytes: buf.byteLength }, classify(rows));
  } catch (e) { f.status = 'エラー: ' + String(e && e.message || e).slice(0, 60); }
  await sleep(300);
}
const per = uniq.filter(f => f.perIncident).sort((a, b) => b.rows - a.rows);
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), errors, candidates: uniq.length, perIncident: per.length, records: per.reduce((a, f) => a + f.rows, 0), perIncidentList: per, others: uniq.filter(f => !f.perIncident) }, null, 1));
console.log(`1件ごとの記録 ${per.length}ファイル・計${per.reduce((a, f) => a + f.rows, 0)}行`);
for (const f of per.slice(0, 60)) console.log(`  ${f.rows}行 ${f.org} ${f.dataset} [${f.dateCol}/${f.placeCol}] ${f.url}`);
