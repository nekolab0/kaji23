// X（旧Twitter）の投稿を「口コミ（未確認）」として拾う
//
// 仕組み
//  - 火事が起きている町（消防の発表がある火事、またはサイレン・煙の報告が2件以上ある火事）についてだけ、
//    X API の最近の投稿検索（search/recent）で「町名＋火事・消防車・サイレン・煙」を探す
//  - X API は読み取った投稿1件ごとに課金される（2026年11月時点で1件0.005ドル）。1日の上限 X_DAILY_MAX 件
//    （初期値300件＝1日最大1.5ドル）に達したらその日は止める。同じ火事は30分あけて最大3回まで
//  - 保存するのは投稿のIDと時刻、どの火事・町に当たったかだけ。本文は保存せず、サイトでは X の公式の埋め込みで表示する
//  - X_BEARER（X API のトークン）を Cloudflare の Secret に入れるまでは何もしない（お金はかからない）

const FIRE_WORDS = '(火事 OR 火災 OR 消防車 OR サイレン OR 煙 OR 燃えて OR 燃えてる)';
const NOT_FIRE = /訓練|予防|防災の日|火災報知|警報器|ニュース速報まとめ|求人|保険|キャンプファイヤー/;

export function cityLabel(ward) {
  // 「名古屋市中川区」→「中川区」、「長岡市」→「長岡」
  const m = String(ward).match(/^.+?市(.+区)$/); if (m) return m[1];
  return String(ward).replace(/(市|町|村)$/, '');
}
export function buildQuery(pref, ward, base) {
  // 町名が短い（2文字以下）・よくある名前のときは市区町村名も条件に入れる
  const short = base.length <= 2 || /^(本町|中央|栄町|旭町|新町|元町|東町|西町|南町|北町|大町|仲町|幸町|緑町|宮前|寿町)$/.test(base);
  const place = short ? `"${base}" ("${cityLabel(ward)}" OR "${ward}")` : `"${base}"`;
  return `${FIRE_WORDS} ${place} -is:retweet -is:reply lang:ja`;
}
// 検索結果から、その町の火事についての投稿らしいものだけを残す
export function filterPosts(posts, ward, base) {
  return posts.filter(p => {
    const t = String(p.text || '');
    if (!t.includes(base) || NOT_FIRE.test(t)) return false;
    return /火事|火災|消防車|サイレン|煙|燃え/.test(t);
  });
}

async function setupX(DB) {
  await DB.prepare('CREATE TABLE IF NOT EXISTS sns_posts (id TEXT PRIMARY KEY, src TEXT NOT NULL, inc TEXT, pref TEXT, ward TEXT, base TEXT, at TEXT NOT NULL, found TEXT NOT NULL)').run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_sns_inc ON sns_posts(inc)').run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_sns_area ON sns_posts(pref, ward, base, at)').run();
  await DB.prepare('CREATE TABLE IF NOT EXISTS sns_search (inc TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, last TEXT, found INTEGER NOT NULL DEFAULT 0)').run();
}

export async function pollX(env, now = new Date(), fetcher = fetch) {
  if (!env.X_BEARER) return { skipped: 'X_BEARER が未設定' };
  const DB = env.DB;
  await setupX(DB);
  const max = Math.max(0, parseInt(env.X_DAILY_MAX || '300', 10) || 0);
  const day = now.toISOString().slice(0, 10);
  const usedRow = await DB.prepare('SELECT v FROM meta WHERE k = ?').bind('x_used:' + day).first();
  const used = usedRow ? +usedRow.v : 0;
  const per = 10;   // 1回の検索で読む件数（X API の最小値）
  if (used + per > max) return { skipped: '今日の上限に達しました', used, max };
  // 探す火事: 6時間以内で、町名が分かり、消防の発表があるか報告が2件以上
  const since = new Date(now - 6 * 3600e3).toISOString();
  const { results } = await DB.prepare(`SELECT i.id, i.pref, i.ward, i.base, i.first_at, s.n, s.last FROM incidents i LEFT JOIN sns_search s ON s.inc = i.id
    WHERE i.last_at > ? AND i.base IS NOT NULL AND i.base <> '' AND (i.official = 1 OR i.n >= 2) ORDER BY i.last_at DESC LIMIT 30`).bind(since).all();
  const target = results.find(r => (r.n || 0) < 3 && (!r.last || now - new Date(r.last) > 30 * 60e3));
  if (!target) return { skipped: '探す火事なし', used, max };
  const start = new Date(Math.max(new Date(target.first_at) - 2 * 3600e3, now - 6.9 * 864e5)).toISOString();
  const q = buildQuery(target.pref, target.ward, target.base);
  const u = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=${per}&start_time=${start}&tweet.fields=created_at,lang`;
  let data = {}, status = 0;
  try {
    const r = await fetcher(u, { headers: { Authorization: 'Bearer ' + env.X_BEARER, 'User-Agent': 'kaji23-bot/1.0' } });
    status = r.status; data = r.ok ? await r.json() : {};
  } catch (e) { status = -1; }
  const posts = data.data || [];
  const charged = (data.meta && data.meta.result_count) || posts.length;
  await DB.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind('x_used:' + day, String(used + charged)).run();
  const keep = filterPosts(posts, target.ward, target.base);
  for (const p of keep) {
    await DB.prepare('INSERT OR IGNORE INTO sns_posts (id, src, inc, pref, ward, base, at, found) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(String(p.id), 'x', target.id, target.pref, target.ward, target.base, p.created_at || now.toISOString(), now.toISOString()).run();
  }
  await DB.prepare('INSERT INTO sns_search (inc, n, last, found) VALUES (?, 1, ?, ?) ON CONFLICT(inc) DO UPDATE SET n = sns_search.n + 1, last = excluded.last, found = sns_search.found + excluded.found')
    .bind(target.id, now.toISOString(), keep.length).run();
  return { inc: target.id, query: q, status, read: charged, kept: keep.length, used: used + charged, max };
}

// サイト用: 火事・町に当たった投稿（IDと時刻だけ）
export async function snsFor(env, { inc, pref, ward, base, since }) {
  try {
    if (inc) return (await env.DB.prepare('SELECT id, at FROM sns_posts WHERE inc = ? ORDER BY at DESC LIMIT 12').bind(inc).all()).results;
    return (await env.DB.prepare('SELECT id, at FROM sns_posts WHERE pref = ? AND ward = ? AND base = ? AND at > ? ORDER BY at DESC LIMIT 12').bind(pref, ward, base, since).all()).results;
  } catch (e) { return []; }   // 表がまだない（X を使っていない）
}
