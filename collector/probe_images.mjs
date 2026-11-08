// 調査用: 読み物に使えそうな「商用利用できる」写真の候補を集める（Wikimedia Commons。CC0・パブリックドメイン・CC BY・CC BY-SA のみ）
// 出力: verify/images/*.jpg（確認用の幅800の画像）と verify/images/list.json（作者・ライセンス・元ページ）
import fs from 'node:fs';
const OUT = new URL('../verify/images/', import.meta.url); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const Q = JSON.parse(fs.readFileSync(new URL('../verify/images_q.json', import.meta.url), 'utf8'));
const UA = 'kaji23-bot/1.0 (+https://kajisoku.jp/about.html; contact@kajisoku.jp)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const list = [];
for (const { key, q, n = 6 } of Q) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=40'
    + `&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=800`;
  let pages = [];
  try { const r = await fetch(api, { headers: { 'User-Agent': UA } }); pages = Object.values((await r.json()).query?.pages || {}).sort((a, b) => a.index - b.index); } catch (e) { console.log('err', q, e.message); }
  let k = 0;
  for (const p of pages) {
    if (k >= n) break;
    const ii = (p.imageinfo || [])[0]; if (!ii) continue;
    const m = ii.extmetadata || {};
    const lic = strip(m.LicenseShortName?.value);
    if (!/^(CC0|Public domain|CC BY(-SA)? \d)/i.test(lic)) continue;
    if ((ii.width || 0) < 1200 || ii.width < ii.height) continue;   // 横長・十分な大きさ
    const file = `${key}-${k + 1}.jpg`;
    try { const r = await fetch(ii.thumburl, { headers: { 'User-Agent': UA } }); if (!r.ok) continue; fs.writeFileSync(new URL(file, OUT), Buffer.from(await r.arrayBuffer())); } catch (e) { continue; }
    list.push({ key, q, file, title: p.title.replace(/^File:/, ''), creator: strip(m.Artist?.value).slice(0, 80), license: lic, license_url: m.LicenseUrl?.value || '', landing: ii.descriptionurl, url: ii.url, width: ii.width, height: ii.height, desc: strip(m.ImageDescription?.value).slice(0, 160) });
    k++; await sleep(400);
  }
  console.log(key, q, pages.length, k);
}
fs.writeFileSync(new URL('list.json', OUT), JSON.stringify(list, null, 1));
