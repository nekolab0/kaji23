// 消防本部が公開している「出動情報」ページから、火災の出動だけを取り出す（Worker／Node 共通）
//
// 方針
//  - 公開ページだけを読む。robots.txt で禁止されているページは読まない（index.js 側で確認）。
//  - 火災の種別だけを使う（救急・救助・警戒・ガス漏れなどは捨てる）。
//  - 場所は町名（丁目まで）にとどめる。目標物・番地・距離などの細かい位置は保存しない。
//  - 1つのページに複数の市町村が載る場合（広域の消防本部）は、文中の市町村名で振り分ける。
import { AREAS } from './areas.js';

// type: sapporo … 札幌圏（表形式）／ sentence … 「日時＋場所＋種別」が1行ずつ書かれた文章形式
import { AUTO_SOURCES } from './sources_auto.js';
const MANUAL_SOURCES = [
  { id: 'sapporo', name: '札幌市消防局（札幌圏消防出動情報）', url: 'https://www.119.city.sapporo.jp/saigai/sghp.html', pref: '北海道', type: 'sapporo',
    sections: { '札幌市': '札幌市', '江別市': '江別市', '千歳市': '千歳市', '恵庭市': '恵庭市', '北広島市': '北広島市', '石狩北部地区消防事務組合': null } },
  { id: 'kyoto', name: '京都市消防局（災害情報案内）', url: 'https://disif.city.kyoto.lg.jp/annai/main/', pref: '京都府', type: 'sentence', wardCity: '京都市' },
  { id: 'okayama', name: '岡山市消防局（災害情報）', url: 'https://syoubou.city.okayama.jp/fire/saigai/saigaipc.html', pref: '岡山県', type: 'sentence', wardCity: '岡山市' },
  ...['kurume', 'omuta', 'yame', 'chikugo', 'miyama', 'asakura'].map(k => ({
    id: 'chikugo-' + k, name: '筑後地区消防指令センター（消防出動情報）', url: `http://www.center-chikugo119.jp/fire/saigai/${k}PcSel.html`, pref: '福岡県', type: 'sentence' })),
  { id: 'sendai', name: '仙台市（杜の都防災Web 火災等の発生情報）', url: 'http://sendaicity.bosai.info/sendaicity/fireinfo/index.html', pref: '宮城県', type: 'sentence', wardCity: '仙台市', current: true },
  { id: 'nagano', name: '長野市消防局（長野市防災情報ポータル）', url: 'https://www.nagano-bousai.jp/', pref: '長野県', type: 'sentence' },
];
// 手で書いた一覧（札幌の表など）が先、調査で見つけた全国のページ（sources_auto.js）があと
export const SOURCES = [...MANUAL_SOURCES, ...AUTO_SOURCES.filter(a => !MANUAL_SOURCES.some(m => m.url === a.url))];

const KNUM = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const z2h = s => String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[：]/g, ':').replace(/[／]/g, '/');
export function htmlText(html) {
  return z2h(String(html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|td|th|h\d|dt|dd)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)))
    .split('\n').map(l => l.replace(/[\s　]+/g, ' ').trim()).filter(Boolean);
}

// 火災の種別か（救急・救助・警戒・自動火災報知設備の鳴動などは除く）
const FIRE = /(建物|車両|林野|枯草|枯れ草|船舶|航空機|その他の?)?火災/;
const NOT_FIRE = /報知|救急|救助|警戒|調査|ガス|水難|鎮火済みの?訓練|訓練|予防|誤報|火災では(?:あり|な)|火災ではない|の疑い(?:で|のため)出動したが|警報器|注意報|警報|統計|件数|運動|ポスター|研修|条例|届出|動画|罹災|発生しておりません|発生していません|ありません|テレホン|ダイヤル|お問い合わせ|案内/;
export function fireKind(s) {
  if (!FIRE.test(s) || NOT_FIRE.test(s.replace(/火災出動|火災のため/, ''))) return null;
  // 「火災発生連絡 … 福祉建物火災が発生」のように何度か出るときは、種別が分かるもの（建物・車両など）を優先
  const all = [...s.matchAll(new RegExp(FIRE.source, 'g'))];
  const m = all.find(x => x[1]) || all[0]; return (m[1] ? m[1].replace('枯れ草', '枯草').replace('その他の', 'その他') : '') + '火災';
}

