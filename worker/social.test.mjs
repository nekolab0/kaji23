// X 以外の SNS への自動投稿のテスト（キューの受け付け・上限・間隔・期限・二重投稿の防止・各配信先への送り方）
import { makeEnv } from './test.mjs';
import { handle } from './src/index.js';
import { socialTick, bskyFacets, enqueue } from './src/social.js';
const results = []; const ok = (n, c, d = '') => results.push({ name: n, ok: !!c, detail: String(d) });
const t0 = new Date('2026-11-25T03:00:00Z');   // 日本時間 12:00
const at = min => new Date(+t0 + min * 60e3);
const req = (m, p, b, key) => new Request('https://w.example' + p, { method: m, body: b && JSON.stringify(b), headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) } });
const page = n => `https://kajisoku.jp/f-n-test-${n}.html`;
const item = (n, firstMin = -30, expMin = 600, extra = {}) => ({
  id: 'n-test-' + n, kind: 'fire_post', first: at(firstMin).toISOString(), expires: at(expMin).toISOString(), page: page(n), place: '町' + n,
  posts: {
    bsky: { text: `【火事】町${n}で火事が報道されました。\n#火事 #テスト`, url: page(n) + '?utm_source=bsky&utm_medium=social&utm_campaign=fire_post', image: `https://kajisoku.jp/og/f/test-${n}.png`, title: `町${n}の火事｜火事速`, desc: '説明' },
    misskey: { text: `【火事】町${n}で火事。\n${page(n)}?utm_source=misskey&utm_medium=social&utm_campaign=fire_post\n#火事` },
    mastodon: { text: `【火事】町${n}で火事。\n${page(n)}?utm_source=mastodon&utm_medium=social&utm_campaign=fire_post\n#火事` },
    threads: { text: `【火事】町${n}で火事。 #火事`, url: page(n) + '?utm_source=threads&utm_medium=social&utm_campaign=fire_post' },
    ...extra,
  } });

const { env, db } = makeEnv();
// 鍵がないとき・違うとき
let r = await handle(req('POST', '/api/social/enqueue', { items: [item(1)] }), env, t0);
ok('SOCIAL_KEY が未設定なら受け付けない（503）', r.status === 503, r.status);
env.SOCIAL_KEY = 'k1';
r = await handle(req('POST', '/api/social/enqueue', { items: [item(1)] }, 'wrong'), env, t0);
ok('鍵が違えば 401', r.status === 401, r.status);
r = await handle(req('POST', '/api/social/enqueue', { items: [item(1), item(2, -10), item(3, -500, -1)] }, 'k1'), env, t0);
let j = await r.json();
ok('キューを受け付ける（期限切れは断る）', r.status === 200 && j.added === 8 && j.skipped.some(s => /n-test-3: 期限切れ/.test(s)), JSON.stringify(j));
r = await handle(req('POST', '/api/social/enqueue', { items: [item(1)] }, 'k1'), env, t0);
j = await r.json();
ok('同じ火事を2回送っても1回分だけ', j.added === 0, JSON.stringify(j));
j = await enqueue(env, { items: [item(4, -10, 600, { misskey: { text: '【火事】けが人がいます https://kajisoku.jp/x.html' }, mastodon: { text: '【火事】 https://evil.example/' } })] }, t0);
ok('書かない言葉・火事速以外のリンクは断る', j.skipped.some(s => /n-test-4\/misskey: 書かない言葉/.test(s)) && j.skipped.some(s => /n-test-4\/mastodon: 火事速以外のリンク/.test(s)), JSON.stringify(j));

