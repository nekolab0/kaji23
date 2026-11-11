// IndexNow（Bing など）に、新しくできたページと中身が変わったページの URL を知らせる。Google は対象外（Google はサイトマップで拾う）
// 公開の前に送ると Bing が 404 を取りに来るので、2段に分ける（SEO 担当の決定 2026-11-11）
//   node collector/indexnow.mjs            … build ジョブ：送る URL を indexnow/urls.json に書き出し、送ったものとして記録する
//   node collector/indexnow.mjs --send     … 公開のあとのジョブ：indexnow/urls.json を送る
// 送るのは (1) dist/sitemap-*.xml の URL のうち、まだ知らせていないもの (2) 今日中身が変わったもの（dist/data/_changed_today.json）。1回1万件まで
// 初回（data/raw/indexnow_sent.json がない）は全部を送らず、記録だけ作る
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const h = u => createHash('sha1').update(u).digest('hex').slice(0, 10);   // 記録は URL の短いハッシュ（ファイルを小さく）
const root = new URL('..', import.meta.url);
const key = fs.readFileSync(new URL('site/indexnow_key.txt', root), 'utf8').trim();
const host = (process.env.SITE_URL || 'https://kajisoku.jp').replace(/\/$/, '');
const outFile = new URL('indexnow/urls.json', root);

if (process.argv.includes('--send')) {
  if (!fs.existsSync(outFile)) { console.log('送る URL なし'); process.exit(0); }
  const batch = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  if (!batch.length) { console.log('送る URL なし'); process.exit(0); }
  const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(host).host, key, keyLocation: `${host}/${key}.txt`, urlList: batch }) }).catch(e => ({ status: 'error ' + e.message }));
  console.log(`IndexNow: ${batch.length}件 → ${r.status}`);
  process.exit(0);
}

const dist = new URL('dist/', root);
const urls = fs.readdirSync(dist).filter(f => /^sitemap-.+\.xml$/.test(f))
  .flatMap(f => [...fs.readFileSync(new URL(f, dist), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
const chFile = new URL('data/_changed_today.json', dist);
const inMap = new Set(urls);
const changed = fs.existsSync(chFile) ? JSON.parse(fs.readFileSync(chFile, 'utf8')).filter(u => inMap.has(u)) : [];
const sentFile = new URL('data/raw/indexnow_sent.json', root);
const first = !fs.existsSync(sentFile);
const sent = new Set(first ? [] : JSON.parse(fs.readFileSync(sentFile, 'utf8')));
fs.mkdirSync(new URL('indexnow/', root), { recursive: true });
if (first) { fs.writeFileSync(sentFile, JSON.stringify(urls.map(h))); fs.writeFileSync(outFile, '[]'); console.log(`初回: ${urls.length}件を記録（送信なし）`); process.exit(0); }
const fresh = urls.filter(u => !sent.has(h(u)));
const batch = [...new Set([...fresh, ...changed])].slice(0, 10000);
fs.writeFileSync(outFile, JSON.stringify(batch));
batch.forEach(u => sent.add(h(u)));
const now = new Set(urls.map(h));
fs.writeFileSync(sentFile, JSON.stringify([...sent].filter(x => now.has(x))));
console.log(`IndexNow の送信予定: 新しいページ ${fresh.length}件・今日変わったページ ${changed.length}件 → ${batch.length}件（公開のあとに送る）`);
