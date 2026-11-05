// 報道ニュースから全国の火事を抽出（Node／ブラウザ共通）
// 入力: RSSの item 配列 [{title, link, pubDate, source}] と、地名データ（buildGeo で作る）
// 出力: 火事ごとにまとめた配列。場所は「都道府県・市区町村（政令市は区）・町名（丁目を除く）・丁目」
// 方針: 見出しの文章は保存も表示もしない。場所・建物の種類・けが人の有無・報道元リンクだけを取り出す。

// areas: data/raw/areas.json、townsJP: data/raw/towns_jp.json の towns（コード→[[町名,緯度,経度],...]）
function buildGeo(areas, townsJP) {
  const prefs = Object.keys(areas.prefs);
  const entries = [];                     // {pref, city, code, parent?}
  for (const p of prefs) for (const [city, code] of areas.prefs[p]) entries.push({ pref: p, city, code });
  for (const p of Object.keys(areas.parents || {})) for (const [name, wards] of areas.parents[p]) entries.push({ pref: p, city: name, parent: true, wards });
  const byName = new Map();
  for (const e of entries) { const k = e.city.replace(/（.*）$/, ''); (byName.get(k) || byName.set(k, []).get(k)).push(e); }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const codeOf = {}; for (const e of entries) if (e.code) codeOf[e.pref + '|' + e.city] = e.code;
  const towns = {};
  for (const [code, list] of Object.entries(townsJP)) towns[code] = list.map(t => t[0]).sort((a, b) => b.length - a.length);
  // 「名古屋・中区」「横浜 神奈川区」のような略し方を正式名にそろえる
  const aliases = [];
  for (const p of Object.keys(areas.parents || {})) for (const [name, wards] of areas.parents[p]) {
    const short = name.replace(/市$/, ''), sfx = wards.map(w => w.slice(name.length)).sort((a, b) => b.length - a.length);
    aliases.push([new RegExp(short + '(?:市)?[・ 　、]?(' + sfx.join('|') + ')'), name + '$1']);
  }
  // 見出しでは「市・町・村」を省くことが多い（「津の住宅火災」「下松の倉庫全焼」「珠洲で住宅全焼」）。省いた形 → 正式名
  const prefShort = new Set(prefs.map(p => p === '北海道' ? p : p.replace(/[都府県]$/, '')));
  const shorts = new Map();
  for (const n of names) {
    if (!/[市町村]$/.test(n)) continue;
    const s = n.slice(0, -1);
    if ((s.length < 2 && s !== '津') || prefShort.has(s) || SHORT_STOP.has(s) || byName.has(s)) continue;
    (shorts.get(s) || shorts.set(s, []).get(s)).push(n);
  }
  const shortNames = [...shorts.keys()].sort((a, b) => b.length - a.length);
  // 全国で1か所にしかない「○○町」（3文字以上）→ 市区町村（見出しが町名だけのとき: 「西立神町で住宅1棟が全焼」）
  const byCode = {}; for (const e of entries) if (e.code) byCode[e.code] = e;
  const townCount = new Map(), townAt = new Map();
  for (const [code, list] of Object.entries(townsJP)) for (const t of list) {
    const n = t[0]; if (n.length < 3 || !/町$/.test(n) || !byCode[code]) continue;
    townCount.set(n, (townCount.get(n) || 0) + 1); townAt.set(n, byCode[code]);
  }
  const uniqTowns = [...townCount].filter(([, c]) => c === 1).map(([n]) => n).sort((a, b) => b.length - a.length);
  return { prefs, byName, names, codeOf, towns, aliases, shorts, shortNames, uniqTowns, townAt };
}
// 地名以外の意味でよく使う語・人の名字に多い語（省いた形では使わない）
const SHORT_STOP = new Set(['東北', '南部', '東海', '上野', '昭和', '朝日', '大和', '中山', '共和', '日高', '清水', '池田', '小野', '中島', '平田', '野田', '山田', '高山', '川内',
  '豊富', '大空', '小平', '美里', '大江', '河内', '太田', '吉岡', '中川', '村田', '柴田', '山元', '玉川', '金山', '富岡', '本宮', '西郷', '小国', '上川', '下川', '最上', '庄内', '中央',
  '大島', '三島', '高森', '大町', '美浜', '白鷹', '石井', '吉田', '松本', '森', '神田', '岡本', '和田', '原', '菊川', '長島', '大野', '上田', '吉川', '新宮', '中村', '小林', '加藤', '佐藤',
  '高田', '藤井', '三好', '香川', '岩田', '坂井', '松田', '竹田', '宮田', '有田', '平和', '大宮', '三郷', '美郷', '中野', '平野', '大川', '大和田', '高橋', '豊田', '前田', '石田', '日野',
  '多賀', '多治見', '大津', '新田', '神戸', '府中', '光', '北', '南', '東', '西', '那須', '日光', '白馬', '伊豆', '箱根', '軽井沢', '熱海', '草津', '湯沢', '平泉', '富士', '浦安', '舞浜',
  '国見', '白石', '長井', '天童', '鹿島', '神栖', '桜', '旭', '緑', '泉', '本町', '大東', '中津', '小山', '大山', '宮古', '古賀', '久米', '国分', '大口', '日南', '高千穂', '南国', '大洲']);