// Secret がないうちは何も投稿しない
const calls = [];
const fetcher = async (u, o = {}) => {
  calls.push({ u, o });
  if (u.endsWith('/xrpc/com.atproto.server.createSession')) return Response.json({ accessJwt: 'jwt', did: 'did:plc:abc' });
  if (u.startsWith('https://kajisoku.jp/og/')) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
  if (u.endsWith('/xrpc/com.atproto.repo.uploadBlob')) return Response.json({ blob: { $type: 'blob', ref: { $link: 'b1' }, mimeType: 'image/png', size: 4 } });
  if (u.endsWith('/xrpc/com.atproto.repo.createRecord')) return Response.json({ uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz', cid: 'c' });
  if (u === 'https://misskey.io/api/notes/create') return env.MISSKEY_FAIL ? new Response('rate', { status: 429 }) : Response.json({ createdNote: { id: 'mk1' } });
  if (u === 'https://mstdn.example/api/v1/statuses') return Response.json({ id: 'm1', url: 'https://mstdn.example/@kajisoku/m1' });
  return new Response('', { status: 404 });
};
let o = await socialTick(env, t0, fetcher);
ok('Secret がない配信先は飛ばす（何も送らない）', Object.keys(o).length === 0 && calls.length === 0, JSON.stringify(o));

env.BSKY_HANDLE = 'kajisoku.jp'; env.BSKY_APP_PASSWORD = 'pw'; env.MISSKEY_HOST = 'misskey.io'; env.MISSKEY_TOKEN = 't'; env.MASTODON_HOST = 'https://mstdn.example/'; env.MASTODON_TOKEN = 't2';
env.SOCIAL_PAUSE = '1';
o = await socialTick(env, t0, fetcher);
ok('SOCIAL_PAUSE で全部止まる', o.paused && calls.length === 0);
delete env.SOCIAL_PAUSE;

o = await socialTick(env, t0, fetcher);
ok('3つの配信先に1件ずつ投稿する', o.bsky === 'ok' && o.misskey === 'ok' && o.mastodon === 'ok' && !o.threads, JSON.stringify(o));
const rec = JSON.parse(calls.find(c => c.u.endsWith('createRecord')).o.body);
ok('Bluesky：新しい火事から・リンクカード（画像つき）・ハッシュタグ', /町2/.test(rec.record.text) && rec.record.embed.external.uri.includes('utm_source=bsky') && rec.record.embed.external.thumb.ref.$link === 'b1'
  && rec.record.facets.length === 2 && rec.record.facets[0].features[0].tag === '火事', JSON.stringify(rec.record));
const tagStart = new TextEncoder().encode(rec.record.text).length - new TextEncoder().encode('#火事 #テスト').length;
ok('Bluesky：ハッシュタグの位置は UTF-8 のバイトで数える', rec.record.facets[0].index.byteStart === tagStart && rec.record.facets[0].index.byteEnd === tagStart + 7, JSON.stringify(rec.record.facets));
const mk = calls.find(c => c.u.includes('notes/create'));
ok('Misskey：公開範囲は「ホーム」・トークンは見出しで送る', JSON.parse(mk.o.body).visibility === 'home' && mk.o.headers.Authorization === 'Bearer t');
const ms = calls.find(c => c.u.includes('/api/v1/statuses'));
ok('Mastodon：未収載・二重送信の防止キー', ms.o.body.get('visibility') === 'unlisted' && ms.o.headers['Idempotency-Key'] === 'n-test-2|mastodon');

o = await socialTick(env, at(10), fetcher);
ok('20分たつまでは次を投稿しない', o.bsky === 'gap' && o.misskey === 'gap', JSON.stringify(o));
env.MISSKEY_FAIL = '1';
o = await socialTick(env, at(21), fetcher);
const left = db.prepare("SELECT id FROM social_posts WHERE dest = 'bsky' ORDER BY at").all().map(x => x.id);
ok('20分たったら次の火事（発生の新しい順）・同じ火事は二度出さない', o.bsky === 'ok' && left.join() === 'n-test-2,n-test-4', left.join());
ok('失敗は記録してエラーにしない', o.misskey === 'error' && db.prepare("SELECT tries FROM social_posts WHERE dest='misskey' AND id='n-test-1'").get().tries === 1, JSON.stringify(o));
delete env.MISSKEY_FAIL;
o = await socialTick(env, at(42), fetcher);
ok('失敗した投稿はもう1回だけやり直す', o.misskey === 'ok' && db.prepare("SELECT status, tries FROM social_posts WHERE dest='misskey' AND id='n-test-1'").get().tries === 2, JSON.stringify(o));
o = await socialTick(env, at(63), fetcher);
ok('出すものがなくなったら何もしない（n-test-4 は Misskey・Mastodon では断ったので入っていない）', o.misskey === 'empty' && o.mastodon === 'empty', JSON.stringify(o));

// 1日の上限（変数で変えられる）と期限
env.SOCIAL_MAX_BSKY = '3';
await enqueue(env, { items: [item(5, 60, 2000), item(6, 61, 2000)] }, at(62));
const bsCount = () => db.prepare("SELECT COUNT(*) AS n FROM social_posts WHERE dest='bsky' AND status='ok'").get().n;
o = await socialTick(env, at(84), fetcher);   // 3件目
o = await socialTick(env, at(105), fetcher);
ok('1日の上限に達したら投稿しない（SOCIAL_MAX_BSKY=3）', bsCount() === 3 && o.bsky === 'limit', `${bsCount()} ${JSON.stringify(o)}`);
o = await socialTick(env, new Date('2026-11-25T15:30:00Z'), fetcher);   // 日本時間 翌 0:30 → 日が変わる
ok('日本時間で日が変わると上限が戻る', o.bsky === 'ok', JSON.stringify(o));
await enqueue(env, { items: [item(7, 0, 30)] }, at(0));
db.prepare("DELETE FROM social_posts WHERE dest='mastodon'").run();
db.prepare("DELETE FROM social_queue WHERE dest='mastodon' AND id != 'n-test-7'").run();
o = await socialTick(env, at(40), fetcher);
ok('期限を過ぎた火事は投稿しない', o.mastodon === 'empty', JSON.stringify(o));

// 状況の API
r = await handle(req('GET', '/api/social/status?days=3'), env, at(120));
j = await r.json();
ok('状況：配信先ごとの数だけ返す（本文は返さない）', r.status === 200 && j.active.length === 3 && j.byDay.some(x => x.dest === 'bsky' && x.status === 'ok') && !JSON.stringify(j).includes('【火事】'), JSON.stringify(j));
ok('facet：タグがなければ空', bskyFacets('タグなし').length === 0);

const bad = results.filter(x => !x.ok);
for (const x of results) console.log((x.ok ? 'OK  ' : 'NG  ') + x.name + (x.ok ? '' : '  → ' + x.detail));
console.log(`\n${results.length - bad.length}/${results.length} 合格`);
if (bad.length) process.exit(1);