// 町名だけを取り出す（「北32条西7丁目」「太秦中筋町」など。目標物・距離・番地は捨てる）
export function townPart(s) {
  let t = s.replace(/^[、,\s]+/, '');
  t = t.split(/付近|地内|地先|方面|周辺|[、,（(\s]|で[、，]?|の(?:建物|車両|枯草|林野|その他|火災)|(?:中高層)?(?:建物|車両|林野|枯草|枯れ草|その他|船舶)?火災|火事/)[0];
  t = t.replace(/([0-9]+|[一二三四五六七八九十]+)番(地)?.*$/, '').replace(/[0-9]+[-－][0-9].*$/, '');
  return t.slice(0, 20);
}

// 見出しの年がないとき: 今の日付から年を決める（未来になるなら前年）
function toISO(now, mo, d, h, mi) {
  const jstNow = new Date(now.getTime() + 9 * 3600e3);
  let y = jstNow.getUTCFullYear();
  const t = Date.UTC(y, mo - 1, d, h - 9, mi);
  if (t - now.getTime() > 36 * 3600e3) y -= 1;
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi)).toISOString();
}

// 文中の市区町村を探す（その都道府県の中で長い名前から。区だけのときは wardCity を前につける）
function findCity(line, src) {
  const names = (AREAS[src.pref] || []).slice().sort((a, b) => b.length - a.length);
  for (const n of names) { const i = line.indexOf(n); if (i >= 0) return { city: n, rest: line.slice(i + n.length) }; }
  if (src.wardCity) {
    const wards = names.filter(n => n.startsWith(src.wardCity)).map(n => n.slice(src.wardCity.length)).sort((a, b) => b.length - a.length);
    for (const w of wards) { const i = line.indexOf(w); if (i >= 0) return { city: src.wardCity + w, rest: line.slice(i + w.length) }; }
  }
  return null;
}

// 札幌圏: 「〇市名」の見出しの下に「●種別」「・場所（HH時MM分）」。過去分の表は「本日」「昨日」の2列
function parseSapporo(html, src, now) {
  const lines = htmlText(html);
  const out = [];
  const jst = new Date(now.getTime() + 9 * 3600e3);
  const today = { mo: jst.getUTCMonth() + 1, d: jst.getUTCDate() };
  const yd = new Date(jst.getTime() - 864e5), yesterday = { mo: yd.getUTCMonth() + 1, d: yd.getUTCDate() };
  // 過去の表は「本日」列と「昨日」列が交互に並ぶ。列の切り替わりは td の閉じタグ（改行）で分かれる
  const rawRows = String(html).split(/<TR>/i);
  let section = null, mode = 'current';
  const push = (kind, placeLine, when) => {
    const m = placeLine.match(/^・?(.+?)（(\d{1,2})時(\d{2})分）/); if (!m) return;
    let city = section, place = m[1].trim();
    if (section === '札幌市') { const w = (AREAS['北海道'] || []).filter(n => n.startsWith('札幌市')).find(n => place.startsWith(n.slice(3))); if (!w) return; city = w; place = place.slice(w.length - 3); }
    else if (section === null) { const f = findCity(place, src); if (!f) return; city = f.city; place = f.rest; }
    out.push({ kind, city, town: townPart(place), at: toISO(now, when.mo, when.d, +m[2], +m[3]) });
  };
  // 現在の災害出動（今日）
  const curStart = lines.findIndex(l => l.includes('現在の災害出動')), curEnd = lines.findIndex(l => l.includes('現在の救急出動'));
  let kind = null;
  for (const l of lines.slice(curStart + 1, curEnd > 0 ? curEnd : undefined)) {
    const sec = l.match(/^〇(.+)$/); if (sec) { section = src.sections[sec[1]] !== undefined ? src.sections[sec[1]] : sec[1]; kind = null; continue; }
    const k = l.match(/^●(.+)$/); if (k) { kind = fireKind(k[1]); continue; }
    if (kind && l.startsWith('・')) push(kind, l, today);
  }
  // 過去の災害出動（本日・昨日）
  const pastIdx = String(html).indexOf('過去の災害出動');
  if (pastIdx >= 0) {
    for (const row of String(html).slice(pastIdx).split(/<TR>/i).slice(1)) {
      const cells = row.split(/<TD[^>]*>/i).slice(1);
      const head = htmlText(cells.join('\n')).join(' ');
      const sec = head.match(/^〇(.+?)$/);
      if (cells.length === 1 && sec) { section = src.sections[sec[1].trim()] !== undefined ? src.sections[sec[1].trim()] : sec[1].trim(); continue; }
      if (cells.length < 2 || /本日（/.test(head)) continue;
      [today, yesterday].forEach((when, ci) => {
        let k2 = null;
        for (const l of htmlText(cells[ci] || '')) {
          const k = l.match(/^●(.+)$/); if (k) { k2 = fireKind(k[1]); continue; }
          if (k2 && l.startsWith('・')) push(k2, l, when);
        }
      });
    }
  }
  return out;
}

