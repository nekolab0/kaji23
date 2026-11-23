// 全国の報道抽出のテスト（見出しは検査用に作った架空のもの）
import { createRequire } from 'node:module'; import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { buildGeo, extractFireNewsJP, pinKnownPubDates, rememberNews, dropReattributed } = require('./news_jp.js');
const areas = JSON.parse(fs.readFileSync(new URL('../data/raw/areas.json', import.meta.url)));
const towns = JSON.parse(fs.readFileSync(new URL('../data/raw/towns_jp.json', import.meta.url))).towns;
const geo = buildGeo(areas, towns);
const now = '2026-11-03T12:00:00Z', t = h => new Date(Date.parse(now) - h * 36e5).toUTCString();
const cases = [
  ['名古屋市中区栄で建物火災 けが人なし - 中京テレビ', ['愛知県', '名古屋市中区', '栄']],
  ['横浜市神奈川区三ツ沢下町で住宅火災 1人搬送 - tvk', ['神奈川県', '横浜市神奈川区', '三ツ沢下町']],
  ['東京・北区赤羽西の住宅で火事 - NHK', ['東京都', '北区', '赤羽西']],
  ['大阪市北区梅田のビルで火事 - 読売新聞', ['大阪府', '大阪市北区', '梅田']],
  ['広島県府中市で住宅全焼 - 中国新聞', ['広島県', '府中市', null]],
  ['府中市で火事 - どこか', null],                                  // 東京都と広島県にあるので決めない
  ['札幌市北区で住宅火災 - HBC', ['北海道', '札幌市北区', null]],
  ['京都市伏見区で火事 - 京都新聞', ['京都府', '京都市伏見区', null]],
  ['東京都江東区大島で火事 - TBS', ['東京都', '江東区', '大島']],
  ['神奈川県小田原市で山林火災 - tvk', ['神奈川県', '小田原市', null]],
  ['消防団の訓練で火災を想定 - 新聞', null],
  ['北海道泊村で住宅火災 - HBC', ['北海道', '泊村', null]],
  // 見出しで「市・町・村」を省いた書き方
  ['三重・津の住宅火災 4人死亡 - 毎日新聞', ['三重県', '津市', null]],
  ['【火事】下松の事業所で倉庫全焼 - 中国新聞', ['山口県', '下松市', null]],
  ['珠洲で住宅全焼の火事 - HAB', ['石川県', '珠洲市', null]],
  ['兵庫 宍粟 住宅火災で1人死亡 - 神戸新聞', ['兵庫県', '宍粟市', null]],
  ['【速報】長岡駅近くで火災 - 新潟', ['新潟県', '長岡市', null]],
  ['西立神町で住宅1棟が全焼 けが人なし - KTN', ['長崎県', '長崎市', '西立神町']],
  ['山田さん宅で火事 - 新聞', null],                                  // 名字は地名にしない
  ['津波避難ビルで火災訓練 - 新聞', null],
  ['東北の山林火災 - 新聞', null],
  // 市の名前を省いた区（区のすぐ後ろの町名で市を決める）・よく知られた地区の呼び名（2026-11-22）
  ['「ストーブから出火」南区西長住の2階建て住宅で火災 - KBC', ['福岡県', '福岡市南区', '西長住']],
  ['南区で住宅火災 - どこか', null],
  ['中央区日本橋の雑居ビルで火事 - どこか', null],                    // 東京の中央区と大阪市中央区の両方にある（PR #51 の検証役の指摘）
  ['北区赤羽西の住宅で火事 - どこか', null],
  ['港区芝浦の倉庫で火災 - どこか', null],                                  // 町名がないと、どの市の南区か決めない
  ['【速報】大阪・心斎橋 商店街近くの6階建てビルで火事 - MBS', ['大阪府', '大阪市中央区', null]],
  ['「煙が充満」大阪・ミナミのビルで火事 - ABC', ['大阪府', '大阪市中央区', null]],
  ['東心斎橋のビルで火災 - 新聞', ['大阪府', '大阪市中央区', '東心斎橋']],
];
let ok = 0; const fails = [];
for (const [title, want] of cases) {
  const r = extractFireNewsJP([{ title, link: 'https://x/' + title, pubDate: t(1), source: 'テスト' }], geo, { now })[0];
  const got = r ? [r.pref, r.city, r.town] : null;
  if (JSON.stringify(got) === JSON.stringify(want)) ok++; else fails.push(`${title} → ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`);
}
// 同じ火事をまとめる
const merged = extractFireNewsJP([
  { title: '名古屋市中区栄で建物火災', link: 'https://a', pubDate: t(3), source: '中京テレビ' },
  { title: '名古屋・中区栄のビル火災 けが人なし', link: 'https://b', pubDate: t(2), source: 'NHK' }], geo, { now });
if (merged.length === 1 && merged[0].sources.length === 2 && merged[0].town === '栄' && !merged[0].injured) ok++; else fails.push('同じ火事がまとまらない ' + JSON.stringify(merged.map(m => [m.city, m.town, m.sources.length])));
// 否定の見出しを、けが人・死者ありと読まない（2026-11-23・E014 の検証役の指摘）
const HARM_CASES = [['西立神町で住宅1棟が全焼 けが人なし - KTN', false, false], ['名古屋市中区栄で建物火災 死者はいない - NHK', false, false],
  ['横浜市神奈川区三ツ沢下町で住宅火災 1人搬送 - tvk', true, false], ['西立神町で住宅火災 1人死亡 - KTN', false, true], ['名古屋市中区栄で火災 けが人なし 1人死亡', false, true]];
