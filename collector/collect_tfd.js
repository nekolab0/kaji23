// 東京消防庁 一次データ収集 v2（ブラウザ／Node[jsdom]共通ロジック）
// 取得元（すべて東京消防庁公式サイト）:
//   /fs/<ward>.html               … 区ごとの「町名→管轄消防署」表
//   /fs/<station>/index.html      … 消防署トップ（災害情報ページへのリンクを自動発見）
//   /fs/<station>/<災害情報ページ> … 今年の火災件数・過去の火災件数（署ごとに形式が違うので汎用解析）
//   /learning/elib/nikkan.html    … 東京消防庁全体の日次速報値
if (typeof require !== 'undefined' && typeof parseStationPage === 'undefined') var { parseStationPage } = require('./parse_station.js');
async function collectTFD(fetchText, parseHTML, opts = {}) {
  const BASE = 'https://www.tfd.metro.tokyo.lg.jp';
  const WARDS = [
    ['adati','足立区'],['arakawa','荒川区'],['itabashi','板橋区'],['edogawa','江戸川区'],['ota','大田区'],
    ['katusika','葛飾区'],['kita','北区'],['koto','江東区'],['shinagawa','品川区'],['shibuya','渋谷区'],
    ['shinjuku','新宿区'],['suginami','杉並区'],['sumida','墨田区'],['setagaya','世田谷区'],['taito','台東区'],
    ['chuo','中央区'],['chiyoda','千代田区'],['toshima','豊島区'],['nakano','中野区'],['nerima','練馬区'],
    ['bunkyo','文京区'],['minato','港区'],['meguro','目黒区']
  ];
  const z2h = s => String(s).replace(/[０-９．，]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const num = s => { const t = z2h(s).replace(/[,\s]/g, ''); const m = t.match(/^-?\d+(\.\d+)?/) || t.match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  const clean = s => z2h(s || '').replace(/[\s 　]+/g, '');
  const errors = [];
  const pathOf = href => { try { return new URL(href, BASE + '/fs/').pathname; } catch { return null; } };

  // 表をセルの2次元配列に展開（rowspan/colspan対応）
  function grid(table) {
    const out = [];
    [...table.querySelectorAll('tr')].forEach((tr, r) => {
      out[r] = out[r] || [];
      let c = 0;
      [...tr.children].filter(x => /^(TD|TH)$/.test(x.tagName)).forEach(cell => {
        while (out[r][c] !== undefined) c++;
        const rs = +cell.getAttribute('rowspan') || 1, cs = +cell.getAttribute('colspan') || 1;
        const v = clean(cell.textContent);
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) { out[r + i] = out[r + i] || []; out[r + i][c + j] = v; }
        c += cs;
      });
    });
    return out.map(row => [...row].map(v => v ?? ''));
  }
  const yearOf = s => { // 令和7年 / R7 / 2025年 → 西暦
    let m = s.match(/令和(\d+|元)年/); if (m) return 2018 + (m[1] === '元' ? 1 : +m[1]);
    m = s.match(/^R(\d+)(年)?$/i); if (m) return 2018 + +m[1];
    m = s.match(/^(20\d\d)年?$/); if (m) return +m[1];
    return null;
  };

  // 1. 区ごとの町名→消防署（行結合された町名「大森西」＋「1・2丁目」を復元）
  function parseWardTable(d) {
    const towns = [];
    for (const table of d.querySelectorAll('table')) {
      const trs = [...table.querySelectorAll('tr')];
      const g = grid(table);
      trs.forEach((tr, r) => {
        const links = [...tr.querySelectorAll('a[href]')].filter(a => /\/fs\/[a-z0-9_-]+\//.test(pathOf(a.getAttribute('href')) || ''));
        if (!links.length) return;
        const stLink = links[links.length - 1];
        const st = pathOf(stLink.getAttribute('href')).match(/\/fs\/([a-z0-9_-]+)\//)[1];
        const stText = clean(stLink.textContent);
        const row = g[r] || [];
        const parts = [];
        row.forEach((v, i) => {
          if (!v || i === row.length - 1) return;                            // 消防署列（最終列）
          if (/^[ぁ-んァ-ヶ]$|^[あ-ん]行$/.test(v)) return;                  // 五十音の見出し
          if (parts[parts.length - 1] === v) return;                          // colspan の重複
          if (parts.length && v.startsWith(parts[parts.length - 1])) { parts[parts.length - 1] = v; return; } // 「大井」＋「大井3～7丁目」
          parts.push(v);
        });
        const town = parts.join('');
        if (town && !/^町名|^管轄区域$/.test(town)) {
          towns.push({ town, station: st });
          stationNames.set(st, stText.replace(/消防署.*$/, '') + '消防署');
        }
      });
    }
    return towns;
  }
  const wards = [];
  const stationNames = new Map();
  for (const [slug, name] of WARDS) {
    try {
      const d = parseHTML(await fetchText(`${BASE}/fs/${slug}.html`));
      const towns = parseWardTable(d);
      if (!towns.length) errors.push(`ward:${slug}:町名表が空`);
      wards.push({ slug, name, towns, url: `${BASE}/fs/${slug}.html` });
    } catch (e) { errors.push(`ward:${slug}:${e.message}`); }
  }

  // 2. 消防署 → 災害情報ページ発見 → 汎用解析
  const LINK_RE = /災害(情報|状況|件数|速報|統計|発生状況)|火災・救急件数|災害・救急|火災件数速報|災害状況/;
  const FALLBACK = ['saigai.html', 'info/saigai.html', 'about/saigai.html', 'disaster.html', 'info/disaster.html'];
  const stations = {};
  const only = opts.only ? new Set(opts.only) : null;
  for (const [st, stName] of stationNames) {
    if (only && !only.has(st)) continue;
    const rec = { slug: st, name: stName, url: null, updated: null, asof: null, ytd: null, ytdPrev: null, annual: {}, status: 'ng', note: '' };
    try {
      // 2a. ページ発見
      let candidates = [];
      try {
        const idx = parseHTML(await fetchText(`${BASE}/fs/${st}/index.html`));
        candidates = [...idx.querySelectorAll('a[href]')]
          .filter(a => LINK_RE.test(clean(a.textContent)) && !/ボランティア|災害史|過去の|協定|支援/.test(a.textContent))
          .map(a => pathOf(a.getAttribute('href')))
          .filter(p => p && p.startsWith(`/fs/${st}/`));
      } catch (e) { rec.note += `index:${e.message};`; }
      candidates = [...new Set(candidates.concat(FALLBACK.map(f => `/fs/${st}/${f}`)))];
      let d = null;
      for (const p of candidates) {
        try {
          const html = await fetchText(BASE + p);
          const dd = parseHTML(html);
          if ([...dd.querySelectorAll('table')].some(t => /火災|件数/.test(clean(t.textContent)))) { d = dd; rec.url = BASE + p; break; }
        } catch (e) { /* 次の候補 */ }
      }
      if (!d) { rec.status = 'unpublished'; rec.url = `${BASE}/fs/${st}/index.html`; rec.note += '消防署サイトに火災件数の掲載なし'; stations[st] = rec; continue; }

      // 2b. 汎用解析（parse_station.js）
      const r = parseStationPage(d, opts.thisYear || new Date().getFullYear());
      Object.assign(rec, r);
      rec.status = r.ytd !== null ? 'ok' : Object.keys(r.annual).length ? 'annual-only' : 'ng';
      if (rec.status === 'ng') { rec.note += '火災件数を読み取れない'; errors.push(`station:${st}:parse`); }
    } catch (e) { rec.note += e.message; errors.push(`station:${st}:${e.message}`); }
    stations[st] = rec;
  }

  // 3. 日次速報（全管内）
  let daily = null;
  if (!only) try {
    const d = parseHTML(await fetchText(`${BASE}/learning/elib/nikkan.html`));
    const t = z2h(d.body.textContent).replace(/\s+/g, '');
    const upd = t.match(/令和(\d+)年(\d+)月(\d+)日更新/);
    const g = grid([...d.querySelectorAll('table')][0]);
    const head = g[0] || [];
    const rows = {};
    g.slice(1).forEach(c => { if (c.length >= 3 && num(c[1]) !== null) rows[c[0]] = { day: num(c[1]), ytd: num(c[2]), diff: num(c[3]) }; });
    daily = { updated: upd ? `${2018 + +upd[1]}-${upd[2].padStart(2, '0')}-${upd[3].padStart(2, '0')}` : null,
              dayLabel: head[1] || null, rows, url: `${BASE}/learning/elib/nikkan.html` };
    if (!rows['火災件数']) errors.push('daily:火災件数なし');
  } catch (e) { errors.push(`daily:${e.message}`); }

  return { fetchedAt: new Date().toISOString(), source: BASE, wards, stations, daily, errors };
}
if (typeof module !== 'undefined') module.exports = { collectTFD };