const KANJI_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const NOT_INCIDENT = /訓練|予防|啓発|呼びかけ|放送文化|時の話題|特集|振り返|判決|裁判|初公判|起訴|送検|再逮捕|年前|周年|統計|まとめ|ランキング|映画|ドラマ|イベント|消防団|表彰|防災週間|火災保険|山火事対策|クラウドファンディング|募金|支援金|寄付|再建|復興|READYFOR|CAMPFIRE|応援|バザー|コンサート|感謝状|販売再開|営業再開|教訓|防火設備|点検|閉鎖/;
const SENSITIVE = /自殺|死のう|心中|自ら火|焼身/; // 文言は表示しない（事実の抽出だけに使う）
const BUILDING = [['共同住宅', /共同住宅|アパート|マンション|団地/], ['住宅', /住宅|民家|一軒家|戸建/], ['飲食店', /飲食店|店舗|ラーメン|居酒屋|レストラン/],
  ['ビル', /ビル|雑居/], ['工場・倉庫', /工場|倉庫|作業場/], ['車両', /車両|車が|乗用車|トラック|バス/], ['施設', /グループホーム|施設|病院|学校|寺|神社/],
  ['林野', /山林|山火事|林野|枯れ草|野焼き/]];
const PRI = /NHK|TBS|テレ朝|日テレ|FNN|フジ|テレビ東京|共同|時事|産経|読売|朝日新聞|毎日|東京新聞|ABEMA|新聞|放送|テレビ/;
const TOKYO_AMBIG = ['北区', '中央区', '港区'];

