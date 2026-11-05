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

  const AR = JSON.parse(fs.readFileSync(path.join(RAW, 'areas.json'), 'utf8'));
  const TJ = JSON.parse(fs.readFileSync(path.join(RAW, 'towns_jp.json'), 'utf8')).towns;
  const codeOfA = {}; Object.entries(AR.prefs).forEach(([p, l]) => l.forEach(([c, code]) => { codeOfA[p + '|' + c] = code; }));
  const parentsA = new Set(Object.entries(AR.parents).flatMap(([p, l]) => l.map(([n]) => p + '|' + n)));
  // D10 町ページ
  const perWard = {}; model.towns.forEach(t => { perWard[t.ward] = (perWard[t.ward] || 0) + 1; });
  const noTown = wd.filter(w => !perWard[w.name]).map(w => w.name);
  const missing = model.towns.filter(t => !fs.existsSync(path.join(DIST, t.file))).map(t => t.file);
  add('D10 町ページ', model.towns.length >= 900 && !noTown.length && !missing.length, `${model.towns.length}町（渋谷区${perWard['渋谷区']}・目黒区${perWard['目黒区']}町を含む）${noTown.length ? '／町のない区：' + noTown.join('、') : ''}${missing.length ? '／ページなし：' + missing.slice(0, 5).join('、') : ''}`);
  // D11 全国のデータとページ
  const nCity = Object.values(AR.prefs).reduce((a, l) => a + l.length, 0), nTown = Object.values(TJ).reduce((a, l) => a + l.length, 0);
  const prefMissing = Object.keys(AR.prefs).filter(p => !fs.existsSync(path.join(DIST, `p-${p}.html`)));
  const cityPages = fs.readdirSync(DIST).filter(f => f.startsWith('c-')).length;
  const shards = fs.readdirSync(path.join(DIST, 's')).length, townJs = fs.readdirSync(path.join(DIST, 't')).length;
  add('D11 全国のデータとページ', Object.keys(AR.prefs).length === 47 && nCity >= 1890 && nTown >= 120000 && !prefMissing.length && cityPages >= 1880 && shards === 512 && townJs >= 1880,
    `47都道府県・市区町村${nCity}・町${nTown.toLocaleString()}、都道府県ページ${47 - prefMissing.length}・市区町村ページ${cityPages}（23区は別ページ）、検索索引${shards}ファイル・町の位置${townJs}ファイル`);
  const nb = [], ids = new Set();
  const col = new Date(news.collectedAt || Date.now());
  for (const x of news.incidents) {
    const pref = x.pref || '東京都', city = x.city || x.ward, code = codeOfA[pref + '|' + city];
    if (!code && !parentsA.has(pref + '|' + city)) nb.push(`${x.id}:市区町村が一覧にない`);
    else if (x.town && code && !(TJ[code] || []).some(t => t[0] === x.town) && !(pref === '東京都' && townBase[city] && townBase[city].has(x.town))) nb.push(`${x.id}:町名が一覧にない`);
    if (!x.sources.length || x.sources.length > 3 || x.sources.some(s => !/^https:\/\//.test(s.link) || !s.name)) nb.push(`${x.id}:報道元のリンク不正`);
    const age = (col - new Date(x.first)) / 864e5;
    if (!(age >= -0.1 && age <= 30)) nb.push(`${x.id}:日付が30日の範囲外`);
    if (ids.has(x.id)) nb.push(`${x.id}:重複`); ids.add(x.id);
  }
  add('N1 報道された火事のデータ', !nb.length, nb.join(' / ') || `${news.incidents.length}件。市区町村・町名は全国の一覧と一致、報道元リンクはhttps、30日以内、重複なし`);

  // W1 サイレン報告の受付サーバー（Cloudflare Worker）の動作テスト
  const wp = path.join(OUT, 'worker.json');
  if (fs.existsSync(wp)) { const W = JSON.parse(fs.readFileSync(wp, 'utf8')); const f = W.results.filter(r => !r.ok);
    add('W1 サイレン報告の受付サーバー', !f.length && W.results.length >= 10, f.length ? f.map(r => r.name).join(' / ') : `${W.results.length}項目すべて合格（火事へのまとめ・口コミの禁止事項・通報で非表示・共有ページ・連投制限・IPを保存しない・消防の出動情報の取り込みとrobots.txt）`);
  } else add('W1 サイレン報告の受付サーバー', false, '未実施（node worker/test.mjs）');
})();

