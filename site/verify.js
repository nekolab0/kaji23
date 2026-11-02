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
    add('W1 サイレン報告の受付サーバー', !f.length && W.results.length >= 10, f.length ? f.map(r => r.name).join(' / ') : `${W.results.length}項目すべて合格（連投制限・23区以外の拒否・番地の切り捨て・IPを保存しない・集計）`);
  } else add('W1 サイレン報告の受付サーバー', false, '未実施（node worker/test.mjs）');
})();

// ================= 表示 =================
(async function renderChecks() {
  const pages = fs.readdirSync(DIST).filter(f => f.endsWith('.html'));
  const browser = await chromium.launch();
  // 画面幅ごとにコンテキストを分ける（newPage の viewport 指定は context 経由でないと効かない）
  const mkctx = async (width) => {
    const c = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 });
    // フォントCDNは作業環境から到達できないため遮断（公開先では読み込まれる）
    await c.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await c.route(/\/api\/reports?(\?|$)/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"wards":{}}' }));
    return c;
  };
  const consoleErr = [], reqFail = [], overflow = [], links = [], meta = [], numbers = [];
  const fileSet = new Set(fs.readdirSync(DIST, { recursive: true }).map(String));

  for (const width of [375, 1280]) {
    const wctx = await mkctx(width);
    const page = await wctx.newPage();

    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text()) && !/ERR_FAILED/.test(m.text())) consoleErr.push(`${width}px ${page.url().split('/').pop()}: ${m.text()}`); });
    page.on('pageerror', e => consoleErr.push(`${width}px ${page.url().split('/').pop()}: ${e.message}`));
    page.on('requestfailed', r => { if (!/fonts\.g/.test(r.url())) reqFail.push(`${r.url()} ${r.failure() && r.failure().errorText}`); });
    for (const f of pages) {
      await page.goto('file://' + path.join(DIST, f), { waitUntil: 'load' });
      const realW = await page.evaluate(() => window.innerWidth);
      if (realW !== width) overflow.push(`${width}px ${f}: 表示幅が${realW}px（viewport設定が効いていない）`);
      const o = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const sw = document.documentElement.scrollWidth;
        const wide = [...document.querySelectorAll('body *')].filter(el => {
          if (el.closest('.table-box') || el.closest('.nav') || el.closest('script')) return false;
          const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1);
        }).slice(0, 3).map(el => el.tagName + '.' + el.className);
        return { vw, sw, wide };
      });
      if (o.sw > o.vw + 1 || o.wide.length) overflow.push(`${width}px ${f}: ページ幅${o.sw}/${o.vw} ${o.wide.join(',')}`);
      if (width === 375) {
        const info = await page.evaluate(() => ({
          title: document.title, h1: document.querySelectorAll('h1').length, desc: (document.querySelector('meta[name=description]') || {}).content,
          og: (document.querySelector('meta[property="og:image"]') || {}).content,
          hrefs: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => !/^(https?:|mailto:|tel:)/.test(h)),
          ids: [...document.querySelectorAll('[id]')].map(e => e.id)
        }));
        if (!info.title || info.h1 !== 1 || !info.desc || !info.og || !fileSet.has(info.og)) meta.push(`${f}: title=${!!info.title} h1=${info.h1} desc=${!!info.desc} og=${info.og}`);
        for (const h of info.hrefs) {
          const [file, hash] = h.split('#');
          const target = file || f;
          if (!fileSet.has(target)) { links.push(`${f} → ${h}（ファイルなし）`); continue; }
          if (hash) {
            const html = fs.readFileSync(path.join(DIST, target), 'utf8');
            if (!html.includes(`id="${hash}"`)) links.push(`${f} → ${h}（#${hash}なし）`);
          }
        }
      }
    }
    await wctx.close();
  }

  // 区ページに出ている数字 ＝ データ
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
  // 出典ボックスの行ラベル
  const provBad = [];
  for (const w of model.wards) {
    await page.goto('file://' + path.join(DIST, w.slug + '.html'));
    const labs = await page.$$eval('.prov > span', ss => ss.map(s => s.textContent.trim()));
    labs.filter(l => !/^(出典|確認先|※)/.test(l)).forEach(l => { if (!/^(今年の件数|前年同時期|\d{4}年)：/.test(l)) provBad.push(`${w.name}:「${l.slice(0, 30)}」`); });
  }
  // 報道の表示: 区ページの件数＝データ、見出し文や配慮の要る語を出していない
  const newsBad = [];
  for (const w of model.wards) {
    await page.goto('file://' + path.join(DIST, w.slug + '.html'));
    const items = await page.$$eval('.news-item', els => els.map(e => e.textContent));
    const want = news.incidents.filter(x => x.ward === w.name);
    if (items.length !== want.length) newsBad.push(`${w.name}:表示${items.length}≠データ${want.length}`);
    items.forEach(t => { if (SENSITIVE.test(t)) newsBad.push(`${w.name}:配慮の要る語`); if (t.length > 160) newsBad.push(`${w.name}:長すぎる（見出し文の転載の疑い）`); });
    want.filter(x => x.sensitive).forEach(() => { if (items.some(t => /亡くなった方|けが人/.test(t))) newsBad.push(`${w.name}:配慮対象に死傷を表示`); });
  }
  await page.goto('file://' + path.join(DIST, 'index.html'));
  const topNews = await page.$$eval('.news-item', els => els.length);
  if (topNews !== Math.min(8, news.incidents.length)) newsBad.push(`トップ:表示${topNews}`);

  // サイレン報告: 保存先がないときは案内だけ（ボタンを隠す）、保存先があるときは送信→集計が出る
  const repBad = [];
  const TMP = path.join(OUT, 'tmp'); fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(path.join(TMP, 'assets'), { recursive: true });
  for (const f of ['site.css', 'site.js']) fs.copyFileSync(path.join(DIST, 'assets', f), path.join(TMP, 'assets', f));
  for (const f of ['kita.html', 'index.html']) fs.writeFileSync(path.join(TMP, f), fs.readFileSync(path.join(DIST, f), 'utf8').replace(/data-api="[^"]*"/g, 'data-api=""'));
  const API = (fs.readFileSync(path.join(DIST, 'kita.html'), 'utf8').match(/data-api="([^"]*)"/) || [])[1] || '';
  await page.goto('file://' + path.join(TMP, 'kita.html'));
  const offline = await page.evaluate(() => { const b = document.querySelector('[data-reports]'); return { hidden: b.querySelector('.report-form').offsetHeight === 0, msg: b.querySelector('.report-status').textContent }; });
  if (!offline.hidden || !/災害情報案内/.test(offline.msg)) repBad.push('保存先なしのとき案内が出ない');
  const fake = await browser.newContext({ viewport: { width: 375, height: 900 } });
  await fake.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await fake.addInitScript(() => {
    // 共有保存領域の代わり（add と where().onSnapshot だけ）
    const docs = [{ ward: '北区', town: '赤羽西', kind: 'siren', at: new Date(Date.now() - 3600e3).toISOString() },
                  { ward: '北区', kind: 'fire', at: new Date(Date.now() - 50 * 3600e3).toISOString() }];
    const subs = [];
    const snap = (since) => ({ docs: docs.filter(d => d.at >= since).map(d => ({ data: () => d })) });
    const col = { add: async d => { docs.push(d); subs.forEach(([f, s]) => f(snap(s))); return {}; },
                  where: (k, op, v) => ({ onSnapshot: (f) => { subs.push([f, v]); setTimeout(() => f(snap(v)), 0); return () => {}; } }) };
    window.claude = { use: async n => n === 'db' ? { collection: () => col } : null };
  });
  const fp = await fake.newPage();
  const errs = []; fp.on('pageerror', e => errs.push(e.message));
  await fp.goto('file://' + path.join(TMP, 'kita.html'));
  await fp.waitForFunction(() => !document.querySelector('.report-form button').disabled, null, { timeout: 5000 }).catch(() => repBad.push('ボタンが押せるようにならない'));
  const first = await fp.$eval('.report-list', e => e.textContent);
  if (!/北区 全体.*1/.test(first) || /火 1/.test(first)) repBad.push(`初期集計が不正「${first.slice(0, 60)}」`);
  await fp.fill('.report .town-in', '赤羽西1丁目3番地');
  await fp.click('.report button[value=smoke]');
  await fp.waitForFunction(() => /報告しました/.test(document.querySelector('.report-status').textContent), null, { timeout: 5000 }).catch(() => repBad.push('送信完了が出ない'));
  const second = await fp.$eval('.report-list', e => e.textContent);
  if (!/北区 全体.*2/.test(second) || !/赤羽西1丁目/.test(second)) repBad.push(`送信後の集計が不正「${second.slice(0, 80)}」`);
  await fp.click('.report button[value=siren]');
  const again = await fp.$eval('.report-status', e => e.textContent);
  if (!/10分/.test(again)) repBad.push('連投が止まらない');
  await fp.goto('file://' + path.join(TMP, 'index.html'));
  await fp.waitForFunction(() => !document.querySelector('.report-form button').disabled, null, { timeout: 5000 }).catch(() => {});
  await fp.click('.report button[value=siren]');
  if (!/区を選んで/.test(await fp.$eval('.report-status', e => e.textContent))) repBad.push('トップで区未選択を止めない');
  if (errs.length) repBad.push(errs.join(' / '));
  await fake.close();
  if (API) {
    // 本番の受付サーバーにつながる設定のとき: 集計の表示・送信内容・連投拒否の表示（サーバーは検査用の代役）
    const ac = await browser.newContext({ viewport: { width: 375, height: 900 } });
    await ac.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const sent = []; let n = 0;
    await ac.route(/\/api\/reports?(\?|$)/, async r => {
      const h = { 'Access-Control-Allow-Origin': '*' };
      if (r.request().method() === 'POST') { sent.push(JSON.parse(r.request().postData())); n++;
        return r.fulfill(n === 1 ? { status: 200, headers: h, contentType: 'application/json', body: '{"ok":true}' } : { status: 429, headers: h, contentType: 'application/json', body: JSON.stringify({ error: '同じ区への報告は10分に1回までです' }) }); }
      return r.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ wards: { '北区': { siren: 2, smoke: 0, fire: 1, total: 3, last: new Date().toISOString(), towns: { '赤羽西1丁目': 2 } } } }) });
    });
    const ap = await ac.newPage(); const aerr = []; ap.on('pageerror', e => aerr.push(e.message));
    await ap.goto('file://' + path.join(DIST, 'kita.html'));
    await ap.waitForFunction(() => /北区 全体/.test(document.querySelector('.report-list').textContent), null, { timeout: 5000 }).catch(() => repBad.push('本番設定: 集計が表示されない'));
    await ap.fill('.report .town-in', '赤羽西1丁目3番地');
    await ap.click('.report button[value=smoke]');
    await ap.waitForFunction(() => /報告しました/.test(document.querySelector('.report-status').textContent), null, { timeout: 5000 }).catch(() => repBad.push('本番設定: 送信完了が出ない'));
    if (!sent[0] || sent[0].ward !== '北区' || sent[0].kind !== 'smoke' || sent[0].town !== '赤羽西1丁目') repBad.push(`本番設定: 送信内容が不正 ${JSON.stringify(sent[0])}`);
    await ap.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await ap.click('.report button[value=siren]');
    await ap.waitForFunction(() => /10分/.test(document.querySelector('.report-status').textContent), null, { timeout: 5000 }).catch(() => repBad.push('本番設定: サーバーの連投拒否が表示されない'));
    if (aerr.length) repBad.push(aerr.join(' / '));
    await ac.close();
  }

  // 町名検索
  await page.goto('file://' + path.join(DIST, 'towns.html'));
  await page.fill('#town-q', '赤羽');
  const res = await page.$$eval('#town-results a', as => as.map(a => a.getAttribute('href') + '|' + a.textContent));
  const searchOk = res.length >= 5 && res.every(r => r.includes('kita.html#st-akabane'));
  await page.fill('#town-q', '西新宿');
  const res2 = await page.$$eval('#town-results a', as => as.map(a => a.textContent));
  // 並べ替え
  await page.goto('file://' + path.join(DIST, 'ranking.html'));
  const before = await page.$$eval('table:nth-of-type(1) tbody tr td:first-child', t => t.slice(0, 3).map(x => x.textContent));
  await page.click('table >> nth=0 >> thead th >> nth=0 >> button');
  const after = await page.$$eval('table:nth-of-type(1) tbody tr td:first-child', t => t.slice(0, 3).map(x => x.textContent));
  await browser.close();

  add('R1 コンソールエラー・スクリプトエラー', !consoleErr.length, consoleErr.join(' / ') || `${pages.length}ページ×2画面幅でエラーなし`);
  add('R2 読み込み失敗', !reqFail.length, reqFail.join(' / ') || 'CSS・JS・画像すべて読み込み成功（Webフォントは作業環境の制限で除外）');
  add('R3 横はみ出し（375px・1280px）', !overflow.length, overflow.join(' / ') || 'はみ出しなし');
  add('R4 サイト内リンク・ページ内リンク', !links.length, links.slice(0, 20).join(' / ') || 'すべてのリンク先とアンカーが存在');
  add('R5 タイトル・見出し・説明文・OGP画像', !meta.length, meta.join(' / ') || `${pages.length}ページすべてにあり`);
  add('R6 表示されている数字＝データ', !numbers.length, numbers.join(' / ') || '23区のまとめと58署のカードすべて一致');
  add('R7 町名検索', searchOk && res2.length >= 1, `「赤羽」${res.length}件→赤羽消防署、「西新宿」${res2.length}件（${res2[0] || ''}）`);
  add('R9 出典ボックスの見出し', !provBad.length, provBad.join(' / ') || '出典の各行が「今年の件数／前年同時期／○○○○年」で始まる');
  add('R10 報道された火事の表示', !newsBad.length, newsBad.join(' / ') || `23区ページの件数がデータと一致（計${news.incidents.length}件）、見出し文・配慮の要る語は表示なし`);
  add('R11 サイレン報告ボタン', !repBad.length, repBad.join(' / ') || `保存先なし→案内のみ、共有保存領域→送信・番地切り捨て・集計・10分制限・区未選択の停止${API ? '、本番の受付サーバー設定→集計表示・送信内容・サーバー側の連投拒否の表示' : ''}を確認`);
  add('R8 表の並べ替え', JSON.stringify(before) !== JSON.stringify(after), `並べ替え前:${before.join('・')} 後:${after.join('・')}`);

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
