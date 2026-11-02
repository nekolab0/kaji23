// 公式ページとの再照合（サーバー用）: サイトに載せた値と見出しが、今の東京消防庁のページ上にあるか
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'data', '_model.json'), 'utf8'));
const clean = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[０-９．，－＋]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[\s 　]+/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; let n = 0, st = 0;
for (const s of Object.values(m.stations)) {
  if (s.status === 'unpublished') continue; st++;
  let t; try { await sleep(800); t = clean(await (await fetch(s.url, { headers: { 'User-Agent': 'kaji23-verify/1.0' } })).text()); } catch (e) { fails.push(`${s.slug}:取得失敗`); continue; }
  for (const [k, v] of Object.entries(s.src)) {
    n++; const val = v.split('＝').pop();
    if (!t.includes(clean(val))) fails.push(`${s.slug}.${k}:値「${val}」がページにない`);
    for (const l of v.split('＝')[0].split('｜').filter(x => x && x.length < 20 && !x.includes('|')))
      if (!t.includes(clean(l).replace(/\//g, '')) && !l.split('/').every(p => t.includes(clean(p)))) fails.push(`${s.slug}.${k}:見出し「${l}」がページにない`);
  }
}
fs.writeFileSync(path.join(root, 'verify', 'live.json'), JSON.stringify({ at: new Date().toISOString(), checked: n, stations: st, fails, method: 'サーバーから各消防署ページを取得し直して照合' }));
console.log(fails.length ? 'LIVE CHECK FAILED: ' + fails.join(' / ') : `LIVE CHECK PASSED (${n} values, ${st} stations)`);
process.exit(fails.length ? 1 : 0);
