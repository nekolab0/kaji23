// 全国の報道抽出のテスト（見出しは検査用に作った架空のもの）
import { createRequire } from 'node:module'; import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { buildGeo, extractFireNewsJP } = require('./news_jp.js');
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
if (merged.length === 1 && merged[0].sources.length === 2 && merged[0].town === '栄') ok++; else fails.push('同じ火事がまとまらない ' + JSON.stringify(merged.map(m => [m.city, m.town, m.sources.length])));
console.log(`${ok}/${cases.length + 1} 合格`); fails.forEach(f => console.log('FAIL ' + f));
process.exit(fails.length ? 1 : 0);
