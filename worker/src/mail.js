// 市町村・消防本部が配信する「火災メール」を受け取り、火災の発生だけを取り込む
//
// 仕組み: Cloudflare の Email Routing で alerts@kajisoku.jp（など）宛のメールをこの受付サーバーに渡す。
//  - 本文から「日時・市区町村・町名・種別」を読む（official.js の文章形式の読み取りをそのまま使う）
//  - 送り主（差出人アドレスのドメイン）から都道府県・市区町村の見当をつける。本文に市区町村名があればそちらを優先
//  - 登録確認・お知らせ・救急・誤報などは捨てる（fireKind が火災と判定したものだけ）
import { AREAS } from './areas.js';
import { parseSource, fireKind } from './official.js';

// 差出人のドメイン → 都道府県・市区町村（本文に市名が書かれない配信のため）。分からない送り主は本文の市区町村名で振り分ける
export const MAIL_SENDERS = {
  'city.nagoya.lg.jp': { pref: '愛知県', wardCity: '名古屋市' },
  'ktaiwork.jp': null,   // 配信サービス（複数の自治体）: 件名・本文から判断
  // 2026-11 に登録した自治体のメール（送信元のドメインがその自治体だけのもの）。本文に市町村名がなくても町名だけで読めるように
  'city.saitama.lg.jp': { pref: '埼玉県', wardCity: 'さいたま市' },
  'city.kumamoto.lg.jp': { pref: '熊本県', wardCity: '熊本市' },
  'nasu-119.mailio.jp': { pref: '栃木県' },
  'city.yamagata-yamagata.lg.jp': { pref: '山形県' },
  'fukushima.fukushima-fd.jp': { pref: '福島県', city: '福島市' },
  'ashikaga-city.mailio.jp': { pref: '栃木県', city: '足利市' },
  'sano-city.mailio.jp': { pref: '栃木県', city: '佐野市' },
  'oyama-anshin.jp': { pref: '栃木県', city: '小山市' },
  'city.takasaki.gunma.jp': { pref: '群馬県', city: '高崎市' },
  'city.kawagoe.lg.jp': { pref: '埼玉県', city: '川越市' },
  'city.kawaguchi.lg.jp': { pref: '埼玉県', city: '川口市' },
  'citymail.city.koshigaya.saitama.jp': { pref: '埼玉県', city: '越谷市' },
  'city.funabashi.lg.jp': { pref: '千葉県', city: '船橋市' },
  'mds.city.ogaki.lg.jp': { pref: '岐阜県', city: '大垣市' },
  'hotline.city.iwata.shizuoka.jp': { pref: '静岡県', city: '磐田市' },
  'city.kakegawa.shizuoka.jp': { pref: '静岡県', city: '掛川市' },
  'sasebo-shimin.mailio.jp': { pref: '長崎県' },
  'city.soma.fukushima.jp': { pref: '福島県', city: '相馬市' },
  'city.ohtawara.tochigi.jp': { pref: '栃木県', city: '大田原市' },
  'mail.city.nasushiobara.lg.jp': { pref: '栃木県', city: '那須塩原市' },
  'fureai.city.kiryu.gunma.jp': { pref: '群馬県', city: '桐生市' },
  'city.numata.gunma.jp': { pref: '群馬県', city: '沼田市' },
  'city.tomioka.lg.jp': { pref: '群馬県', city: '富岡市' },
  'city.midori.gunma.jp': { pref: '群馬県', city: 'みどり市' },
  'city.hanyu.lg.jp': { pref: '埼玉県', city: '羽生市' },
  'city.kuki.lg.jp': { pref: '埼玉県', city: '久喜市' },
  'city.shiraoka.lg.jp': { pref: '埼玉県', city: '白岡市' },
  'mail.city.noda.chiba.jp': { pref: '千葉県', city: '野田市' },
  'city.narashino.lg.jp': { pref: '千葉県', city: '習志野市' },
  'city.musashimurayama.lg.jp': { pref: '東京都', city: '武蔵村山市' },
  'city.inagi.lg.jp': { pref: '東京都', city: '稲城市' },
  'city.murakami.lg.jp': { pref: '新潟県', city: '村上市' },
  'info.city.itoigawa.niigata.jp': { pref: '新潟県', city: '糸魚川市' },
  'city.okaya.lg.jp': { pref: '長野県', city: '岡谷市' },
  'city.omachi.nagano.jp': { pref: '長野県', city: '大町市' },
  'mgz.city.mizunami.gifu.jp': { pref: '岐阜県', city: '瑞浪市' },
  'mobile.city.kakamigahara.gifu.jp': { pref: '岐阜県', city: '各務原市' },
  'city.atami.lg.jp': { pref: '静岡県', city: '熱海市' },
  'city.ito.shizuoka.jp': { pref: '静岡県', city: '伊東市' },
  'city.gotemba.lg.jp': { pref: '静岡県', city: '御殿場市' },
  'bousai.city.ise.mie.jp': { pref: '三重県' },
  'city.takashima.lg.jp': { pref: '滋賀県', city: '高島市' },
  'city.ayabe.lg.jp': { pref: '京都府', city: '綾部市' },
  'ibara.mailio.jp': { pref: '岡山県', city: '井原市' },
  'city.mihara.hiroshima.jp': { pref: '広島県', city: '三原市' },
  'toonmail.city.toon.ehime.jp': { pref: '愛媛県', city: '東温市' },
  'town.iwaizumi.lg.jp': { pref: '岩手県', city: '岩泉町' },
  'town.hinode.tokyo.jp': { pref: '東京都', city: '日の出町' },
  'town.manazuru.kanagawa.jp': { pref: '神奈川県', city: '真鶴町' },
  'town.shimosuwa.lg.jp': { pref: '長野県', city: '下諏訪町' },
  'town.taketoyo.lg.jp': { pref: '愛知県', city: '武豊町' },
  'town.arita.saga.jp': { pref: '佐賀県', city: '有田町' },
};

