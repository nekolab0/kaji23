// 調査用: 読み物に使えそうな「商用利用できる」写真の候補を集める（Openverse = Wikimedia Commons・Flickr などの CC 画像の検索）
// 出力: verify/images/*.jpg（確認用の小さい画像）と verify/images/list.json（作者・ライセンス・元ページ）
import fs from 'node:fs';
const OUT = new URL('../verify/images/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const Q = JSON.parse(fs.readFileSync(new URL('../verify/images_q.json', import.meta.url), 'utf8'));
const UA = 'kaji23-bot/1.0 (+https://kajisoku.jp/about.html)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const list = [];
for (const { key, q, n = 6 } of Q) {
  const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license_type=commercial&page_size=${n * 2}&mature=false&aspect_ratio=wide`;
  let res = [];
  try { const r = await fetch(u, { headers: { 'User-Agent': UA } }); res = (await r.json()).results || []; } catch (e) { console.log('err', q, e.message); }
  let k = 0;
  for (const x of res) {
    if (k >= n) break;
    if ((x.width || 0) < 1200) continue;
    const file = `${key}-${k + 1}.jpg`;
    try {
      const r = await fetch(x.thumbnail || x.url, { headers: { 'User-Agent': UA } });
      if (!r.ok) continue;
      fs.writeFileSync(new URL(file, OUT), Buffer.from(await r.arrayBuffer()));
    } catch (e) { continue; }
    list.push({ key, q, file, title: x.title, creator: x.creator, license: x.license, license_version: x.license_version, license_url: x.license_url, source: x.source, landing: x.foreign_landing_url, url: x.url, width: x.width, height: x.height, attribution: x.attribution });
    k++; await sleep(300);
  }
  console.log(key, q, k);
}
fs.writeFileSync(new URL('list.json', OUT), JSON.stringify(list, null, 1));
