// 自動チェック: データの正しさ ＋ 表示の崩れ・エラー
// 使い方: node verify.js  → verify/report.json を書き出し、失敗があれば終了コード1
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'verify');
fs.mkdirSync(OUT, { recursive: true });

const latest = p => fs.readdirSync(RAW).filter(f => f.startsWith(p)).sort().pop();
const raw = JSON.parse(fs.readFileSync(path.join(RAW, latest('tfd_')), 'utf8'));
const pop = JSON.parse(fs.readFileSync(path.join(RAW, latest('pop_')), 'utf8'));
const model = JSON.parse(fs.readFileSync(path.join(DIST, 'data', '_model.json'), 'utf8'));
const contacts = JSON.parse(fs.readFileSync(path.join(RAW, 'contacts.json'), 'utf8'));
const news = fs.existsSync(path.join(RAW, 'news.json')) ? JSON.parse(fs.readFileSync(path.join(RAW, 'news.json'), 'utf8')) : { incidents: [] };
const SENSITIVE = /自殺|死のう|心中|自ら火|焼身/;
const checks = [];
const add = (name, ok, detail, level = 'error') => checks.push({ name, ok: !!ok, level, detail: String(detail).slice(0, 600) });
const z2h = s => String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
const valOf = src => { const m = z2h(String(src).split('＝').pop()).replace(/,/g, '').match(/-?\d+/); return m ? Number(m[0]) : null; };