// ================= 表示 =================
(async function renderChecks() {
  const allPages = fs.readdirSync(DIST).filter(f => f.endsWith('.html'));
  const machi = allPages.filter(f => f.startsWith('m-')).sort();
  // ブラウザで開くのは、町ページ以外の全ページ＋町ページの見本（25ページに1つ）
  const cpages = allPages.filter(f => f.startsWith('c-')).sort();
  const pages = allPages.filter(f => !f.startsWith('m-') && !f.startsWith('c-')).concat(machi.filter((f, i) => i % 25 === 0), cpages.filter((f, i) => i % 60 === 0),
    ['town.html?c=23106&t=栄', 'town.html?c=14102&t=三ツ沢下町', 'fire.html?id=n-' + (news.incidents[0] ? news.incidents[0].id : '')]);
  const browser = await chromium.launch();

  // 受付サーバーの代わりに、本物の処理（worker/src/index.js）を検査用のSQLiteで動かす
  const { handle, ingestOfficial } = await import(path.join(ROOT, 'worker', 'src', 'index.js'));
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
    await c.route(/workers\.dev|api\.kajisoku\.jp|x\.com|twitter\.com|yahoo\.co\.jp|googlesyndication\.com|news\.google\.com/, r => r.abort()); // 本番・外部へは送らない
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
    const og = ((h.match(/property="og:image" content="([^"]+)"/) || [])[1] || '').replace(/^https?:\/\/.*?\/(?=og\/)/, '');
    const can = (h.match(/rel="canonical" href="([^"]+)"/) || [])[1];
    if (!can || !/^https:\/\//.test(can) || /[^\x21-\x7e]/.test(can)) meta.push(`${f}: 正規URLが不正 ${can}`);
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
    page.on('requestfailed', r => { const ft = (r.failure() && r.failure().errorText) || ''; if (/\/api\//.test(r.url()) && /ERR_ABORTED/.test(ft)) return;   // 次のページへ移るときに打ち切られた受付サーバーへの問い合わせ（表示の不具合ではない）
    if (!/fonts\.g|x\.com|twitter|yahoo|google|workers\.dev/.test(r.url())) reqFail.push(`${r.url()} ${r.failure() && r.failure().errorText}`); });
    for (const f of pages) {
      await page.goto('file://' + path.join(DIST, f.split('?')[0]) + (f.includes('?') ? '?' + f.split('?')[1].split('&').map(kv => kv.split('=').map(encodeURIComponent).join('=')).join('&') : ''), { waitUntil: 'load' });
      await page.waitForTimeout(/^(index|fire|town)\.html|^m-|^p-/.test(f) ? 200 : 0);
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
    const want = news.incidents.filter(x => (x.pref || '東京都') === '東京都' && (x.city || x.ward) === w.name);
    if (items.length !== want.length) newsBad.push(`${w.name}:表示${items.length}≠データ${want.length}`);
    items.forEach(t => { if (SENSITIVE.test(t)) newsBad.push(`${w.name}:配慮の要る語`); if (t.length > 160) newsBad.push(`${w.name}:長すぎる（見出し文の転載の疑い）`); });
    want.filter(x => x.sensitive).forEach(() => { if (items.some(t => /亡くなった方|けが人/.test(t))) newsBad.push(`${w.name}:配慮対象に死傷を表示`); });
  }
  for (const x of news.incidents.filter(x => x.town && (x.pref || '東京都') === '東京都' && model.towns.some(t => t.ward === (x.city || x.ward)))) {
    const t = model.towns.find(t => t.ward === (x.city || x.ward) && t.base === x.town);
    if (!t) { newsBad.push(`${x.id}:町ページなし`); continue; }
    const h = fs.readFileSync(path.join(DIST, t.file), 'utf8');
    if (!h.includes(encodeURIComponent('n-' + x.id).replace(/%2D/g, '-')) && !h.includes('n-' + x.id)) newsBad.push(`${t.file}:報道が出ていない`);
  }
  await page.goto('file://' + path.join(DIST, 'index.html'));
  const topNews = await page.$$eval('.news-item', els => els.length);
  if (topNews !== Math.min(12, news.incidents.length)) newsBad.push(`トップ:表示${topNews}`);

  // R7 町名検索と現在地
  const searchBad = [];
  const sug = async (q) => { await page.fill('#nq', q); await page.waitForTimeout(500); return page.$$eval('.nq-item a', as => as.map(a => [a.querySelector('.nq-name').textContent, a.getAttribute('href')])); };
  let s1 = await sug('中区');
  if (!['名古屋市中区', '横浜市中区', '堺市中区'].every(n => s1.some(x => x[0].startsWith(n)))) searchBad.push('「中区」で政令市の中区が出ない');
  if (!s1.some(x => /^town\.html\?c=\d{5}&t=/.test(x[1]))) searchBad.push('「中区」で町が出ない');
  s1 = await sug('神奈川'); if (!s1[0] || s1[0][1] !== 'p-神奈川県.html') searchBad.push(`「神奈川」の先頭が${s1[0] && s1[0][1]}`);
  s1 = await sug('横浜市神奈川区三ツ沢'); if (!s1.some(x => x[0].startsWith('横浜市神奈川区三ツ沢下町'))) searchBad.push('町名まで続けて書くと出ない');
  s1 = await sug('赤羽西'); if (!s1[0] || s1[0][1] !== 'm-kita-赤羽西.html') searchBad.push(`23区の町は町ページへ: ${s1[0] && s1[0][1]}`);
  s1 = await sug('府中市'); if (s1.filter(x => x[0].startsWith('府中市')).length < 2) searchBad.push('同じ名前の市（東京都・広島県の府中市）が両方出ない');
  await page.fill('#nq', '大阪府'); await page.waitForTimeout(400); await page.press('#nq', 'Enter');
  await page.waitForURL(/p-/, { timeout: 4000 }).catch(() => searchBad.push('Enterで都道府県ページへ移動しない'));
  await page.goto('file://' + path.join(DIST, 'towns.html'));
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
  await gp.click('[data-nsearch] .geo-go');
  await gp.waitForURL(/m-kita-/, { timeout: 5000 }).catch(() => {});
  if (!decodeURIComponent(gp.url()).endsWith('m-kita-赤羽西.html')) searchBad.push(`現在地→${decodeURIComponent(gp.url()).split('/').pop()}`);
  await gp.goto('file://' + path.join(DIST, 'index.html'));
  await gp.click('[data-post] .geo-fill');
  await gp.waitForFunction(() => document.querySelector('[data-post] [name=city]').value === '北区', null, { timeout: 5000 }).catch(() => {});
  const gv = await gp.evaluate(() => { const p = document.querySelector('[data-post]'); return [p.querySelector('[name=pref]').value, p.querySelector('[name=city]').value, p.querySelector('[name=town]').value].join('|'); });
  if (gv !== '東京都|北区|赤羽西2丁目') searchBad.push(`投稿欄の現在地が不正 ${gv}`);
  await gctx.close();

  const AR = JSON.parse(fs.readFileSync(path.join(RAW, 'areas.json'), 'utf8'));
  // R11 報告→火事のページ→口コミ→通報→共有（受付サーバーは本物の処理を検査用DBで）
  const flowBad = [], flowOk = [];
  if (!API) flowBad.push('受付サーバーのURLが未設定');
  else {
    W = makeEnv(); clock = 0;
    const fc = await mkctx(375); const fp = await fc.newPage(); const ferr = []; fp.on('pageerror', e => ferr.push(e.message));
    await fp.goto('file://' + path.join(DIST, 'index.html'));
    await fp.waitForSelector('.live-empty', { timeout: 5000 }).then(() => flowOk.push('報告なしの表示'), () => flowBad.push('トップ: 報告がないときの表示が出ない'));
    await fp.goto('file://' + path.join(DIST, 'm-kita-赤羽西.html'));
    const pre = await fp.evaluate(() => { const p = document.querySelector('[data-post]'); return p.querySelector('[name=pref]').value + '|' + p.querySelector('[name=city]').value; });
    if (pre !== '東京都|北区') flowBad.push(`町ページの場所の初期値が不正 ${pre}`); else flowOk.push('町ページは場所が入った状態');
    await fp.fill('[data-post] [name=town]', '赤羽西二丁目3番地'); clock++;
    await fp.click('[data-post] button[value=smoke]');
    const link = await fp.waitForSelector('[data-post] .post-status a', { timeout: 5000 }).then(h => h.getAttribute('href'), () => null);
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
      clock++; await fp.click('.f-report [data-tab=text]');
      await fp.fill('.f-report textarea', '黒い煙が見えます。消防車が来ています');
      await fp.click('.f-report form.text button[type=submit]');
      await fp.waitForFunction(() => /黒い煙が見えます/.test(document.querySelector('.f-comments .com-list').textContent), null, { timeout: 5000 })
        .then(() => flowOk.push('口コミの投稿・表示'), () => flowBad.push('口コミが表示されない'));
      clock++; await fp.fill('.f-report textarea', 'くわしくは https://example.com を見て');
      await fp.click('.f-report form.text button[type=submit]');
      await fp.waitForFunction(() => /URLは書き込めません/.test(document.querySelector('.f-report .post-status').textContent), null, { timeout: 5000 })
        .then(() => flowOk.push('URL入りは断る'), () => flowBad.push('URL入りの口コミを断らない'));
      await fp.click('.f-comments .flag');
      await fp.waitForFunction(() => /通報しました/.test(document.querySelector('.f-comments .flag').textContent), null, { timeout: 5000 })
        .then(() => flowOk.push('通報'), () => flowBad.push('通報できない'));
      clock++; await fp.click('.f-report [data-tab=quick]'); await fp.click('.f-report button[value=fire]');
      await fp.waitForFunction(() => /報告\s*2/.test(document.querySelector('.f-stats').textContent), null, { timeout: 5000 })
        .then(() => flowOk.push('火事のページから報告を追加'), () => flowBad.push('火事のページの報告が件数に反映されない'));
    }
    await fp.goto('file://' + path.join(DIST, 'index.html'));
    await fp.waitForFunction(() => /赤羽西2丁目付近/.test(document.querySelector('[data-live]').textContent), null, { timeout: 5000 })
      .then(() => flowOk.push('トップの一覧'), () => flowBad.push('トップに出ない'));
    await fp.goto('file://' + path.join(DIST, 'p-東京都.html'));
    await fp.waitForFunction(() => /赤羽西2丁目付近/.test(document.querySelector('[data-live]').textContent) && /報告2/.test(document.querySelector('[data-ward-tile="北区"]').textContent), null, { timeout: 5000 })
      .then(() => flowOk.push('東京都ページの一覧と23区の地図'), () => flowBad.push('東京都ページに出ない'));
    clock += 200; await fp.goto('file://' + path.join(DIST, 'm-kita-赤羽西.html')); // 火事から3時間以上あと → 町の掲示板へ
    await fp.click('[data-post] [data-tab=text]');
    await fp.fill('[data-post] textarea', '夜中にサイレンが多い町です');
    await fp.click('[data-post] form.text button[type=submit]');
    await fp.waitForFunction(() => /夜中にサイレンが多い町です/.test(document.querySelector('.comments .com-list').textContent), null, { timeout: 5000 })
      .then(() => flowOk.push('町の口コミ掲示板'), () => flowBad.push('町の口コミが表示されない'));
    // 全国: トップで大阪府→大阪市北区を選んでボタンで報告 → 火事のページ
    clock++; await fp.goto('file://' + path.join(DIST, 'index.html'));
    await fp.click('[data-post] button[value=siren]');
    if (!/都道府県を選んで/.test(await fp.$eval('[data-post] .post-status', e => e.textContent))) flowBad.push('都道府県未選択を止めない'); else flowOk.push('未選択の確認');
    await fp.selectOption('[data-post] [name=pref]', '大阪府');
    const nCity = await fp.$$eval('[data-post] [name=city] option', o => o.length);
    await fp.selectOption('[data-post] [name=city]', '大阪市北区');
    await fp.fill('[data-post] [name=town]', '梅田1丁目');
    await fp.click('[data-post] button[value=smoke]');
    const olink = await fp.waitForSelector('[data-post] .post-status a', { timeout: 5000 }).then(h => h.getAttribute('href'), () => null);
    if (!olink || nCity < 30) flowBad.push(`全国の報告ができない（市区町村${nCity}件）`);
    else {
      await fp.goto('file://' + path.join(DIST, olink));
      await fp.waitForFunction(() => /大阪府大阪市北区梅田1丁目付近で火事/.test(document.querySelector('.f-title').textContent), null, { timeout: 5000 })
        .then(() => flowOk.push('全国（大阪府大阪市北区）の報告と火事のページ'), () => flowBad.push('全国の火事のページが出ない'));
      // 火事を指定しない口コミは、同じ場所の進行中の火事に付く
      clock++; await fp.goto('file://' + path.join(DIST, 'index.html'));
      await fp.click('[data-post] [data-tab=text]');
      await fp.selectOption('[data-post] [name=pref]', '大阪府'); await fp.selectOption('[data-post] [name=city]', '大阪市北区'); await fp.fill('[data-post] [name=town]', '梅田');
      await fp.fill('[data-post] textarea', '梅田の方で煙が見えます');
      await fp.click('[data-post] form.text button[type=submit]');
      const clink = await fp.waitForSelector('[data-post] .post-status a', { timeout: 5000 }).then(h => h.getAttribute('href'), () => null);
      if (clink !== olink) flowBad.push(`口コミが同じ場所の火事に付かない ${clink}`); else flowOk.push('場所だけ選んだ口コミが進行中の火事に付く');
      // 全国の市区町村ページ・町ページに、いまの火事と口コミが出る
      await fp.goto('file://' + path.join(DIST, 'c-大阪府-大阪市北区.html'));
      await fp.waitForFunction(() => /梅田1丁目付近/.test(document.querySelector('[data-live]').textContent), null, { timeout: 5000 })
        .then(() => flowOk.push('市区町村ページ（大阪市北区）'), () => flowBad.push('市区町村ページに出ない'));
      const oc = AR.prefs['大阪府'].find(x => x[0] === '大阪市北区')[1];
      await fp.goto('file://' + path.join(DIST, 'town.html') + '?c=' + oc + '&t=' + encodeURIComponent('梅田'));
      await fp.waitForFunction(() => /梅田1丁目付近/.test((document.querySelector('[data-live]') || {}).textContent || '') && /梅田の方で煙/.test(document.querySelector('.t-comments').textContent), null, { timeout: 6000 })
        .then(() => flowOk.push('全国の町ページ（梅田）'), () => flowBad.push('全国の町ページに報告・口コミが出ない'));
      const near = await fp.$$eval('.t-near a', a => a.length);
      if (near < 5) flowBad.push('近くの町が出ない');
    }
    // 消防本部の発表: 取り込むと一覧に「消防の発表」、火事のページに出典つきで出る
    await ingestOfficial(W.env, [{ source: 'sapporo', pref: '北海道', city: '札幌市北区', town: '北32条西7丁目', kind: '建物火災', at: new Date(Date.now() - 20 * 60e3).toISOString() }], new Date());
    const offInc = W.db.prepare("SELECT id FROM incidents WHERE ward = '札幌市北区'").get();
    await fp.goto('file://' + path.join(DIST, 'index.html'));
    await fp.waitForFunction(() => [...document.querySelectorAll('.fire-card')].some(c => /札幌市北区北32条西7丁目付近/.test(c.textContent) && /消防の発表 建物火災/.test(c.textContent)), null, { timeout: 5000 })
      .then(() => flowOk.push('一覧に「消防の発表」'), () => flowBad.push('一覧に消防の発表が出ない'));
    if (offInc) {
      await fp.goto('file://' + path.join(DIST, 'fire.html') + '?id=' + offInc.id);
      await fp.waitForFunction(() => /消防の発表あり/.test(document.querySelector('.f-kind').textContent) && /札幌市消防局/.test(document.querySelector('.f-off').textContent), null, { timeout: 5000 })
        .then(() => flowOk.push('火事のページに消防の発表と出典'), () => flowBad.push('火事のページに消防の発表が出ない'));
      const xs = decodeURIComponent((await fp.$$eval('.f-share a', as => as.map(a => a.href))).find(h => /intent/.test(h)) || '');
      if (!/【消防出動】北海道札幌市北区北32条西7丁目付近で建物火災/.test(xs)) flowBad.push('消防の発表の共有文が不正'); else flowOk.push('消防の発表の共有文');
    }
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
  for (const f of ['site.css', 'site.js', 'areas.js']) fs.copyFileSync(path.join(DIST, 'assets', f), path.join(TMP, 'assets', f));
  fs.writeFileSync(path.join(TMP, 'a.html'), fs.readFileSync(path.join(DIST, 'm-kita-赤羽西.html'), 'utf8').replace(/name="kaji23-api" content="[^"]*"/, 'name="kaji23-api" content=""'));
  await page.goto('file://' + path.join(TMP, 'a.html'));
  const off = await page.evaluate(() => ({ h: document.querySelector('[data-post] form.quick').offsetHeight, m: document.querySelector('[data-post] .post-status').textContent, c: document.querySelector('[data-post] form.text').offsetHeight }));
  if (off.h !== 0 || off.c !== 0 || !/災害情報案内/.test(off.m)) flowBad.push('受付サーバー未設定のときの表示が不正'); else flowOk.push('未設定時は案内のみ');
  await browser.close();

  add('R1 コンソールエラー・スクリプトエラー', !consoleErr.length, consoleErr.slice(0, 8).join(' / ') || `${pages.length}ページ×2画面幅でエラーなし（町ページは${machi.length}町から見本）`);
  add('R2 読み込み失敗', !reqFail.length, reqFail.slice(0, 8).join(' / ') || 'CSS・JS・画像すべて読み込み成功（Webフォント・外部サイトは作業環境の制限で除外）');
  add('R3 横はみ出し（375px・1280px）', !overflow.length, overflow.slice(0, 8).join(' / ') || 'はみ出しなし');
  add('R4 サイト内リンク・ページ内リンク', !links.length, links.slice(0, 20).join(' / ') || `${allPages.length}ページすべてのリンク先とアンカーが存在`);
  // サイトマップは索引（sitemap.xml）＋分割ファイル（sitemap-N.xml）
  const sm = fs.readdirSync(DIST).filter(f => /^sitemap-\d+\.xml$/.test(f)).map(f => fs.readFileSync(path.join(DIST, f), 'utf8')).join('\n');
  const smIdx = fs.existsSync(path.join(DIST, 'sitemap.xml')) ? fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8') : '';
  if (!/<sitemapindex/.test(smIdx)) meta.push('サイトマップの索引がない');
  const smN = (sm.match(/<loc>/g) || []).length;
  if (smN < allPages.length - 5 || /<loc>[^<]*[^\x21-\x7e][^<]*<\/loc>/.test(sm)) meta.push(`サイトマップ ${smN}件`);
  if (!fs.existsSync(path.join(DIST, 'robots.txt'))) meta.push('robots.txtがない');
  add('R5 タイトル・見出し・説明文・OGP画像・正規URL・サイトマップ', !meta.length, meta.slice(0, 10).join(' / ') || `${allPages.length}ページすべてにあり、サイトマップ${smN}件`);
  add('R6 表示されている数字＝データ', !numbers.length, numbers.join(' / ') || '23区の統計と58署のカードすべて一致');
  add('R7 全国の検索・現在地', !searchBad.length, searchBad.join(' / ') || '「中区」→名古屋・横浜・堺の中区と町、「神奈川」→神奈川県、町名まで続けて入力、23区の町は町ページへ、同名の府中市は両方、Enterで移動、現在地→赤羽西の町ページ・投稿欄に東京都/北区/赤羽西2丁目');
  add('R9 出典ボックスの見出し', !provBad.length, provBad.join(' / ') || '出典の各行が「今年の件数／前年同時期／○○○○年」で始まる');
  add('R10 報道された火事の表示', !newsBad.length, newsBad.join(' / ') || `区ページの件数がデータと一致（計${news.incidents.length}件）、町ページにも振り分け、見出し文・配慮の要る語は表示なし`);
  add('R11 報告・火事のページ・口コミ・共有', !flowBad.length, flowBad.join(' / ') || flowOk.join('、') + 'を確認');

  // M1〜M3 本番の監視（GitHub上で動くときだけ失敗扱い。失敗するとGitHubからメールが届く）
  const inCI = !!process.env.CI;
  const lvl = inCI ? 'error' : 'warn';
  const getJ = async (u) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 15000); try { const r = await fetch(u, { signal: c.signal }); return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); } };
  if (API) {
    const live = await getJ(API + '/api/live?hours=1');
    add('M1 受付サーバーの応答', !!live, live ? '本番の受付サーバーが応答' : (inCI ? '本番の受付サーバーに接続できない' : '作業環境から本番に接続できないため未確認'), live || inCI ? 'error' : 'warn');
    const src = await getJ(API + '/api/sources');
    if (src) {
      const now = Date.now();
      const stale = src.sources.filter(x => x.last_try && now - Date.parse(x.last_try) > 2 * 3600e3).map(x => x.id);
      const pending = src.sources.filter(x => !x.last_try).map(x => x.id);   // 追加したばかりでまだ読んでいない
      const bad = src.sources.filter(x => x.status && x.status !== 'ok').map(x => `${x.id}(${x.status})`);
      const okN = src.sources.filter(x => x.status === 'ok').length;
      add('M2 消防本部の読み取り（5分ごと）', !stale.length && okN >= Math.ceil((src.sources.length - pending.length) / 2),
        `読めている ${okN}/${src.sources.length}ページ、取り込み ${src.sources.reduce((a, x) => a + (x.items || 0), 0)}件${pending.length ? '（未実行：' + pending.join('、') + '）' : ''}${stale.length ? '／2時間以上止まっている：' + stale.join('、') : ''}`, stale.length || okN < (src.sources.length - pending.length) / 2 ? 'error' : 'warn');
      add('M3 読み取れていない消防本部', !bad.length, bad.join('、') || 'すべて読めている', 'warn');
    } else add('M2 消防本部の読み取り（5分ごと）', false, '読み取り状況を取得できない', lvl === 'error' && inCI ? 'error' : 'warn');
  }
  const ageH = news.collectedAt ? (Date.now() - Date.parse(news.collectedAt)) / 36e5 : 999;
  add('M4 報道の収集の鮮度', ageH < 3, `最終収集 ${ageH.toFixed(1)}時間前（30分ごとに収集）`, inCI ? 'error' : 'warn');

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
