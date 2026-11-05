// X の投稿の取り込みテスト（X API はまねたもの。お金はかからない）
import { buildQuery, filterPosts, cityLabel, pollX, snsFor } from './src/xposts.js';
import { DatabaseSync } from 'node:sqlite';
const results = []; const ok = (n, c, d = '') => results.push({ name: n, ok: !!c, detail: String(d) });
ok('市区町村の短い名前', cityLabel('名古屋市中川区') === '中川区' && cityLabel('長岡市') === '長岡');
ok('検索の条件: 長い町名は町名だけ', buildQuery('新潟県', '長岡市', '今朝白') === '(火事 OR 火災 OR 消防車 OR サイレン OR 煙 OR 燃えて OR 燃えてる) "今朝白" -is:retweet -is:reply lang:ja');
ok('検索の条件: よくある町名は市区町村名も', buildQuery('新潟県', '長岡市', '本町').includes('"本町" ("長岡" OR "長岡市")'));
const f = filterPosts([{ id: '1', text: '今朝白で火事？煙すごい' }, { id: '2', text: '今朝白で防災訓練、消防車がきてる' }, { id: '3', text: '火事こわい' }, { id: '4', text: '今朝白のラーメン屋' }], '長岡市', '今朝白');
ok('町名と火事の言葉がある投稿だけ・訓練は除く', f.length === 1 && f[0].id === '1', JSON.stringify(f));

// D1 をまねる
const db = new DatabaseSync(':memory:');
const wrap = sql => ({ _a: [], bind(...a) { this._a = a; return this; }, run() { db.prepare(sql).run(...this._a); return {}; }, all() { return { results: db.prepare(sql).all(...this._a) }; }, first() { return db.prepare(sql).get(...this._a) || null; } });
const env = { DB: { prepare: sql => wrap(sql) }, X_DAILY_MAX: '20' };
db.exec("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL); CREATE TABLE incidents (id TEXT PRIMARY KEY, pref TEXT, ward TEXT, base TEXT, first_at TEXT, last_at TEXT, n INTEGER, official INTEGER)");
const now = new Date('2026-11-05T08:00:00Z');
db.prepare('INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?)').run('abc', '新潟県', '長岡市', '今朝白', '2026-11-05T07:30:00Z', '2026-11-05T07:40:00Z', 1, 1);
db.prepare('INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?)').run('old', '新潟県', '長岡市', '中', '2026-11-04T07:30:00Z', '2026-11-04T07:40:00Z', 5, 1);
let calls = 0, lastUrl = '';
const fetcher = async (u, o) => { calls++; lastUrl = u; ok('トークンを付けて呼ぶ', o.headers.Authorization === 'Bearer t'); return new Response(JSON.stringify({ data: [{ id: '111', text: '今朝白で火事？煙が見える', created_at: '2026-11-05T07:35:00Z' }, { id: '222', text: '今朝白の訓練', created_at: '2026-11-05T07:36:00Z' }], meta: { result_count: 10 } }), { status: 200 }); };
const r0 = await pollX(env, now, fetcher);
ok('トークンがなければ何もしない（お金がかからない）', r0.skipped && calls === 0, JSON.stringify(r0));
env.X_BEARER = 't';
const r1 = await pollX(env, now, fetcher);
ok('6時間以内の火事を検索し、合う投稿だけ保存', calls === 1 && r1.inc === 'abc' && r1.kept === 1 && r1.used === 10 && lastUrl.includes(encodeURIComponent('"今朝白"')), JSON.stringify(r1));
const r2 = await pollX(env, new Date(now.getTime() + 5 * 60e3), fetcher);
ok('同じ火事は30分あける', calls === 1 && r2.skipped, JSON.stringify(r2));
const r3 = await pollX(env, new Date(now.getTime() + 31 * 60e3), fetcher);
ok('上限（20件）まで: 2回目で使い切り', calls === 2 && r3.used === 20, JSON.stringify(r3));
const r4 = await pollX(env, new Date(now.getTime() + 62 * 60e3), fetcher);
ok('上限に達したらその日は止める', calls === 2 && /上限/.test(r4.skipped), JSON.stringify(r4));
const s1 = await snsFor(env, { inc: 'abc' }), s2 = await snsFor(env, { pref: '新潟県', ward: '長岡市', base: '今朝白', since: '2026-11-01T00:00:00Z' });
ok('サイト用: IDと時刻だけを返す', s1.length === 1 && s1[0].id === '111' && Object.keys(s1[0]).join() === 'id,at' && s2.length === 1, JSON.stringify(s1));
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? ' — ' + r.detail : ''}`));
process.exit(results.some(r => !r.ok) ? 1 : 0);