// 文章形式: 1行に「日時」「場所」「種別」がそろっている行だけを使う
//  例) 「10/20 14:20出動のうきは市浮羽町三春付近の枯草火災は、鎮火しました」
//      「9月10日3時16分頃、右京区太秦中筋町付近の火災に、消防隊等が出動しています。」
//      「11月03日 02:31入電 岡山市北区辰巳地内、目標○○交差点 東 430メートル付近で、建物火災のため消防車が出動しています。」
function parseSentence(html, src, now) {
  const out = [];
  for (const raw of htmlText(html)) {
    // 「午後3時48分」「午前0時30分」を24時間の書き方に
    const line = raw.replace(/(午前|午後)\s*(\d{1,2})時/g, (_, ap, h) => `${(+h % 12) + (ap === '午後' ? 12 : 0)}時`);
    // 「火災ではありませんでした」「誤報」は、先に出た「火災発生」を取り消す印として返す（status: '誤報'）
    const cancel = /誤報|火災では(?:あり|な)|火災ではない/.test(line) && /火災/.test(line);
    const kind = cancel ? '火災' : fireKind(line); if (!kind) continue;
    const dt = line.match(/(?:(20\d{2})[年/.-])?(\d{1,2})[月/](\d{1,2})日?(?:\s*[（(][日月火水木金土][）)])?\s*(\d{1,2})(?::(\d{2})|時(\d{1,2})分?)/);
    // 「いま出動中」だけを載せるページ（時刻なし）は、最初に見つけた時刻を出動時刻とみなす
    if (!dt && !src.current) continue;
    let f = findCity(line, src);
    // 1つの市だけを扱うページ（市名が書かれない）: 日時のあとの文から町名を読む
    if (!f && src.city) {
      const after = (dt ? line.slice(line.indexOf(dt[0]) + dt[0].length) : line).replace(/^[\s分頃ごろ、,。:]*(?:入電|覚知|発生|出動|出場)?[\s、,]*/, '').replace(/^(?:ただいま|先ほどの?|現在)[、,\s]*/, '');
      const t = townPart(after);
      if (t && t.length <= 15 && !/火災|火事|出動|出場|消防|救急|災害|発生|鎮火|現在|お知らせ/.test(t)) f = { city: src.city, rest: after };
    }
    if (!f) continue;
    const status = cancel ? '誤報' : /鎮火/.test(line) ? '鎮火' : /鎮圧/.test(line) ? '鎮圧' : /出動|出場/.test(line) ? '出動' : null;
    const town = townPart(f.rest);
    if (dt) out.push({ kind, city: f.city, town, at: dt[1] ? new Date(Date.UTC(+dt[1], +dt[2] - 1, +dt[3], +dt[4] - 9, +(dt[5] || dt[6]))).toISOString() : toISO(now, +dt[2], +dt[3], +dt[4], +(dt[5] || dt[6])), status });
    else out.push({ kind, city: f.city, town, at: now.toISOString(), status, key: `${src.id}|${f.city}|${town}|${kind}|${new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10)}` });
  }
  return out;
}