// ---------- MIME（メールの本文）を読む ----------
function decodeBytes(bytes, charset) {
  const cs = String(charset || 'utf-8').toLowerCase().replace(/["']/g, '').replace('shift-jis', 'shift_jis').replace('x-sjis', 'shift_jis');
  try { return new TextDecoder(cs).decode(bytes); } catch (e) { return new TextDecoder('utf-8').decode(bytes); }
}
function b64(s) { const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, '')); return Uint8Array.from(bin, c => c.charCodeAt(0)); }
function qp(s) {
  const out = []; const t = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) { out.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
    else { const c = t.charCodeAt(i); if (c < 128) out.push(c); else out.push(...new TextEncoder().encode(t[i])); }
  }
  return new Uint8Array(out);
}
// 件名など「=?ISO-2022-JP?B?...?=」の形の見出し
export function decodeHeader(v) {
  return String(v || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) =>
    decodeBytes(enc.toUpperCase() === 'B' ? b64(txt) : qp(txt.replace(/_/g, ' ')), cs));
}
function splitHead(raw) {
  const i = raw.search(/\r?\n\r?\n/); const head = i < 0 ? raw : raw.slice(0, i), body = i < 0 ? '' : raw.slice(i).replace(/^\r?\n\r?\n/, '');
  const h = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) { const m = line.match(/^([\w-]+):\s*(.*)$/); if (m) h[m[1].toLowerCase()] = m[2]; }
  return { h, body };
}
// 本文の文字列（text/plain を優先。なければ text/html のタグを外したもの）
export function mailText(raw) {
  const { h, body } = splitHead(raw);
  const ct = h['content-type'] || 'text/plain';
  const bnd = (ct.match(/boundary="?([^";]+)"?/i) || [])[1];
  if (/multipart\//i.test(ct) && bnd) {
    const parts = body.split('--' + bnd).slice(1).filter(p => !p.startsWith('--')).map(p => mailText(p.replace(/^\r?\n/, '')));
    const plain = parts.find(p => p.type === 'plain' && p.text.trim()) || parts.find(p => p.text.trim());
    return { type: plain ? plain.type : 'plain', text: plain ? plain.text : '', headers: h };
  }
  const cs = (ct.match(/charset="?([^";\s]+)"?/i) || [])[1] || 'utf-8';
  const cte = String(h['content-transfer-encoding'] || '').toLowerCase();
  const bytes = cte === 'base64' ? b64(body) : cte === 'quoted-printable' ? qp(body) : Uint8Array.from(body, c => c.charCodeAt(0) & 0xff);
  let text = decodeBytes(bytes, /iso-2022-jp/i.test(cs) && cte !== 'base64' && cte !== 'quoted-printable' ? 'iso-2022-jp' : cs);
  const type = /html/i.test(ct) ? 'html' : 'plain';
  if (type === 'html') text = text.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '');
  return { type, text, headers: h };
}

