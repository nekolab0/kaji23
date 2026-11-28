// 週のまとめの SNS 用画像（1080×1350・縦長のスライド）。backlog G8・docs/growth.md の C6。
// build.py が ops/social/weekly/<月曜>/data.json を書く。ここでは slide-1.png がまだないフォルダだけ画像を作る（できたら作り直さない）。
// 文のきまり：煽らない・けが人や番地を書かない。目立った火事は町名・日付・種別だけ。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..', 'ops', 'social', 'weekly');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const css = `*{box-sizing:border-box;margin:0}body{width:1080px;height:1350px;background:#fff;font-family:"Noto Sans CJK JP",sans-serif;color:#15171c;display:flex;flex-direction:column;padding:80px 76px;gap:34px;border-top:22px solid #c2341c}
.brand{display:flex;align-items:center;gap:14px;font-weight:900;font-size:38px}.brand b{color:#c2341c}.brand small{font-size:30px;color:#535b68;font-weight:700;margin-left:auto}
h1{font-size:76px;font-weight:900;line-height:1.2}h2{font-size:60px;font-weight:900;line-height:1.25}
.big{font-size:230px;font-weight:900;line-height:.9;color:#c2341c;letter-spacing:-.02em}.big small{font-size:64px;color:#15171c;margin-left:8px}
.sub{font-size:38px;color:#3a3f48;line-height:1.6}.note{font-size:30px;color:#535b68;line-height:1.5}
.bars{display:flex;flex-direction:column;gap:22px}.bar{display:flex;align-items:center;gap:20px;font-size:40px;font-weight:700}.bar .l{width:230px;flex:none}.bar i{display:block;height:54px;background:#c2341c;border-radius:8px}.bar .v{flex:none}
.cols{display:flex;align-items:flex-end;gap:22px;height:560px}.col{flex:1;display:flex;flex-direction:column;align-items:center;gap:12px;font-size:36px;font-weight:700;height:100%;justify-content:flex-end}.col i{display:block;width:100%;background:#c2341c;border-radius:8px 8px 0 0}
ul{list-style:none;padding:0;display:flex;flex-direction:column;gap:26px}li{font-size:42px;font-weight:700;line-height:1.35;border-left:10px solid #c2341c;padding-left:22px}li span{display:block;font-size:32px;color:#535b68;font-weight:400}
.chip{align-self:flex-start;background:#fbe9e5;color:#9e2914;border-radius:999px;padding:10px 28px;font-size:34px;font-weight:700}
.foot{margin-top:auto;font-size:32px;color:#535b68;display:flex;justify-content:space-between}`;
const icon = '<svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#c2341c" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-10z"/></svg>';
const head = (d, i, n) => `<style>${css}</style><div class="brand">${icon}<span>火事<b>速</b></span><small>${esc(d.short)}　${i}/${n}</small></div>`;
const foot = '<div class="foot"><span>火事速が記録した分のみ</span><span>kajisoku.jp</span></div>';

function slides(d) {
  const out = [];
  out.push(`<h1>${esc(d.range)}<br>全国の火事まとめ</h1>
<div class="big">${d.n.toLocaleString('ja-JP')}<small>件</small></div>
<div class="sub">報道と消防本部の発表から記録した火事。<br>うち町名まで分かったもの ${d.n_town.toLocaleString('ja-JP')}件</div>`);
  const dm = Math.max(1, ...d.days.map(x => x[1]));
  out.push(`<h2>曜日ごとの件数</h2><div class="cols">${d.days.map(([w, v]) => `<div class="col"><span>${v}</span><i style="height:${Math.round(440 * v / dm)}px"></i><span>${esc(w)}</span></div>`).join('')}</div>`);
  if (d.prefs.length) {
    const pm = Math.max(1, ...d.prefs.map(x => x[1]));
    out.push(`<h2>件数の多かった都道府県</h2><div class="bars">${d.prefs.map(([p, v]) => `<div class="bar"><span class="l">${esc(p)}</span><i style="width:${Math.round(520 * v / pm)}px"></i><span class="v">${v}件</span></div>`).join('')}</div>
<div class="note">都道府県・市区町村・町名ごとの記録は kajisoku.jp で見られます。</div>`);
  }
  if (d.kinds.length) out.push(`<h2>建物の種類</h2><ul>${d.kinds.map(([k, v]) => `<li>${esc(k)}<span>${v.toLocaleString('ja-JP')}件</span></li>`).join('')}</ul>`);
  if (d.notable.length) out.push(`<h2>町名まで分かった<br>主な火事</h2><ul>${d.notable.map(x => `<li>${esc(x.place)}<span>${esc(x.day)}${x.kind ? '・' + esc(x.kind) : ''}</span></li>`).join('')}</ul>`);
  out.push(`<h2>${d.month}月に気をつけたいこと</h2>
<div class="sub">${d.month}月は、全国で${d.nat_month.toLocaleString('ja-JP')}件の火事が起きた月です（消防庁・2024年）。</div>
<div class="sub"><strong>${esc(d.tip)}</strong></div>
<span class="chip">火や煙を見たら、近づかずに119番</span>
<div class="note">あなたの町の「いまの火事」は<br>kajisoku.jp で町名から探せます。</div>`);
  return out.map((b, i) => head(d, i + 1, out.length) + b + foot);
}

(async () => {
  if (!fs.existsSync(BASE)) return console.log('weekly social: none');
  const todo = fs.readdirSync(BASE).filter(w => fs.existsSync(path.join(BASE, w, 'data.json')) && !fs.existsSync(path.join(BASE, w, 'slide-1.png')));
  if (!todo.length) return console.log('weekly social: up to date');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  for (const w of todo) {
    const d = JSON.parse(fs.readFileSync(path.join(BASE, w, 'data.json'), 'utf8'));
    const ss = slides(d);
    for (let i = 0; i < ss.length; i++) {
      await page.setContent(ss[i], { waitUntil: 'load' });
      await page.screenshot({ path: path.join(BASE, w, `slide-${i + 1}.png`), type: 'png' });
    }
    console.log('weekly social:', w, ss.length, 'slides');
  }
  await browser.close();
})();