function extractFireNewsJP(items, geo, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const maxAgeH = opts.maxAgeHours || 72;
  const z2h = s => String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[･・]/g, '・').replace(/\s+/g, ' ');
  const out = [];
  for (const it of items) {
    let title = z2h(it.title || '').replace(/\s+-\s+[^-]+$/, '');
    for (const [re, rep] of geo.aliases) title = title.replace(re, rep);
    if (!/火事|火災|全焼|半焼|燃え|焼け/.test(title) || NOT_INCIDENT.test(title)) continue;
    const pub = new Date(it.pubDate);
    if (isNaN(pub) || (now - pub) / 36e5 > maxAgeH || pub > now) continue;
    // 都道府県（「東京都」の中の「京都」を拾わないよう、正式名を先に消してから略称を探す）
    let rest = title; const prefHit = new Set();
    for (const p of geo.prefs) if (rest.includes(p)) { prefHit.add(p); rest = rest.split(p).join('　'); }
    for (const p of geo.prefs) { const s = p === '北海道' ? p : p.replace(/[都府県]$/, ''); if (s.length >= 2 && rest.includes(s)) prefHit.add(p); }
    // 市区町村（長い名前を優先）。同じ名前が複数の都道府県にあるときは、見出しの都道府県で決める
    let hit = null;
    for (const name of geo.names) {
      const i = title.indexOf(name); if (i < 0) continue;
      let cands = geo.byName.get(name);
      if (cands.length > 1 && new Set(cands.map(c => c.pref)).size === 1) cands = [cands.find(c => !/（/.test(c.city)) || cands[0]];  // 北海道の泊村（古宇郡）を優先
      if (cands.length > 1 || (cands[0].pref === '東京都' && TOKYO_AMBIG.includes(name))) {
        const inPref = cands.filter(c => prefHit.has(c.pref));
        if (inPref.length === 1) cands = inPref;
        else if (TOKYO_AMBIG.includes(name) && /東京|都内/.test(title) && cands.some(c => c.pref === '東京都')) cands = cands.filter(c => c.pref === '東京都');
        else continue;
      } else if (prefHit.size && !prefHit.has(cands[0].pref)) continue;   // 見出しの都道府県と合わない
      if (i > 0 && /[市町村区]/.test(title[i - 1]) && !cands[0].parent && name.length <= 3) continue; // 「大阪市北区」の「北区」など
      hit = { ...cands[0], at: i, name }; break;
    }
    if (!hit) hit = shortHit(title, geo, prefHit);
    if (!hit && geo.uniqTowns) {
      const t = geo.uniqTowns.find(n => title.includes(n) && !/[一-龥ぁ-んァ-ヶ]/.test(title[title.indexOf(n) - 1] || ''));
      const e = t && geo.townAt.get(t);
      if (e && (!prefHit.size || prefHit.has(e.pref))) hit = { ...e, at: title.indexOf(t), name: '' };
    }
    if (!hit) continue;
    // 町名: 市区町村名の直後、またはタイトル中の3文字以上の町名
    const after = title.slice(hit.at + hit.name.length);
    let city = hit.city, code = hit.code, town = null;
    const findTown = c => (geo.towns[c] || []).find(t => after.replace(/^[のでにな・ 　]/, '').startsWith(t)) || (geo.towns[c] || []).find(t => t.length >= 3 && title.includes(t)) || null;
    if (hit.parent) {   // 「横浜市」だけのとき: 町名から区を決める（決まらなければ市のまま）
      const found = hit.wards.map(w => ({ w, c: geo.codeOf[hit.pref + '|' + w] })).map(x => ({ ...x, t: (geo.towns[x.c] || []).find(t => after.startsWith(t)) })).filter(x => x.t);
      if (found.length === 1) { city = found[0].w; code = found[0].c; town = found[0].t; }
    } else town = findTown(code);
    let chome = null;
    if (town) {
      const m = title.slice(title.indexOf(town) + town.length).match(/^([0-9]+|[一二三四五六七八九十]+)丁目/);
      if (m) chome = /^\d+$/.test(m[1]) ? +m[1] : (m[1].length === 1 ? KANJI_NUM[m[1]] : (m[1] === '十' ? 10 : null));
    }
    const building = (BUILDING.find(([, re]) => re.test(title)) || ['建物不明'])[0];
    let source = (it.source || '').trim() || '報道';
    if (/^https?:\/\//.test(source)) { try { source = new URL(source).hostname.replace(/^www\./, ''); } catch (e) {} }
    out.push({ pref: hit.pref, city, parent: !code, town, chome, building,
      injured: /けが|負傷|重傷|軽傷|搬送|やけど/.test(title), dead: /死亡|死者|遺体|心肺停止/.test(title), sensitive: SENSITIVE.test(title),
      pub: pub.toISOString(), source, link: it.link });
  }
  // 同じ火事をまとめる: 同じ市区町村で、町名が一致（または片方が不明）し、建物が矛盾せず、近い時刻
  out.sort((a, b) => a.pub.localeCompare(b.pub));
  const incidents = [];
  for (const n of out) {
    const hit = incidents.find(x => x.pref === n.pref && x.city === n.city && (!x.town || !n.town || x.town === n.town) &&
      (x.building === n.building || x.building === '建物不明' || n.building === '建物不明') && Math.abs(new Date(n.pub) - new Date(x.first)) / 36e5 < (x.town && n.town ? 72 : 36));
    if (hit) {
      hit.town = hit.town || n.town; hit.chome = hit.chome || n.chome;
      if (hit.building === '建物不明') hit.building = n.building;
      hit.injured ||= n.injured; hit.dead ||= n.dead; hit.sensitive ||= n.sensitive;
      if (!hit.sources.some(s => s.name === n.source)) hit.sources.push({ name: n.source, link: n.link, pub: n.pub });
      hit.last = n.pub;
    } else incidents.push({ pref: n.pref, city: n.city, ward: n.city, parent: n.parent, town: n.town, chome: n.chome, building: n.building, injured: n.injured, dead: n.dead,
      sensitive: n.sensitive, first: n.pub, last: n.pub, sources: [{ name: n.source, link: n.link, pub: n.pub }] });
  }
  incidents.forEach(x => {
    x.sources.sort((a, b) => (PRI.test(b.name) ? 1 : 0) - (PRI.test(a.name) ? 1 : 0)); x.sources = x.sources.slice(0, 3);
    x.confidence = x.sources.length >= 2 || x.town ? 'high' : 'low';
    x.id = `${x.pref}-${x.city}-${x.town || 'x'}-${x.first.slice(0, 10)}`;
  });
  return incidents.reverse();
}
// 「市・町・村」を省いた市町村名を探す。前は区切り（文頭・記号・空白）、後ろは助詞・記号・「市」「駅」・文末のときだけ
function shortHit(title, geo, prefHit) {
  for (const s of geo.shortNames) {
    let i = -1;
    while ((i = title.indexOf(s, i + 1)) >= 0) {
      const prev = title[i - 1] || '', next = title[i + s.length] || '';
      if (prev && !/[\s　、。・,，|｜【】「」（）()\[\]／/:：]/.test(prev)) continue;
      if (next && !/^[のでにはがや・、。 　|｜）)\]】／/:：]/.test(next) && !/^(駅|署)/.test(title.slice(i + s.length))) continue;
      let cands = geo.shorts.get(s).flatMap(n => geo.byName.get(n).map(c => ({ ...c, name: n })));
      if (cands.length > 1) {
        const inPref = cands.filter(c => prefHit.has(c.pref));
        if (inPref.length === 1) cands = inPref;
        else if (cands.filter(c => c.parent || /市$/.test(c.city)).length === 1 && !prefHit.size) cands = cands.filter(c => c.parent || /市$/.test(c.city));   // 市が1つだけなら市を採る（横浜市と青森の横浜町）
        else continue;
      } else if (prefHit.size && !prefHit.has(cands[0].pref)) continue;
      return { ...cands[0], at: i, name: s };
    }
  }
  return null;
}
function parseRSS(xml) {
  const dec = s => s.replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const g = t => { const x = b.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return x ? dec(x[1].trim()) : ''; };
    out.push({ title: g('title'), link: g('link'), pubDate: g('pubDate'), source: g('source') });
  }
  return out;
}
if (typeof module !== 'undefined') module.exports = { buildGeo, extractFireNewsJP, parseRSS };
