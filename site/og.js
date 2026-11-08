// OGP画像（1200×630）を区ごとに生成。SNSで共有されたときのカード画像。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIST = path.resolve(__dirname, '..', 'dist');
const model = JSON.parse(fs.readFileSync(path.join(DIST, 'data', '_model.json'), 'utf8'));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const css = `*{box-sizing:border-box;margin:0}body{width:1200px;height:630px;background:#fff;font-family:"Noto Sans CJK JP",sans-serif;color:#15171c;display:flex;flex-direction:column;padding:56px 64px;gap:22px;border-top:18px solid #c2341c}
.brand{display:flex;align-items:center;gap:12px;font-weight:900;font-size:30px}.brand b{color:#c2341c}
h1{font-size:72px;font-weight:900;line-height:1.15;letter-spacing:.01em}
.row{display:flex;gap:28px;align-items:flex-end}.big{font-size:150px;font-weight:900;line-height:.9;color:#c2341c;letter-spacing:-.02em}.big small{font-size:44px;color:#15171c;margin-left:6px}
.sub{font-size:30px;color:#535b68;line-height:1.5}.chip{display:inline-block;background:#fbe9e5;color:#9e2914;border-radius:999px;padding:6px 20px;font-size:28px;font-weight:700}
.foot{margin-top:auto;font-size:24px;color:#535b68;display:flex;justify-content:space-between}`;
const icon = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c2341c" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-10z"/></svg>';

function wardHTML(w) {
  return `<style>${css}</style><div class="brand">${icon}<span>火事<b>速</b></span></div>
<h1>${esc(w.name)}で火事？<br>いま、どこで。</h1>
<div class="sub">サイレン・煙の目撃情報と口コミを、町名ごとにリアルタイムで。<br>${esc(w.name)}の町名から探せます。</div>
<span class="chip">近づかない・火や煙が見えたら119番</span>
<div class="foot"><span>近所の人の報告＋報道＋東京消防庁の公開データ</span><span>kajisoku.jp</span></div>`;
}
function indexHTML() {
  return `<style>${css}</style><div class="brand">${icon}<span>火事<b>速</b></span></div>
<h1>今、どこで<br>火事が起きている？</h1>
<div class="sub">全国の火事の目撃情報・口コミ・報道を、<br>都道府県・市区町村・町ごとにリアルタイムで。</div>
<span class="chip">見た・聞いたを報告して、近所と共有</span>
<div class="foot"><span>近所の人の報告＋報道＋東京消防庁の公開データ</span><span>火や煙を見たら119番</span></div>`;
}
function liveHTML() {
  return `<style>${css}</style><div class="brand">${icon}<span>火事<b>速</b></span></div>
<h1>火事の目撃情報</h1>
<div class="sub">いま近所の人から寄せられている<br>サイレン・煙・火の報告と、現場の口コミ。</div>
<span class="chip">近づかない・火や煙が見えたら119番</span>
<div class="foot"><span>全国・町名ごとにリアルタイム</span><span>kajisoku.jp</span></div>`;
}

// 写真は setContent では相対パスで読めないので、data URI に埋め込む
function inlineImg(h) {
  return String(h || '').replace(/src="(assets\/img\/[^"]+)"/g, (m, p) => {
    const f = path.join(DIST, p);
    if (!fs.existsSync(f)) return m;
    const type = /\.png$/.test(p) ? 'image/png' : /\.webp$/.test(p) ? 'image/webp' : 'image/jpeg';
    return `src="data:${type};base64,${fs.readFileSync(f).toString('base64')}"`;
  });
}
function guideHTML(g) {
  return `<style>${css}.g{display:flex;gap:36px;align-items:center;flex:1}.g h1{font-size:60px;flex:1}.g .art{width:470px;flex:none}.g .art svg,.g .art img{width:100%;height:auto;border-radius:16px;display:block}.g .art .g-credit{display:none}</style>
<div class="brand">${icon}<span>火事<b>速</b></span><span style="font-size:24px;color:#535b68;font-weight:700;margin-left:10px">火事の調べ方・備え</span></div>
<div class="g"><h1>${esc(g.h1)}</h1><div class="art">${inlineImg(g.hero)}</div></div>
<div class="foot"><span>図解でわかる・出典つき</span><span>kajisoku.jp</span></div>`;
}
const guides = fs.existsSync(path.join(DIST, 'data', '_guides.json')) ? JSON.parse(fs.readFileSync(path.join(DIST, 'data', '_guides.json'), 'utf8')) : [];

(async () => {
  const out = path.join(DIST, 'og');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const jobs = [['index', indexHTML()], ['live', liveHTML()]].concat(model.wards.map(w => [w.slug, wardHTML(w)])).concat(guides.map(g => ['g-' + g.slug, guideHTML(g)]));
  for (const [name, html] of jobs) {
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(out, name + '.png'), type: 'png' });
  }
  await browser.close();
  console.log('og images:', jobs.length);
})();
