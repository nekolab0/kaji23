// 報道ニュースから23区の火事を抽出（ブラウザ／Node共通）
// 入力: RSSの item 配列 [{title, link, pubDate, source}]、町名リスト {区名: [町名...]}
// 出力: 火事ごとにまとめた配列（同じ火事を複数社が報じたら1件に統合）
// 方針: 見出しの文章は載せない。区・町名・建物の種類・時刻・けが人の有無だけを取り出し、元記事へリンクする。
function extractFireNews(items, townsByWard, opts = {}) {
  const WARDS = Object.keys(townsByWard);
  const now = opts.now ? new Date(opts.now) : new Date();
  const maxAgeH = opts.maxAgeHours || 72;
  const z2h = s => String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[･・]/g, '・');
  const KANJI_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const NOT_INCIDENT = /訓練|予防|啓発|呼びかけ|放送文化|時の話題|特集|振り返|判決|裁判|初公判|起訴|送検|再逮捕|年前|周年|統計|まとめ|ランキング|映画|ドラマ|イベント/;
  const SENSITIVE = /自殺|死のう|心中|自ら火|焼身/; // 文言は表示しない（事実の抽出だけに使う）
  const BUILDING = [['共同住宅', /共同住宅|アパート|マンション|団地/], ['住宅', /住宅|民家|一軒家|戸建/], ['飲食店', /飲食店|店舗|ラーメン|居酒屋|レストラン/],
                    ['ビル', /ビル|雑居/], ['工場・倉庫', /工場|倉庫|作業場/], ['車両', /車両|車が|乗用車|トラック|バス/], ['施設', /グループホーム|施設|病院|学校|寺|神社/]];

  // 町名リストを「町名の本体（丁目を除く）」で引けるようにする
  const townIndex = {};
  for (const w of WARDS) townIndex[w] = [...new Set(townsByWard[w].map(t => t.replace(/[0-9０-９].*$/, '').replace(/（.*$/, '')).filter(t => t.length >= 2))].sort((a, b) => b.length - a.length);

  const out = [];
  for (const it of items) {
    const title = z2h(it.title || '').replace(/\s+-\s+[^-]+$/, ''); // 末尾の媒体名を除く
    if (!/火事|火災|全焼|半焼|燃え/.test(title) || NOT_INCIDENT.test(title)) continue;
    const AMBIG = ['北区', '中央区', '港区'];
    const ward = WARDS.find(w => {
      const i = title.indexOf(w); if (i < 0) return false;
      if (i > 0 && title[i - 1] === '市') return false;                 // 大阪市北区・札幌市中央区など
      if (AMBIG.includes(w) && !title.includes('東京')) return false;
      return title.includes('東京') || !/(神奈川|埼玉|千葉|横浜|川崎市|大阪|名古屋|札幌|福岡|神戸|京都)/.test(title);
    });
    if (!ward) continue;
    const pub = new Date(it.pubDate);
    if (isNaN(pub) || (now - pub) / 36e5 > maxAgeH || pub > now) continue;
    // 町名: 「江東区大島」「港区白金」のように区名の直後、または見出し中の既知の町名
    let town = null;
    const after = title.slice(title.indexOf(ward) + ward.length);
    town = townIndex[ward].find(t => after.startsWith(t)) || townIndex[ward].find(t => t.length >= 3 && title.includes(t)) || null;
    let chome = null;
    if (town) {
      const m = after.slice(after.indexOf(town) + town.length).match(/^([0-9]+|[一二三四五六七八九十]+)丁目/);
      if (m) chome = /^\d+$/.test(m[1]) ? +m[1] : (m[1].length === 1 ? KANJI_NUM[m[1]] : (m[1] === '十' ? 10 : null));
    }
    const building = (BUILDING.find(([, re]) => re.test(title)) || ['建物不明'])[0];
    const injured = /けが|負傷|重傷|軽傷|搬送|やけど/.test(title);
    const dead = /死亡|死者|遺体|心肺停止/.test(title);
    let source = (it.source || '').trim() || (title.match(/（([^）]+)）$/) || [])[1] || '報道';
    if (/^https?:\/\//.test(source)) { try { source = new URL(source).hostname.replace(/^www\./, ''); } catch (e) {} }
    out.push({ ward, town, chome, building, injured, dead, sensitive: SENSITIVE.test(title), pub: pub.toISOString(), source, link: it.link });
  }
  // 同じ火事をまとめる: 同じ区で、町名が一致（または片方が不明）し、36時間以内
  out.sort((a, b) => a.pub.localeCompare(b.pub));
  const incidents = [];
  for (const n of out) {
    const hit = incidents.find(x => x.ward === n.ward && (!x.town || !n.town || x.town === n.town) &&
      (x.building === n.building || x.building === '建物不明' || n.building === '建物不明') && Math.abs(new Date(n.pub) - new Date(x.first)) / 36e5 < (x.town && n.town ? 72 : 36));
    if (hit) {
      hit.town = hit.town || n.town; hit.chome = hit.chome || n.chome;
      if (hit.building === '建物不明') hit.building = n.building;
      hit.injured ||= n.injured; hit.dead ||= n.dead; hit.sensitive ||= n.sensitive;
      if (!hit.sources.some(s => s.name === n.source)) hit.sources.push({ name: n.source, link: n.link, pub: n.pub });
      hit.last = n.pub;
    } else incidents.push({ ward: n.ward, town: n.town, chome: n.chome, building: n.building, injured: n.injured, dead: n.dead,
                            sensitive: n.sensitive, first: n.pub, last: n.pub, sources: [{ name: n.source, link: n.link, pub: n.pub }] });
  }
  // 1社だけ・町名不明・単語が曖昧なものは信頼度を下げる
  // 一次の報道機関を先に（ポータル・まとめは後ろ）
  const PRI = /NHK|TBS|テレ朝|日テレ|FNN|フジ|テレビ東京|共同|時事|産経|読売|朝日新聞|毎日|東京新聞|ABEMA/;
  incidents.forEach(x => { x.sources.sort((a, b) => (PRI.test(b.name) ? 1 : 0) - (PRI.test(a.name) ? 1 : 0)); x.sources = x.sources.slice(0, 3); x.confidence = x.sources.length >= 2 || x.town ? 'high' : 'low'; x.id = `${x.ward}-${x.town || 'x'}-${x.first.slice(0, 10)}`; });
  return incidents.reverse();
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
if (typeof module !== 'undefined') module.exports = { extractFireNews, parseRSS };