// 消防メールのブログ版（WordPress）: 投稿ごとに読む。本文に日付がないときは投稿日（＋本文の「覚知 05時58分」などの時刻）を使う
function parseWP(html, src, now) {
  const out = [];
  const posts = String(html).split(/<article\b/i).slice(1);
  for (const raw of posts.length ? posts : [String(html)]) {
    const post = ('<article' + raw.split(/<\/article>/i)[0]).replace(/<\/time>|<\/a>/gi, m => m + '\n').replace(/<p\b/gi, '\n<p');
    const lines = htmlText(post);
    const text = lines.join(' ');
    // 本文に日時があれば、文章形式の読み取りでそのまま（投稿日時の欄・見出しは除いて）
    const bodyOnly = htmlText(post.replace(/<time[\s\S]*?<\/time>/gi, '').replace(/<h\d[\s\S]*?<\/h\d>/gi, '').replace(/<(?:div|span|p)[^>]*class=["'][^"']*(?:entry-meta|posted-on|byline|entry-date)[^"']*["'][\s\S]*?<\/(?:div|span|p)>/gi, '')).join(' ');
    const own = parseSentence(`<p>${bodyOnly.replace(/</g, '')}</p>`, src, now);
    if (own.length) { out.push(...own); continue; }
    const iso = (post.match(/<time[^>]+datetime=["']([^"']+)["']/i) || [])[1];
    let d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) { const m = text.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/); if (m) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5])); }
    if (!d || isNaN(d)) continue;
    const j = new Date(d.getTime() + 9 * 3600e3);
    const y = j.getUTCFullYear(), mo = j.getUTCMonth() + 1, da = j.getUTCDate();
    // 本文の覚知・発生の時刻（なければ投稿の時刻）
    const tm = text.match(/(?:覚知|発生|入電|出動)[^0-9]{0,6}(\d{1,2})(?:時|:)(\d{1,2})/) || [null, j.getUTCHours(), j.getUTCMinutes()];
    let at = new Date(Date.UTC(y, mo - 1, da, +tm[1] - 9, +tm[2]));
    if (at - d > 3600e3) at = new Date(at - 864e5);   // 投稿より後の時刻なら前の日
    const body = lines.filter(l => !/^(\d{4}年\d{1,2}月\d{1,2}日|投稿者|カテゴリー|Posted|by )/.test(l)).join(' ');
    const stamp = `${mo}月${da}日${String(at.getTime() === d.getTime() ? j.getUTCHours() : new Date(at.getTime() + 9 * 3600e3).getUTCHours())}時${new Date(at.getTime() + 9 * 3600e3).getUTCMinutes()}分 `;
    const x = parseSentence(`<p>${(stamp + body.replace(/^.*?(?=ただいま|先ほど|[^\s]+[市町村区])/, '')).replace(/</g, '')}</p>`, src, now);
    for (const it of x) out.push({ ...it, at: at.toISOString() });
  }
  return out;
}

export function parseSource(html, src, now = new Date(), opts = {}) {
  const keepMs = (opts.hours || 48) * 3600e3;
  const items = src.type === 'sapporo' ? parseSapporo(html, src, now) : src.type === 'wp' ? parseWP(html, src, now) : parseSentence(html, src, now);
  // 重複（同じ市区町村・町・時刻）を除き、48時間以内のものだけ
  const seen = new Set(), res = [];
  for (const x of items) {
    if (!AREAS[src.pref] || !AREAS[src.pref].includes(x.city)) continue;
    if (now - new Date(x.at) > keepMs || new Date(x.at) - now > 3600e3) continue;
    const k = (x.key || `${x.city}|${x.town}|${x.at}`) + (x.status === '誤報' ? '|誤報' : ''); if (seen.has(k)) continue; seen.add(k);
    res.push({ ...x, pref: src.pref, source: src.id });
  }
  return res;
}

// robots.txt の簡易判定（User-agent: * と自分向けの Disallow を見る）
export function robotsAllows(txt, url, agent = 'kaji23') {
  if (!txt) return true;
  const path = new URL(url).pathname;
  let applies = false, rules = [];
  for (const raw of String(txt).split(/\r?\n/)) {
    const l = raw.replace(/#.*/, '').trim(); if (!l) continue;
    const [k, ...v] = l.split(':'); const val = v.join(':').trim(); const key = k.trim().toLowerCase();
    if (key === 'user-agent') applies = val === '*' || val.toLowerCase().includes(agent);
    else if (applies && (key === 'disallow' || key === 'allow')) rules.push([key, val]);
  }
  let best = null;
  for (const [k, v] of rules) if (v && path.startsWith(v) && (!best || v.length > best[1].length)) best = [k, v];
  return !best || best[0] === 'allow';
}