for (const [title, inj, dead] of HARM_CASES) {
  const r = extractFireNewsJP([{ title, link: 'https://h/' + title, pubDate: t(1), source: 'テスト' }], geo, { now })[0];
  if (r && r.injured === inj && r.dead === dead) ok++; else fails.push('けが人・死者の読み ' + title + ' ' + JSON.stringify(r && [r.injured, r.dead]));
}
// 更新された古い記事（同じ link・新しい pubDate）を、今日の火事にしない（2026-11-18。豊後高田市の 11/8 の記事が 11/16 に再び出た型）
let extra = 0;
{
  const known = rememberNews({}, [['https://news.google.com/rss/articles/OLD?oc=5', new Date(Date.parse(now) - 8 * 864e5).toISOString()],
    ['https://news.google.com/rss/articles/NEW2?oc=5', new Date(Date.parse(now) - 5 * 36e5).toISOString()]], new Date(now));
  const its = [{ title: '大分県豊後高田市で住宅全焼', link: 'https://news.google.com/rss/articles/OLD?oc=5', pubDate: t(1), source: 'A' },
    { title: '名古屋市中区栄で建物火災', link: 'https://news.google.com/rss/articles/NEW2?oc=5', pubDate: t(1), source: 'B' },
    { title: '札幌市北区で住宅火災', link: 'https://news.google.com/rss/articles/FRESH?oc=5', pubDate: t(1), source: 'C' }];
  const n = pinKnownPubDates(its, known);
  const r = extractFireNewsJP(its, geo, { now, maxAgeHours: 48 });
  const ids = r.map(x => x.city + ':' + (Date.parse(now) - Date.parse(x.first)) / 36e5).sort();
  extra++;
  if (n === 2 && JSON.stringify(ids) === JSON.stringify(['名古屋市中区:5', '札幌市北区:1'])) ok++; else fails.push('更新された古い記事の扱い ' + n + ' ' + JSON.stringify(ids));
  rememberNews(known, r.articles, new Date(now));
  extra++;
  if (Object.keys(known).length === 3 && JSON.parse(JSON.stringify(r)).articles === undefined && r.articles.length === 2) ok++; else fails.push('記事の記録 ' + Object.keys(known).length);
  rememberNews(known, [], new Date(Date.parse(now) + 25 * 864e5));   // 30日より前の記録は消える
  extra++;
  if (Object.keys(known).length === 2) ok++; else fails.push('古い記録の削除 ' + Object.keys(known).length);
}
{
  // 前の回に別の日の火事に使った続報の記事だけが残った回（2026-11-20 山形市印役町の型）。別の日の火事を作らない
  const L = 'https://news.google.com/rss/articles/FOLLOW?oc=5';
  const prev = [{ id: '山形県-山形市-印役町-2026-11-19', sources: [{ name: 'A', link: 'https://news.google.com/rss/articles/FIRST?oc=5' }, { name: 'B', link: L }] }];
  const its = [{ title: '山形市印役町の車両火災 けが人', link: L, pubDate: t(1), source: 'B' },
    { title: '札幌市北区で住宅火災', link: 'https://news.google.com/rss/articles/OTHER?oc=5', pubDate: t(1), source: 'C' }];
  const r = extractFireNewsJP(its, geo, { now, maxAgeHours: 48 });
  const n = dropReattributed(r, prev);
  extra++;
  if (n === 1 && r.length === 1 && r[0].city === '札幌市北区') ok++; else fails.push('続報の記事だけの火事 ' + n + ' ' + JSON.stringify(r.map(x => x.id)));
  // 同じ id の火事なら、記事は外さない（前の回と同じ火事の更新）
  const r2 = extractFireNewsJP(its.slice(0, 1), geo, { now, maxAgeHours: 48 });
  const n2 = dropReattributed(r2, [{ id: r2[0].id, sources: [{ name: 'B', link: L }] }]);
  extra++;
  if (n2 === 0 && r2.length === 1) ok++; else fails.push('同じ火事の更新 ' + n2 + ' ' + r2.length);
  // ほかの記事も持つ火事は、使用済みの記事だけ外して残す（2026-11-19 墨田区向島の型）
  const its3 = [{ title: '墨田区向島の共同住宅で火災 1人死亡', link: L, pubDate: t(3), source: 'B' },
    { title: '墨田区向島で火事 1人死亡', link: 'https://news.google.com/rss/articles/NEW3?oc=5', pubDate: t(2), source: 'D' }];
  const r3 = extractFireNewsJP(its3, geo, { now, maxAgeHours: 48 });
  const n3 = dropReattributed(r3, [{ id: '東京都-墨田区-向島-2026-11-01', sources: [{ name: 'B', link: L }] }]);
  extra++;
  if (n3 === 1 && r3.length === 1 && r3[0].sources.length === 1 && r3[0].sources[0].name === 'D') ok++; else fails.push('使用済みの記事だけ外す ' + n3 + ' ' + JSON.stringify(r3));
}
console.log(`${ok}/${cases.length + 1 + HARM_CASES.length + extra} 合格`); fails.forEach(f => console.log('FAIL ' + f));
process.exit(fails.length ? 1 : 0);
