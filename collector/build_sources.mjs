// 調査結果（verify/probe_sources.json）から、受付サーバーが読む消防の出動情報ページの一覧を作る
//  → worker/src/sources_auto.js（手で書いた一覧 official.js の SOURCES に足される）
//
// 入れるもの
//  1. 過去30日の火災が実際に読めたページ（過去の一覧をたどって読めたものは、その一覧のページ）
//  2. 「いま出動中」だけを出すページ（いまは火災がなく空でも、起きたときに読む）: 文言で見分ける
//  3. 消防メールのブログ版（ktaiwork）で、火災のカテゴリーが分かっているもの（KTAIWORK）
import fs from 'node:fs';
import { SOURCES as ALL } from '../worker/src/official.js';
const MANUAL = ALL.filter(s => !String(s.id).startsWith('a-'));
import { AREAS } from '../worker/src/areas.js';

const probe = JSON.parse(fs.readFileSync(new URL('../verify/probe_sources.json', import.meta.url), 'utf8'));
const OUT = new URL('../worker/src/sources_auto.js', import.meta.url);

// 消防メールのブログ版（WordPress）。火災のカテゴリーの一覧ページを読む
export const KTAIWORK = [
  { url: 'https://nagoya-fd.site2.ktaiwork.jp/?cat=2', name: '名古屋市消防局（火災情報メール）', pref: '愛知県', wardCity: '名古屋市' },
  { url: 'https://kagoshima-city-fd.site.ktaiwork.jp/?cat=2', name: '鹿児島市消防局（安心ネットワーク119）', pref: '鹿児島県', city: '鹿児島市' },
  { url: 'https://fukuyama-fd.site2.ktaiwork.jp/', name: '福山地区消防組合（火災情報メール）', pref: '広島県', city: '福山市' },
  { url: 'http://kohoku-fd.site.ktaiwork.jp/', name: '湖北地域消防本部（火災情報）', pref: '滋賀県' },
  { url: 'https://kashiwa-city.site2.ktaiwork.jp/?cat=3', name: '柏市（かしわメール配信サービス 火災情報）', pref: '千葉県', city: '柏市' },
  { url: 'https://hadano-city.site.ktaiwork.jp/?cat=5', name: '秦野市（メール配信 火災情報）', pref: '神奈川県', city: '秦野市' },
  { url: 'https://ueda-city.site.ktaiwork.jp/?cat=6', name: '上田市（メール配信 火災情報）', pref: '長野県', city: '上田市' },
  { url: 'https://joetsu-city.site.ktaiwork.jp/category/%E7%81%AB%E7%81%BD%E6%83%85%E5%A0%B1/', name: '上越市（安全メール 火災情報）', pref: '新潟県', city: '上越市' },
  { url: 'https://aizuwakamatsu-fd.site2.ktaiwork.jp/', name: '会津若松地方広域市町村圏整備組合消防本部（火災情報）', pref: '福島県' },
  { url: 'https://miyazaki-pref.site.ktaiwork.jp/category/%E6%B6%88%E9%98%B2/', name: '宮崎県内の消防本部（火災情報メール）', pref: '宮崎県' },
  { url: 'https://hikone-city.site.ktaiwork.jp/', name: '彦根市（メール配信システム）', pref: '滋賀県', city: '彦根市' },
];

// 「いま出動中」型ページの文言（火災がないときの表示）
const CURRENT = /発生しておりません|発生していません|現在.{0,12}(?:災害|火災).{0,8}(?:ありません|発生)|出動中の災害|現在の火災・事故発生情報|現在の災害出動/;
const idOf = u => 'a-' + u.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase();
function areaOf(pref, cities) {
  const s = { pref };
  const desig = cities.find(c => (AREAS[pref] || []).some(n => n.startsWith(c) && n !== c && n.endsWith('区')));
  if (desig) s.wardCity = desig;
  if (cities.length === 1 && (AREAS[pref] || []).includes(cities[0])) s.city = cities[0];
  return s;
}
const manualUrls = new Set(MANUAL.map(s => s.url));
const byUrl = new Map();
const add = (url, x) => {
  if (manualUrls.has(url) || /119\.city\.sapporo\.jp/.test(url)) return;   // 札幌圏は手で書いた一覧（表の書式）
  const cur = byUrl.get(url);
  if (cur) { cur.cities = [...new Set([...cur.cities, ...x.cities])]; return; }
  byUrl.set(url, x);
};
for (const c of probe.checks) {
  if (c.status !== 'ok') continue;
  const lines = (c.fireLines || []).join('\n');
  if (c.items30d > 0) add(c.followed ? c.followed.url : c.url, { pref: c.pref, cities: c.cities, why: '過去30日に' + c.items30d + '件' });
  else if (CURRENT.test(lines)) add(c.url, { pref: c.pref, cities: c.cities, why: 'いま出動中型', current: (c.dates || 0) <= 2 });
}
const out = [];
for (const [url, x] of byUrl) {
  const a = areaOf(x.pref, x.cities);
  out.push({ id: idOf(url), name: `${x.cities.slice(0, 3).join('・')}${x.cities.length > 3 ? 'ほか' : ''}の消防（出動情報）`, url, ...a, type: 'sentence', ...(x.current ? { current: true } : {}), why: x.why });
}
for (const k of KTAIWORK) if (!manualUrls.has(k.url) && !byUrl.has(k.url)) out.push({ id: idOf(k.url), type: 'sentence', ...k, why: '消防メール' });
// 同じ id が重ならないように
const seen = new Set(); const list = out.filter(s => !seen.has(s.id) && seen.add(s.id));
fs.writeFileSync(OUT, `// 自動生成（collector/build_sources.mjs）: 全国の消防の出動情報ページ。調査 ${probe.generatedAt.slice(0, 10)}・${list.length}ページ\n// 手で直すときは official.js の SOURCES に書く（こちらは作り直すと上書きされる）\nexport const AUTO_SOURCES = ${JSON.stringify(list.map(({ why, ...s }) => s), null, 1)};\n`);
console.log(`一覧 ${list.length}ページ（過去30日に読めた ${list.filter(s => /件/.test(s.why)).length}・いま出動中型 ${list.filter(s => s.why === 'いま出動中型').length}・消防メール ${list.filter(s => s.why === '消防メール').length}）`);
