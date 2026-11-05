// 受付サーバー（Cloudflare Workers）に集まった消防本部の発表を、サイトの記録（全期間）に足す
//  - data/raw/official_archive.json … {fires: {o-<火事ID>: [都道府県, 市区町村, 町名, 日付(日本時間), 種別, 最初の時刻, 出典名, 出典URL, 状態]}}
//  - 同じ火事（受付サーバーが同じ場所・近い時刻の発表を1つにまとめたもの）は1件として数える
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const API = (process.env.REPORTS_API || fs.readFileSync(path.join(ROOT, 'worker', 'url.txt'), 'utf8')).trim().replace(/\/$/, '');
const file = path.join(RAW, 'official_archive.json');
const arc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { fires: {} };
const jstDay = iso => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);

export function mergeOfficial(fires, items) {
  let added = 0;
  for (const x of items) {
    if (!x.inc || !x.pref || !x.ward) continue;
    const id = 'o-' + x.inc;
    const town = x.town ? String(x.town).replace(/([0-9０-９]+|[一二三四五六七八九十]+)丁目.*$/, '') : '';
    const cur = fires[id];
    if (!cur) { fires[id] = [x.pref, x.ward, town, jstDay(x.at), x.kind || '火災', x.at, x.source_name || '', x.source_url || '', x.status || '']; added++; continue; }
    if (x.at < cur[5]) { cur[5] = x.at; cur[3] = jstDay(x.at); }
    if (!cur[2] && town) cur[2] = town;
    if (x.status === '鎮火' || (x.status && !cur[8])) cur[8] = x.status;
    if (cur[4] === '火災' && x.kind && x.kind !== '火災') cur[4] = x.kind;   // 「建物火災」など、詳しい種別があればそちら
  }
  return added;
}

if (process.argv[1] && process.argv[1].endsWith('official_run.mjs')) {
  const days = +process.env.OFFICIAL_DAYS || 7;
  try {
    const r = await fetch(`${API}/api/official?days=${days}`, { headers: { 'User-Agent': 'kaji23-build' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const added = mergeOfficial(arc.fires, j.items || []);
    arc.collectedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(arc));
    console.log(`消防本部の発表: ${j.items.length}件を確認、新しい火事 ${added}件（記録 計${Object.keys(arc.fires).length}件）`);
  } catch (e) {
    console.log('消防本部の発表を取得できませんでした（前回までの記録で生成します）: ' + e.message);
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(arc));
  }
}
