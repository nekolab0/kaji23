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
  const has = w.ytd !== null && w.ytd !== undefined;
  const d = has && w.prev !== null && w.prev !== undefined ? w.ytd - w.prev : null;
  return `<style>${css}</style><div class="brand">${icon}<span>火事どこ<b>23区</b></span></div>
<h1>${esc(w.name)}の火事・火災件数</h1>
${has ? `<div class="row"><span class="big">${w.ytd}<small>件</small></span><div class="sub">2026年これまでの火災<br>${w.complete ? '区内全消防署の合計' : '掲載している消防署の合計'}</div></div>
${d !== null ? `<span class="chip">前年同時期 ${w.prev}件 → ${d > 0 ? '+' : ''}${d}件</span>` : ''}` : `<div class="sub">消防署ごとの情報と管轄の町名</div>`}
<div class="foot"><span>出典：東京消防庁 各消防署の公開データ</span><span>火や煙を見たら119番</span></div>`;
}
function indexHTML() {
  const f = model.daily.rows['火災件数'] || {};
  return `<style>${css}</style><div class="brand">${icon}<span>火事どこ<b>23区</b></span></div>
<h1>東京23区の火事、<br>どこで何件？</h1>
<div class="sub">58消防署の火災件数を、区・消防署・町名ごとに。<br>東京消防庁の公開データを毎日集計しています。</div>
<div class="foot"><span>東京消防庁管内 今年の火災 ${f.ytd ? f.ytd.toLocaleString() : '—'}件（速報値）</span><span>火や煙を見たら119番</span></div>`;
}

(async () => {
  const out = path.join(DIST, 'og');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const jobs = [['index', indexHTML()]].concat(model.wards.map(w => [w.slug, wardHTML(w)]));
  for (const [name, html] of jobs) {
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(out, name + '.png'), type: 'png' });
  }
  await browser.close();
  console.log('og images:', jobs.length);
})();
