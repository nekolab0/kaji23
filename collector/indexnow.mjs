// IndexNow（Bing など）に、新しくできたページの URL を知らせる。Google は対象外（Google はサイトマップで拾う）
// - dist/sitemap-*.xml の URL のうち、まだ知らせていないものだけを送る（data/raw/indexnow_sent.json に記録）
// - 初回は全部を送らず、記録だけ作る（大量送信を避ける）
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const h = u => createHash('sha1').update(u).digest('hex').slice(0, 10);   // 記録は URL の短いハッシュ（ファイルを小さく）
const root = new URL('..', import.meta.url);
const key = fs.readFileSync(new URL('site/indexnow_key.txt', root), 'utf8').trim();
const host = (process.env.SITE_URL || 'https://kajisoku.jp').replace(/\/$/, '');
const dist = new URL('dist/', root);
const urls = fs.readdirSync(dist).filter(f => /^sitemap-\d+\.xml$/.test(f))
  .flatMap(f => [...fs.readFileSync(new URL(f, dist), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
const sentFile = new URL('data/raw/indexnow_sent.json', root);
const first = !fs.existsSync(sentFile);
const sent = new Set(first ? [] : JSON.parse(fs.readFileSync(sentFile, 'utf8')));
const fresh = urls.filter(u => !sent.has(h(u)));
if (first) { fs.writeFileSync(sentFile, JSON.stringify(urls.map(h))); console.log(`初回: ${urls.length}件を記録（送信なし）`); process.exit(0); }
if (!fresh.length) { console.log('新しいページなし'); process.exit(0); }
const batch = fresh.slice(0, 10000);
const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(host).host, key, keyLocation: `${host}/${key}.txt`, urlList: batch }) }).catch(e => ({ status: 'error ' + e.message }));
console.log(`IndexNow: ${batch.length}件 → ${r.status}`);
if (r.status === 200 || r.status === 202) { batch.forEach(u => sent.add(h(u))); const now = new Set(urls.map(h)); fs.writeFileSync(sentFile, JSON.stringify([...sent].filter(x => now.has(x)))); }