// 政令市の区名（「浦和区」など）→ その区を持つ政令市の一覧
let WARDS = null;
function uniqueWard(wc, text) {
  if (!WARDS) {
    WARDS = new Map();
    for (const list of Object.values(AREAS)) for (const n of list) {
      const m = n.match(/^(.+?市)(.+区)$/); if (!m) continue;
      if (!WARDS.has(m[2])) WARDS.set(m[2], new Set()); WARDS.get(m[2]).add(m[1]);
    }
  }
  // 本文に出てくる区名のうち、この市にあって、全国でこの市にしかないものがあれば決めてよい
  for (const [w, cities] of WARDS) if (cities.size === 1 && cities.has(wc) && text.includes(w)) return true;
  return false;
}

// ---------- 火災の発表を読む ----------
// raw: メール全体（文字列。8bit のままのバイトは1文字1バイトで入っている）
export function parseMail(raw, now = new Date(), senders = MAIL_SENDERS) {
  const m = mailText(raw);
  const subject = decodeHeader(m.headers.subject || '');
  const from = decodeHeader(m.headers.from || '');
  const domain = ((from.match(/@([\w.-]+)/) || [])[1] || '').toLowerCase();
  const hint = Object.entries(senders).find(([d]) => domain === d || domain.endsWith('.' + d));
  const text = (subject + '\n' + m.text).replace(/\r/g, '');
  if (!fireKind(text) && !/誤報|火災では(?:あり|な)/.test(text)) return { subject, from: domain, items: [] };
  // 本文の市区町村名から都道府県を探す（長い名前から。政令市の区は「○○市○○区」で）
  // 本文に政令市の名前（「浜松市」「浜松」）が1つだけあれば、その市を先に試す（区名だけの配信のため）
  const desig = hint && hint[1] ? [] : [...new Set(Object.entries(AREAS).flatMap(([p, l]) => l.filter(n => /^.+?市.+区$/.test(n)).map(n => p + '|' + n.match(/^(.+?市)/)[1])))]
    .filter(k => text.includes(k.split('|')[1].replace(/市$/, '')));
  const prefs = hint && hint[1] ? [hint[1].pref] : desig.length === 1 ? [desig[0].split('|')[0], ...Object.keys(AREAS).filter(p => p !== desig[0].split('|')[0])] : Object.keys(AREAS);
  let items = [];
  for (const pref of prefs) {
    const src = { id: 'mail-' + (domain || 'unknown'), name: '消防メール', pref, type: 'sentence', ...(hint && hint[1] ? hint[1] : {}) };
    // 政令市のメールは区だけを書くことが多い: その都道府県の政令市を順に試す
    const wardCities = src.wardCity ? [src.wardCity] : [...new Set((AREAS[pref] || []).filter(n => /^.+?市.+区$/.test(n)).map(n => n.match(/^(.+?市)/)[1]))];
    const named = desig.length === 1 && desig[0].startsWith(pref + '|') ? desig[0].split('|')[1] : null;
    for (const wc of named ? [named, null, ...wardCities.filter(w => w !== named)] : [null, ...wardCities]) {
      // 送り主の見当がないとき、区の名前だけで政令市を決めない（「中央区」は札幌・さいたま・浜松などにある）。
      // 本文に市の名前がある、または全国でその区名を持つ政令市が1つだけのときに限る
      if (wc && !(hint && hint[1]) && !text.includes(wc.replace(/市$/, '')) && !uniqueWard(wc, text)) continue;
      const s = wc ? { ...src, wardCity: wc } : src;
      // 本文は「日時」と「場所・種別」が別の行に分かれていることが多いので、つなげた1行でも読む
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const joined = lines.join(' ');
      const found = parseSource(`<p>${joined.replace(/</g, '')}</p>` + lines.map(l => `<p>${l.replace(/</g, '')}</p>`).join(''), s, now);
      // 送り主の見当がないとき: 同じ名前の市区町村がほかの都道府県にもあるなら、本文に都道府県名があるときだけ採る
      const okFound = found.filter(x => hint && hint[1] || text.includes(pref) || Object.keys(AREAS).filter(p => (AREAS[p] || []).includes(x.city)).length === 1)
        // 東京の「中央区・北区・港区」は政令市の区と同じ名前: 東京と書かれているときだけ
        .filter(x => hint && hint[1] || !(x.pref === '東京都' && /^(中央区|北区|港区)$/.test(x.city)) || /東京|都内/.test(text));
      if (okFound.length) { items = okFound.map(x => ({ ...x, source: 'mail-' + (domain || 'unknown') })); break; }
    }
    if (items.length) break;
  }
  // 同じメールから同じ火事を二重に取らない（つなげた行と元の行で重なる）
  const seen = new Set(); items = items.filter(x => { const k = `${x.city}|${x.town}|${x.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { subject, from: domain, items: items.slice(0, 3) };
}