// ================= データ =================
(function dataChecks() {
  const st = raw.stations, wd = raw.wards;
  // D1 構造
  const owner = {};
  wd.forEach(w => Object.keys(w.st).forEach(s => (owner[s] = owner[s] || []).push(w.slug)));
  const multi = Object.entries(owner).filter(([, v]) => v.length !== 1);
  const orphan = Object.keys(st).filter(s => !owner[s]);
  add('D1 区と消防署の構造', wd.length === 23 && Object.keys(st).length === 58 && !multi.length && !orphan.length,
    `区${wd.length}・署${Object.keys(st).length}・複数区にまたがる署${multi.length}・どの区にも属さない署${orphan.length}`);

  // D2 出典の行と値の一致
  const bad = [];
  let n = 0;
  for (const [slug, s] of Object.entries(st)) {
    if (s.y !== null) { n++; if (!s.src || valOf(s.src.ytd) !== s.y) bad.push(`${slug}:今年${s.y}≠「${s.src && s.src.ytd}」`); }
    if (s.p !== null) { n++; if (!s.src || valOf(s.src.prevSame) !== s.p) bad.push(`${slug}:前年同期${s.p}≠「${s.src && s.src.prevSame}」`); }
    for (const [y, v] of Object.entries(s.a || {})) { n++; if (!s.src || valOf(s.src['y' + y]) !== v) bad.push(`${slug}:${y}年${v}≠「${s.src && s.src['y' + y]}」`); }
  }
  add('D2 すべての値が出典の行と一致', !bad.length, bad.length ? bad.join(' / ') : `${n}個の値すべてで、読み取った行の数値と一致`);

  // D3 値の妥当性
  const odd = [];
  for (const [slug, s] of Object.entries(st)) {
    const all = [s.y, s.p, ...Object.values(s.a || {})].filter(v => v !== null);
    if (all.some(v => !Number.isInteger(v) || v < 0 || v > 800)) odd.push(`${slug}:範囲外`);
    if (s.y !== null && s.p !== null && s.p > s.y * 3 + 30) odd.push(`${slug}:前年同期が不自然`);
    const yrs = Object.keys(s.a || {}).map(Number);
    if (yrs.some(y => y < 2015 || y >= 2026)) odd.push(`${slug}:年が不正`);
    if (s.s === 'ok' && s.y === null) odd.push(`${slug}:状態okなのに今年の値なし`);
  }
  add('D3 値の範囲と整合性', !odd.length, odd.length ? odd.join(' / ') : '全署 0〜800件の整数、年は2015〜2025、状態と値が一致');

  // D4 区の合計
  const sumBad = [];
  for (const w of model.wards) {
    const ss = w.stations.map(s => model.stations[s]);
    const ok = ss.filter(s => s.status === 'ok');
    const ytd = ok.length ? ok.reduce((a, s) => a + s.ytd, 0) : null;
    if (ytd !== w.ytd) sumBad.push(`${w.name}:${w.ytd}≠${ytd}`);
    const complete = ok.length === ss.length;
    const per = complete && ytd !== null ? Math.round(ytd / w.pop * 1e6) / 10 : null;
    if (per !== w.per100k) sumBad.push(`${w.name}:10万人あたり${w.per100k}≠${per}`);
  }
  add('D4 区の合計と人口あたり件数の再計算', !sumBad.length, sumBad.length ? sumBad.join(' / ') : '23区すべて、署の合計・10万人あたりを再計算して一致');

  // D5 人口の検算
  const ps = Object.values(pop.wards).reduce((a, w) => a + w.pop, 0);
  const hs = Object.values(pop.wards).reduce((a, w) => a + w.households, 0);
  add('D5 人口の検算（23区の合計＝区部計）', ps === pop.kubu_total.pop && hs === pop.kubu_total.households, `人口${ps.toLocaleString()}／区部計${pop.kubu_total.pop.toLocaleString()}、世帯${hs.toLocaleString()}／${pop.kubu_total.households.toLocaleString()}`);

  // D6 鮮度（警告扱い）
  const fetched = new Date(raw.fetchedAt);
  const stale = Object.entries(st).filter(([, s]) => s.s === 'ok').filter(([, s]) => {
    const w = s.as || s.up; if (!w) return true;
    const m = w.match(/(\d{4})-(\d{2})-(\d{2}|末)/); if (!m) return true;
    const d = new Date(+m[1], +m[2] - 1, m[3] === '末' ? 28 : +m[3]);
    return (fetched - d) / 864e5 > 45;
  }).map(([k]) => k);
  add('D6 各署ページの鮮度（45日以内）', !stale.length, stale.length ? `45日以上前の掲載、または日付不明：${stale.join('、')}（署側の更新待ち。サイトでは時点を明記）` : 'すべて45日以内', 'warn');

  // D7 日次速報
  const f = raw.daily.rows['火災件数'];
  add('D7 東京消防庁の日次速報', f && f.ytd > 1000 && f.day >= 0 && f.day < 200 && raw.daily.label, f ? `${raw.daily.label}：火災${f.day}件、累計${f.ytd}件` : '火災件数なし');

  // D8 町名
  const towns = wd.flatMap(w => Object.values(w.st).flat());
  const digitStart = towns.filter(t => /^\d/.test(t) && !/^\d番町$/.test(t));
  add('D8 町名と管轄の対応', towns.length > 950 && digitStart.length <= 1, `${towns.length}地区。町名が数字で始まるもの：${digitStart.join('、') || 'なし'}（元の表の表記）`, digitStart.length <= 1 ? 'error' : 'warn');

  // D9 電話番号
  const dial = fs.readFileSync(path.join(DIST, 'dial.html'), 'utf8');
  const tels = contacts.items.map(c => c.tel);
  add('D9 電話番号の掲載', tels.every(t => dial.includes(t)), tels.join('、'));

  // N1 報道から取り出した火事のデータ
  const townBase = {};
  wd.forEach(w => { townBase[w.name] = new Set(Object.values(w.st).flat().map(t => t.replace(/[0-9０-９].*$/, '').replace(/（.*$/, ''))); });
  const extra = JSON.parse(fs.readFileSync(path.join(RAW, 'towns_extra.json'), 'utf8'));
  Object.entries(extra.wards).forEach(([k, v]) => v.towns.forEach(t => townBase[k].add(t)));

  // D10 町ページ
  const perWard = {}; model.towns.forEach(t => { perWard[t.ward] = (perWard[t.ward] || 0) + 1; });
  const noTown = wd.filter(w => !perWard[w.name]).map(w => w.name);
  const missing = model.towns.filter(t => !fs.existsSync(path.join(DIST, t.file))).map(t => t.file);
  add('D10 町ページ', model.towns.length >= 900 && !noTown.length && !missing.length, `${model.towns.length}町（渋谷区${perWard['渋谷区']}・目黒区${perWard['目黒区']}町を含む）${noTown.length ? '／町のない区：' + noTown.join('、') : ''}${missing.length ? '／ページなし：' + missing.slice(0, 5).join('、') : ''}`);
  const nb = [], ids = new Set();
  const col = new Date(news.collectedAt || Date.now());
  for (const x of news.incidents) {
    if (!townBase[x.ward]) nb.push(`${x.id}:23区以外`);
    else if (x.town && !townBase[x.ward].has(x.town)) nb.push(`${x.id}:町名が区の管轄表にない`);
    if (!x.sources.length || x.sources.length > 3 || x.sources.some(s => !/^https:\/\//.test(s.link) || !s.name)) nb.push(`${x.id}:報道元のリンク不正`);
    const age = (col - new Date(x.first)) / 864e5;
    if (!(age >= -0.1 && age <= 30)) nb.push(`${x.id}:日付が30日の範囲外`);
    if (ids.has(x.id)) nb.push(`${x.id}:重複`); ids.add(x.id);
  }
  add('N1 報道された火事のデータ', !nb.length, nb.join(' / ') || `${news.incidents.length}件。区・町名は消防署の管轄表と一致、報道元リンクはhttps、30日以内、重複なし`);

  // W1 サイレン報告の受付サーバー（Cloudflare Worker）の動作テスト
  const wp = path.join(OUT, 'worker.json');
  if (fs.existsSync(wp)) { const W = JSON.parse(fs.readFileSync(wp, 'utf8')); const f = W.results.filter(r => !r.ok);
    add('W1 サイレン報告の受付サーバー', !f.length && W.results.length >= 10, f.length ? f.map(r => r.name).join(' / ') : `${W.results.length}項目すべて合格（火事へのまとめ・口コミの禁止事項・通報で非表示・共有ページ・連投制限・IPを保存しない）`);
  } else add('W1 サイレン報告の受付サーバー', false, '未実施（node worker/test.mjs）');
})();

// ================= 表示 =================
(async function renderChecks() {
  const allPages = fs.readdirSync(DIST).filter(f => f.endsWith('.html'));
  const machi = allPages.filter(f => f.startsWith('m-')).sort();
  // ブラウザで開くのは、町ページ以外の全ページ＋町ページの見本（25ページに1つ）
  const pages = allPages.filter(f => !f.startsWith('m-')).concat(machi.filter((f, i) => i % 25 === 0));
  const browser = await chromium.launch();

  // 受付サーバーの代わりに、本物の処理（worker/src/index.js）を検査用のSQLiteで動かす
  const { handle } = await import(path.join(ROOT, 'worker', 'src', 'index.js'));
  const { makeEnv } = await import(path.join(ROOT, 'worker', 'test.mjs'));
  let W = makeEnv();
  const API = (fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').match(/name="kaji23-api" content="([^"]*)"/) || [])[1] || '';
  let clock = 0;
  const apiRoute = async r => {
    const q = r.request();
    const res = await handle(new Request(q.url(), { method: q.method(), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.' + (clock % 250) },
      body: q.method() === 'POST' ? q.postData() : undefined }), { ...W.env, ALLOW_ORIGIN: '*' }, new Date(Date.now() + clock * 61e3));
    const h = {}; res.headers.forEach((v, k) => { h[k] = v; });
    return r.fulfill({ status: res.status, headers: h, body: await res.text() });
  };
  const mkctx = async (width, opts = {}) => {
    const c = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500, ...opts });
    // フォントCDNは作業環境から到達できないため遮断（公開先では読み込まれる）
    await c.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    // 後に登録した経路が優先される: まず外部への送信を止め、そのうえで受付サーバーと地理院を代役に
    await c.route(/workers\.dev|x\.com|twitter\.com|yahoo\.co\.jp|news\.google\.com/, r => r.abort()); // 本番・外部へは送らない
    if (API) await c.route(u => u.href.startsWith(API + '/'), apiRoute);
    await c.route(/mreversegeocoder\.gsi\.go\.jp/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ results: { muniCd: '13117', lv01Nm: '赤羽西二丁目' } }) }));
    return c;
  };
  const consoleErr = [], reqFail = [], overflow = [], links = [], meta = [], numbers = [];
  const fileSet = new Set(fs.readdirSync(DIST, { recursive: true }).map(String));

  // R4・R5 は全ページをファイルのまま確かめる（町ページ900超を全部ブラウザで開かない）
  for (const f of allPages) {
    const h = fs.readFileSync(path.join(DIST, f), 'utf8');
    const title = (h.match(/<title>([^<]*)<\/title>/) || [])[1];
    const h1 = (h.match(/<h1[\s>]/g) || []).length;
    const desc = /<meta name="description" content="[^"]+"/.test(h);
    const og = (h.match(/property="og:image" content="([^"]+)"/) || [])[1];
    if (!title || h1 !== 1 || !desc || !og || !fileSet.has(og)) meta.push(`${f}: title=${!!title} h1=${h1} desc=${desc} og=${og}`);
    for (const m of h.matchAll(/<a [^>]*href="([^"]+)"/g)) {
      const href = m[1].replace(/&amp;/g, '&');
      if (/^(https?:|mailto:|tel:)/.test(href)) continue;
      const [file0, hash] = href.split('#'); const file = decodeURIComponent((file0 || f).split('?')[0]);
      if (!fileSet.has(file)) { links.push(`${f} → ${href}（ファイルなし）`); continue; }
      if (hash && !fs.readFileSync(path.join(DIST, file), 'utf8').includes(`id="${hash}"`)) links.push(`${f} → ${href}（#${hash}なし）`);
    }
  }

  for (const width of [375, 1280]) {
    const wctx = await mkctx(width);
    const page = await wctx.newPage();
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text()) && !/ERR_FAILED/.test(m.text())) consoleErr.push(`${width}px ${decodeURIComponent(page.url().split('/').pop())}: ${m.text()}`); });
    page.on('pageerror', e => consoleErr.push(`${width}px ${decodeURIComponent(page.url().split('/').pop())}: ${e.message}`));
    page.on('requestfailed', r => { if (!/fonts\.g|x\.com|twitter|yahoo|google|workers\.dev/.test(r.url())) reqFail.push(`${r.url()} ${r.failure() && r.failure().errorText}`); });
    for (const f of pages) {
      await page.goto('file://' + path.join(DIST, f), { waitUntil: 'load' });
      await page.waitForTimeout(f === 'index.html' || f.startsWith('m-') || f === 'fire.html' ? 150 : 0);
      const realW = await page.evaluate(() => window.innerWidth);
      if (realW !== width) overflow.push(`${width}px ${f}: 表示幅が${realW}px（viewport設定が効いていない）`);
      const o = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth;
        const wide = [...document.querySelectorAll('body *')].filter(el => {
          if (el.closest('.table-box') || el.closest('.nav') || el.closest('script') || el.closest('.sr')) return false;
          const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1);
        }).slice(0, 3).map(el => el.tagName + '.' + el.className);
        return { vw, sw, wide };
      });
      if (o.sw > o.vw + 1 || o.wide.length) overflow.push(`${width}px ${f}: ページ幅${o.sw}/${o.vw} ${o.wide.join(',')}`);
    }
    await wctx.close();
  }

  // R6 区ページに出ている数字 ＝ データ
  const ctx = await mkctx(375);
  const page = await ctx.newPage();
  for (const w of model.wards) {
    await page.goto('file://' + path.join(DIST, w.slug + '.html'));
    const shown = await page.evaluate(() => ({
      ward: (document.querySelector('.stat.hot .v') || {}).textContent || null,
      cards: [...document.querySelectorAll('.st-card')].map(c => ({ id: c.id, big: (c.querySelector('.big') || {}).textContent || '' }))
    }));
    const wv = shown.ward ? parseInt(shown.ward, 10) : null;
    if (w.ytd !== null && wv !== w.ytd) numbers.push(`${w.name}: 表示${wv}≠データ${w.ytd}`);
    for (const c of shown.cards) {
      const s = model.stations[c.id.replace('st-', '')];
      const v = parseInt(c.big, 10);
      if (s.status === 'ok' && v !== s.ytd) numbers.push(`${s.name}: 表示${v}≠${s.ytd}`);
      if (s.status === 'annual-only') { const last = Math.max(...Object.keys(s.annual).map(Number)); if (v !== s.annual[last]) numbers.push(`${s.name}: 年間表示${v}≠${s.annual[last]}`); }
    }
  }
  // R9 出典ボックスの行ラベル
  const provBad = [];
  for (const w of model.wards) {
    await page.goto('file://' + path.join(DIST, w.slug + '.html'));
    const labs = await page.$$eval('.prov > span', ss => ss.map(s => s.textContent.trim()));
    labs.filter(l => !/^(出典|確認先|※)/.test(l)).forEach(l => { if (!/^(今年の件数|前年同時期|\d{4}年)：/.test(l)) provBad.push(`${w.name}:「${l.slice(0, 30)}」`); });
  }
  // R10 報道の表示: 区ページの件数＝データ、見出し文や配慮の要る語を出していない、町ページへの振り分け
  const newsBad = [];
  for (const w of model.wards) {
    await page.goto('file://' + path.join(DIST, w.slug + '.html'));
    const items = await page.$$eval('.news-item', els => els.map(e => e.textContent));
    const want = news.incidents.filter(x => x.ward === w.name);
    if (items.length !== want.length) newsBad.push(`${w.name}:表示${items.length}≠データ${want.length}`);
    items.forEach(t => { if (SENSITIVE.test(t)) newsBad.push(`${w.name}:配慮の要る語`); if (t.length > 160) newsBad.push(`${w.name}:長すぎる（見出し文の転載の疑い）`); });
    want.filter(x => x.sensitive).forEach(() => { if (items.some(t => /亡くなった方|けが人/.test(t))) newsBad.push(`${w.name}:配慮対象に死傷を表示`); });
  }
  for (const x of news.incidents.filter(x => x.town)) {
    const t = model.towns.find(t => t.ward === x.ward && t.base === x.town);
    if (!t) { newsBad.push(`${x.id}:町ページなし`); continue; }
    const h = fs.readFileSync(path.join(DIST, t.file), 'utf8');
    if (!h.includes(encodeURIComponent('n-' + x.id).replace(/%2D/g, '-')) && !h.includes('n-' + x.id)) newsBad.push(`${t.file}:報道が出ていない`);
  }
  await page.goto('file://' + path.join(DIST, 'index.html'));
  const topNews = await page.$$eval('.news-item', els => els.length);
  if (topNews !== Math.min(6, news.incidents.length)) newsBad.push(`トップ:表示${topNews}`);

  // R7 町名検索と現在地
  const searchBad = [];
  await page.fill('#q', '赤羽西');
  const r1 = await page.$$eval('.q-results a', as => as.map(a => a.getAttribute('href')));
  if (r1[0] !== 'm-kita-赤羽西.html') searchBad.push(`「赤羽西」の先頭が${r1[0]}`);
  await page.fill('#q', 'さんげんぢゃや'); // ひらがなは対象外でも落ちない
  await page.fill('#q', '恵比寿');
  const r2 = await page.$$eval('.q-results a', as => as.map(a => a.getAttribute('href')));
  if (!r2.includes('m-shibuya-恵比寿.html')) searchBad.push('渋谷区の町（恵比寿）が出ない');
  await page.fill('#q', '豊洲'); await page.press('#q', 'Enter'); await page.waitForURL(/m-koto-/, { timeout: 3000 }).catch(() => searchBad.push('Enterで町ページへ移動しない'));
  const gctx = await mkctx(375, { geolocation: { latitude: 35.7781, longitude: 139.7186 }, permissions: ['geolocation'] });
  const gp = await gctx.newPage();
  await gp.goto('file://' + path.join(DIST, 'index.html'));
  await gp.click('.geo-go');
  await gp.waitForURL(/m-kita-/, { timeout: 5000 }).catch(() => {});
  if (!decodeURIComponent(gp.url()).endsWith('m-kita-赤羽西.html')) searchBad.push(`現在地→${decodeURIComponent(gp.url()).split('/').pop()}`);
  await gctx.close();

  // R11 報告→火事のページ→口コミ→通報→共有（受付サーバーは本物の処理を検査用DBで）
  const flowBad = [], flowOk = [];
  if (!API) flowBad.push('受付サーバーのURLが未設定');
  else {
    W = makeEnv(); clock = 0;
    const fc = await mkctx(375); const fp = await fc.newPage(); const ferr = []; fp.on('pageerror', e => ferr.push(e.message));
    await fp.goto('file://' + path.join(DIST, 'index.html'));
    await fp.waitForSelector('.live-empty', { timeout: 5000 }).then(() => flowOk.push('報告なしの表示'), () => flowBad.push('トップ: 報告がないときの表示が出ない'));
    await fp.goto('file://' + path.join(DIST, 'm-kita-赤羽西.html'));
    await fp.fill('.report .town-in', '赤羽西二丁目3番地'); clock++;
    await fp.click('.report button[value=smoke]');
    const link = await fp.waitForSelector('.report-status a', { timeout: 5000 }).then(h => h.getAttribute('href'), () => null);
    const incId = link && decodeURIComponent(link.split('id=')[1] || '');
    const row = incId && W.db.prepare('SELECT * FROM incidents WHERE id = ?').get(incId);
    if (!row || row.town !== '赤羽西2丁目' || row.smoke !== 1) flowBad.push(`報告の保存が不正 ${JSON.stringify(row)}`); else flowOk.push('町ページから報告（番地は切り捨て）');
    await fp.waitForFunction(() => /赤羽西2丁目付近/.test((document.querySelector('[data-live]') || {}).textContent || ''), null, { timeout: 5000 })
      .then(() => flowOk.push('町ページに「いまの火事」が出る'), () => flowBad.push('町ページのいまの報告に出ない'));
    if (incId) {
      clock++; await fp.goto('file://' + path.join(DIST, 'fire.html') + '?id=' + encodeURIComponent(incId));
      await fp.waitForFunction(() => /赤羽西2丁目付近で火事/.test(document.querySelector('.f-title').textContent), null, { timeout: 5000 })
        .then(() => flowOk.push('火事のページ'), () => flowBad.push('火事のページの見出しが出ない'));
      const share = await fp.$$eval('.f-share a', as => as.map(a => a.href));
      const x = share.find(h => /twitter\.com\/intent/.test(h)) || '';
      const xt = decodeURIComponent(x);
      if (!/【火事の目撃情報】北区赤羽西2丁目付近　報告1件/.test(xt) || !xt.includes(API + '/f/' + incId) || !/#赤羽西/.test(xt)) flowBad.push(`Xの共有文が不正「${xt.slice(0, 160)}」`); else flowOk.push('X・LINEの共有文');
      const og = await (await handle(new Request(API + '/f/' + incId), W.env)).text();
      if (!/北区赤羽西2丁目付近で火事の目撃情報 1件/.test(og)) flowBad.push('共有用ページの見出しが不正'); else flowOk.push('共有用ページの見出し');
      clock++; await fp.fill('.f-comments textarea', '黒い煙が見えます。消防車が来ています');
      await fp.click('.f-comments button[type=submit]');
      await fp.waitForFunction(() => /黒い煙が見えます/.test(document.querySelector('.f-comments .com-list').textContent), null, { timeout: 5000 })
        .then(() => flowOk.push('口コミの投稿・表示'), () => flowBad.push('口コミが表示されない'));
      clock++; await fp.fill('.f-comments textarea', 'くわしくは https://example.com を見て');
      await fp.click('.f-comments button[type=submit]');
      await fp.waitForFunction(() => /URLは書き込めません/.test(document.querySelector('.f-comments .com-status').textContent), null, { timeout: 5000 })
        .then(() => flowOk.push('URL入りは断る'), () => flowBad.push('URL入りの口コミを断らない'));
      await fp.click('.f-comments .flag');
      await fp.waitForFunction(() => /通報しました/.test(document.querySelector('.f-comments .flag').textContent), null, { timeout: 5000 })
        .then(() => flowOk.push('通報'), () => flowBad.push('通報できない'));
      clock++; await fp.click('.f-report button[value=fire]');
      await fp.waitForFunction(() => /報告\s*2/.test(document.querySelector('.f-stats').textContent), null, { timeout: 5000 })
        .then(() => flowOk.push('火事のページから報告を追加'), () => flowBad.push('火事のページの報告が件数に反映されない'));
    }
    await fp.goto('file://' + path.join(DIST, 'index.html'));
    await fp.waitForFunction(() => /赤羽西2丁目付近/.test(document.querySelector('[data-live]').textContent) && /報告2/.test(document.querySelector('[data-ward-tile="北区"]').textContent), null, { timeout: 5000 })
      .then(() => flowOk.push('トップの一覧と区の地図'), () => flowBad.push('トップに出ない'));
    clock++; await fp.goto('file://' + path.join(DIST, 'm-kita-赤羽西.html'));
    await fp.fill('#board ~ .comments textarea, .comments textarea', '夜中にサイレンが多い町です');
    await fp.click('.comments button[type=submit]');
    await fp.waitForFunction(() => /夜中にサイレンが多い町です/.test(document.querySelector('.comments .com-list').textContent), null, { timeout: 5000 })
      .then(() => flowOk.push('町の口コミ掲示板'), () => flowBad.push('町の口コミが表示されない'));
    const nid = news.incidents[0] && 'n-' + news.incidents[0].id;
    if (nid) {
      await fp.goto('file://' + path.join(DIST, 'fire.html') + '?id=' + encodeURIComponent(nid));
      const nt = await fp.$eval('.f-title', e => e.textContent);
      const srcs = await fp.$$eval('.f-news a', as => as.length);
      if (!nt.includes(news.incidents[0].ward) || srcs !== news.incidents[0].sources.length) flowBad.push(`報道の火事ページが不正「${nt}」`); else flowOk.push('報道の火事ページ');
    }
    if (ferr.length) flowBad.push(ferr.join(' / '));
    await fc.close();
  }
  // 受付サーバー未設定の版では、ボタンを隠して案内だけ出す
  const TMP = path.join(OUT, 'tmp'); fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(path.join(TMP, 'assets'), { recursive: true });
  for (const f of ['site.css', 'site.js']) fs.copyFileSync(path.join(DIST, 'assets', f), path.join(TMP, 'assets', f));
  fs.writeFileSync(path.join(TMP, 'a.html'), fs.readFileSync(path.join(DIST, 'm-kita-赤羽西.html'), 'utf8').replace(/name="kaji23-api" content="[^"]*"/, 'name="kaji23-api" content=""'));
  await page.goto('file://' + path.join(TMP, 'a.html'));
  const off = await page.evaluate(() => ({ h: document.querySelector('.report-form').offsetHeight, m: document.querySelector('.report-status').textContent, c: document.querySelector('.com-form').offsetHeight }));
  if (off.h !== 0 || off.c !== 0 || !/災害情報案内/.test(off.m)) flowBad.push('受付サーバー未設定のときの表示が不正'); else flowOk.push('未設定時は案内のみ');
  await browser.close();

  add('R1 コンソールエラー・スクリプトエラー', !consoleErr.length, consoleErr.slice(0, 8).join(' / ') || `${pages.length}ページ×2画面幅でエラーなし（町ページは${machi.length}町から見本）`);
  add('R2 読み込み失敗', !reqFail.length, reqFail.slice(0, 8).join(' / ') || 'CSS・JS・画像すべて読み込み成功（Webフォント・外部サイトは作業環境の制限で除外）');
  add('R3 横はみ出し（375px・1280px）', !overflow.length, overflow.slice(0, 8).join(' / ') || 'はみ出しなし');
  add('R4 サイト内リンク・ページ内リンク', !links.length, links.slice(0, 20).join(' / ') || `${allPages.length}ページすべてのリンク先とアンカーが存在`);
  add('R5 タイトル・見出し・説明文・OGP画像', !meta.length, meta.slice(0, 10).join(' / ') || `${allPages.length}ページすべてにあり`);
  add('R6 表示されている数字＝データ', !numbers.length, numbers.join(' / ') || '23区の統計と58署のカードすべて一致');
  add('R7 町名検索・現在地', !searchBad.length, searchBad.join(' / ') || '「赤羽西」→赤羽西の町ページ、渋谷区の町も検索可、Enterで移動、現在地（北区赤羽西二丁目）→赤羽西の町ページ');
  add('R9 出典ボックスの見出し', !provBad.length, provBad.join(' / ') || '出典の各行が「今年の件数／前年同時期／○○○○年」で始まる');
  add('R10 報道された火事の表示', !newsBad.length, newsBad.join(' / ') || `区ページの件数がデータと一致（計${news.incidents.length}件）、町ページにも振り分け、見出し文・配慮の要る語は表示なし`);
  add('R11 報告・火事のページ・口コミ・共有', !flowBad.length, flowBad.join(' / ') || flowOk.join('、') + 'を確認');

  const lp = path.join(OUT, 'live.json');
  if (fs.existsSync(lp)) {
    const L = JSON.parse(fs.readFileSync(lp, 'utf8'));
    const t = new Date(new Date(L.at).getTime() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
    add('L1 公式ページとの再照合', !L.fails.length && L.checked > 0, L.fails.length ? L.fails.join(' / ') : `${t}（日本時間）に${L.stations}署のページを取り直し、${L.checked}個の値と見出しがすべて公式ページ上にあることを確認`);
  } else add('L1 公式ページとの再照合', false, '未実施');
  const now = new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + '（日本時間）';
  const report = { ran_at: now, data_fetched_at: raw.fetchedAt, checks };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const fails = checks.filter(c => !c.ok && c.level === 'error');
  for (const c of checks) console.log(`${c.ok ? 'PASS' : c.level === 'warn' ? 'WARN' : 'FAIL'}  ${c.name} — ${c.detail}`);
  console.log(fails.length ? `\n${fails.length} failure(s)` : '\nALL CHECKS PASSED');
  process.exit(fails.length ? 1 : 0);
})();
