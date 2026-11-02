// 消防署「災害情報」ページの汎用解析 v3
// 入力: DOM Document, 今年(西暦)
// 出力: { ytd, ytdPrev, annual:{年:件数}, asof, updated, method }
//   ytd     … 本年累計の火災件数
//   ytdPrev … 昨年同時期の火災件数（あれば）
//   annual  … 年ごとの年間火災件数（確定・速報値）
function parseStationPage(doc, cur) {
  const z2h = s => String(s ?? '').replace(/[０-９．，－＋]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const clean = s => z2h(s).replace(/[\s 　]+/g, '');
  const num = s => { const t = clean(s).replace(/,/g, ''); const m = t.match(/^[+\-ー]?\d+(\.\d+)?/); return m ? Number(m[0].replace('ー', '-')) : null; };
  const MAXV = 800; // 1署の年間火災件数としてありえる上限（庁全体の数値の混入を防ぐ）
  const res = { ytd: null, ytdPrev: null, annual: {}, asof: null, updated: null, method: [] };

  const yearOf = s => {
    let m = s.match(/令和(\d+|元)年/); if (m) return 2018 + (m[1] === '元' ? 1 : +m[1]);
    m = s.match(/(20\d\d)/); if (m) return +m[1];
    m = s.match(/^R(\d+)/i); if (m) return 2018 + +m[1];
    m = s.match(/^(\d{1,2})年/); if (m && +m[1] <= 30) return 2018 + +m[1];
    return null;
  };
  // 表の直前の見出し・説明文（期間判定用）
  function context(t) {
    let n = t, txt = '';
    for (let i = 0; i < 10 && txt.length < 80; i++) {
      n = n.previousElementSibling || n.parentElement;
      if (!n || n.tagName === 'BODY' || n.tagName === 'MAIN') break;
      if (n.querySelector && n.querySelector('table')) continue;
      txt = clean(n.textContent).slice(-80) + '|' + txt;
    }
    const cap = t.querySelector('caption');
    return (cap ? clean(cap.textContent) + '|' : '') + txt;
  }
  const ctxYear = ctx => {
    const pick = re => { const all = [...ctx.matchAll(re)]; if (!all.length) return null; const m = all[all.length - 1]; return m[1] ? 2018 + (m[1] === '元' ? 1 : +m[1]) : +m[2]; };
    return pick(/令和(\d+|元)年(?!\d+月)|(20\d\d)年(?!\d+月)/g) ?? pick(/令和(\d+|元)年|(20\d\d)年/g);
  };
  function grid(table) {
    const out = [];
    [...table.querySelectorAll('tr')].forEach((tr, r) => {
      out[r] = out[r] || []; let c = 0;
      [...tr.children].filter(x => /^(TD|TH)$/.test(x.tagName)).forEach(cell => {
        while (out[r][c] !== undefined) c++;
        const rs = +cell.getAttribute('rowspan') || 1, cs = +cell.getAttribute('colspan') || 1, v = clean(cell.textContent);
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) { out[r + i] = out[r + i] || []; out[r + i][c + j] = v; }
        c += cs;
      });
    });
    const w = Math.max(0, ...out.map(r => r.length));
    return out.map(r => {
      const row = Array.from({ length: w }, (_, i) => r[i] ?? '');
      const lead = row[0], trail = w - r.length;
      // 見出しの行結合のずれで右端が空いた数値行は右寄せ（例: 24件｜ー1件… が1列左にずれている）
      if (trail > 0 && lead && /^[\d+\-ー]/.test(lead)) return Array(trail).fill('').concat(row.slice(0, w - trail));
      return row;
    });
  }
  // 列見出し → 期間の種類
  function colKind(label, ctxY) {
    if (!label) return null;
    // 「令和8年10月28日現在（前年同日比）」のように括弧書きの補足は本体で判定
    if (/[（(][^）)]*[）)]/.test(label)) { const base = label.replace(/[（(][^）)]*[）)]/g, ''); if (base) { const b = colKind(base, ctxY); if (b && b.k === 'ytd') return b; } }
    if (/東京消防庁|庁管内|全体/.test(label)) return { k: 'skip' };
    if (/本日|日計|月中$/.test(label)) return { k: 'skip' };
    if (/増減|前年比|対前年|比較|±|差|順位|位$|原因/.test(label)) return { k: 'skip' };
    if (/同時期|同日|同期|同月日|同時点/.test(label)) return { k: 'prevSame' };
    if (/本年|今年/.test(label)) return { k: 'ytd' };
    if (/昨年統計|昨年総|昨年中|昨年の?件数/.test(label)) return { k: 'annual', y: cur - 1 };
    if (/昨年累計|昨年$/.test(label)) return { k: 'prevSame' };
    const y = yearOf(label);
    if (y === cur) return { k: 'ytd' };
    if (y && y < cur) return { k: 'annual', y };
    if (/累計|現在|件数|管内|速報|^項目$|^区分$|^災害種別$/.test(label)) return ctxY && ctxY < cur ? { k: 'annual', y: ctxY } : { k: 'ytd' };
    return null;
  }
  const FIRE_ROW = lab => /火災件数|火災総件数|^火災(\/件数|\/火災|\(件\)|（件）)?$|^火災\/|^火災[A-Za-z(（]|^件数(（件）)?$|^件数計$|^合計$|火災\/合計/.test(lab) && !/焼損|死者|傷者|けが|面積|人員|救|危険|建物$|建物以外|車両|その他|原因/.test(lab);
  const BREAKDOWN = /^(建物(全焼|半焼|部分焼|ぼや)|車両火災?|その他(火災)?|林野|船舶|航空機)$/;
  res.sources = {};
  const put = (kind, y, v, how, src) => {
    if (v === null || v < 0 || v > MAXV) return;
    const key = kind === 'annual' ? 'y' + y : kind;
    if (kind === 'ytd' && res.ytd === null) { res.ytd = v; res.method.push(how); }
    else if (kind === 'prevSame' && res.ytdPrev === null) res.ytdPrev = v;
    else if (kind === 'annual' && y && res.annual[y] === undefined) res.annual[y] = v;
    else return;
    res.sources[key] = src; // 値を読み取った表の行（見出し＝値）
  };

  const text = clean(doc.body.textContent);
  const upd = text.match(/(20\d\d)年(\d{1,2})月(\d{1,2})日更新/);
  if (upd) res.updated = `${upd[1]}-${upd[2].padStart(2, '0')}-${upd[3].padStart(2, '0')}`;
  const asofU = text.match(/令和(\d+)年(\d{1,2})月(\d{1,2})日更新/);
  const asof = text.match(/令和(\d+)年(\d{1,2})月(\d{1,2})日[^|]{0,8}?(現在|まで)/) || text.match(/(\d{1,2})月(\d{1,2})日[^|]{0,6}?現在/);
  if (asofU) res.asof = `${2018 + +asofU[1]}-${asofU[2].padStart(2, '0')}-${asofU[3].padStart(2, '0')}`;
  else if (asof) res.asof = asof.length === 5 ? `${2018 + +asof[1]}-${asof[2].padStart(2, '0')}-${asof[3].padStart(2, '0')}` : `${cur}-${asof[1].padStart(2, '0')}-${asof[2].padStart(2, '0')}`;

  for (const t of [...doc.querySelectorAll('table')].filter(t => /火災|件数/.test(clean(t.textContent)) && !/原因|出火場所|順位/.test(clean(t.textContent)))) {
    const g = grid(t); if (!g.length) continue;
    const ctx = context(t), cy = ctxYear(ctx);
    // 見出し行 = 数値セルが現れる前の行
    let firstData = g.findIndex(r => r.slice(1).some(v => num(v) !== null && !/年|月/.test(v)));
    if (firstData < 0) continue;
    const headRows = g.slice(0, firstData);
    const colLabel = c => [...new Set(headRows.map(r => r[c]).filter(Boolean))].join('/');
    const lastLabel = c => { for (let i = headRows.length - 1; i >= 0; i--) if (headRows[i][c]) return headRows[i][c]; return ''; };
    const kindOf = c => { const a = colKind(lastLabel(c), cy); return a ?? colKind(colLabel(c), cy); };
    const width = g[0].length;
    const labelEnd = row => { const i = row.findIndex((v, j) => j > 0 && num(v) !== null && !/^(令和|R)/.test(v)); return i < 0 ? row.length : i; };

    // (A) 転置型: 見出しに「火災件数」列があり、行が期間
    let fireCol = -1;
    const fireTable = /焼損|火災/.test(headRows.flat().join('') + ctx);
    const dataRows = g.slice(firstData);
    const tests = [
      c => /^火災件数(合計)?$/.test(lastLabel(c)) || /^火災件数(合計)?(\/|$)/.test(colLabel(c)),
      c => /^(合計|件数計)$/.test(lastLabel(c)),
      c => /^火災$/.test(lastLabel(c)) && dataRows.some(r => num(r[c]) !== null),
      c => fireTable && /^件数$/.test(lastLabel(c)) && headRows.flat().some(v => /焼損/.test(v))
    ];
    for (const test of tests) { for (let c = 0; c < width; c++) if (test(c)) { fireCol = c; break; } if (fireCol >= 0) break; }
    const firstColYears = g.slice(firstData).some(r => yearOf(r[0]) || /^\d$/.test(r[0]) || /月中$/.test(r[0]));
    if (fireCol >= 0 && (firstColYears || headRows.length)) {
      let monthSum = null;
      for (const row of g.slice(firstData)) {
        const v = num(row[fireCol]); if (v === null) continue;
        const r0 = row[0];
        let y = yearOf(r0); if (!y && /^\d$/.test(r0) && /年別/.test(colLabel(0))) y = 2018 + +r0;
        if (/月中$/.test(r0)) { monthSum = (monthSum || 0) + v; continue; }
        const src = `${lastLabel(fireCol)}｜${r0 || ctx.slice(-30)}＝${row[fireCol]}`;
        if (y && !/同|比/.test(r0)) put(y === cur ? 'ytd' : 'annual', y, v, 'transposed-year', src);
        else {
          const rk = r0 && num(r0) === null && fireCol !== 0 ? colKind(r0, cy) : null;
          if (rk && rk.k !== 'skip') put(rk.k, rk.y, v, 'transposed-rowlabel', src);
          else if (!rk) put(cy && cy < cur ? 'annual' : 'ytd', cy, v, 'transposed-ctx', src);
        }
      }
      if (monthSum !== null) put(cy && cy < cur ? 'annual' : 'ytd', cy, monthSum, 'monthly-sum', `月別「${lastLabel(fireCol)}」の合計`);
      continue;
    }
    // (B) 行が指標・列が期間
    const kinds = Array.from({ length: width }, (_, c) => kindOf(c));
    // 「同月日」「同時期」比較がある表では、前年の列は前年同期の値
    const ytdCol = kinds.findIndex((k, c) => k && k.k === 'ytd' && dataRows.some(r => num(r[c]) !== null && !/年|月/.test(r[c])));
    const sharedRunning = c => ytdCol >= 0 && headRows.slice(0, -1).some(r => r[c] && r[c] === r[ytdCol] && /累計|現在/.test(r[c]));
    const samePeriodTable = ytdCol >= 0 && (kinds.some((k, c) => k && k.k === 'skip' && /同月日|同時期|同日|同期/.test(lastLabel(c))));
    // 上段の「累計(…現在)」見出しが今年と前年の両方にかかっている → 前年列は同時期の累計
    kinds.forEach((k, c) => { if (k && k.k === 'annual' && k.y === cur - 1 && !/中|全件|総|統計/.test(lastLabel(c)) && (samePeriodTable || sharedRunning(c))) kinds[c] = { k: 'prevSame' }; });
    let found = false;
    const sums = {};
    for (const row of g.slice(firstData)) {
      const le = labelEnd(row), lab = row.slice(0, le).filter((v, i, a) => a.indexOf(v) === i).join('/');
      const isFire = FIRE_ROW(lab), isPart = BREAKDOWN.test(lab);
      if (!isFire && !isPart) continue;
      for (let c = le; c < width; c++) {
        let k = kinds[c];
        if (!k && headRows.length === 0) k = cy && cy < cur ? { k: 'annual', y: cy } : { k: 'ytd' }; // 見出しなし（例: 火災｜件数｜63件）
        if (!k || k.k === 'skip') continue;
        const v = num(row[c]); if (v === null) continue;
        if (isFire) { put(k.k, k.y, v, 'rows', `${lab}｜${lastLabel(c) || colLabel(c) || ctx.slice(-30)}＝${row[c]}`); found = true; }
        else { const key = c; sums[key] = sums[key] || { k, v: 0, parts: [] }; sums[key].v += v; sums[key].parts.push(`${lab}${row[c]}`); }
      }
      if (isFire) break;
    }
    if (!found) for (const s of Object.values(sums)) put(s.k.k, s.k.y, s.v, 'breakdown-sum', '内訳の合計: ' + s.parts.join('+'));
  }
  if (res.ytd === null && res.annual[cur] !== undefined) res.ytd = res.annual[cur];
  delete res.annual[cur];
  // 明らかな転記ミス（例: 本年51件に対し前年同期683件）は採用しない
  if (res.ytd !== null && res.ytdPrev !== null && res.ytdPrev > res.ytd * 3 + 30) { res.warnings = (res.warnings || []).concat(`前年同期${res.ytdPrev}件は本年${res.ytd}件と比べて不自然なため不採用`); res.ytdPrev = null; }
  return res;
}
if (typeof module !== 'undefined') module.exports = { parseStationPage };
