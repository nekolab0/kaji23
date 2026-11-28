// X 以外の SNS への自動投稿（docs/growth.md の C2・C4、backlog G2・G3。2026-11-25〜）
//
// 仕組み
//  - サイトの生成（daily.yml）が、公開のあとに ops/social/queue.json を POST /api/social/enqueue へ送る（SOCIAL_KEY で守る）
//  - 毎分の cron（socialTick）が、配信先ごとに「1日の上限」と「20分の間隔」を守って、キューから1件ずつ投稿する
//  - 投稿した結果は social_posts に残し、同じ火事を同じ先に二度投稿しない。期限（expires）を過ぎた火事は投稿しない（翌日に回さない）
//  - 配信先の Secret が入っていない先は飛ばす（エラーにしない）。Secret を入れること＝投稿を始めてよいという承認（docs/decisions.md 2026-11-25）
//  - SOCIAL_PAUSE（変数）に何か入れると、すべての投稿を止める（誤った情報・削除依頼が来たとき）
//  - 今動く配信先は Bluesky・Misskey・Mastodon（段階 1a）と Threads（1b・G5）。Instagram・Facebook はキューに入るが、送り方（G9）ができるまで投稿しない

export const DESTS = ['bsky', 'misskey', 'mastodon', 'threads', 'instagram', 'facebook'];
export const DAILY_MAX = { bsky: 8, misskey: 8, mastodon: 8, threads: 5, instagram: 2, facebook: 3 };   // 初期値。SOCIAL_MAX_<DEST>（変数）で変えられる
export const TEXT_MAX = { bsky: 300, misskey: 3000, mastodon: 500, threads: 500, instagram: 2200, facebook: 5000 };
export const GAP_MIN = 20;            // 同じ配信先で、投稿と投稿の間をこの分数以上あける
export const MAX_TRIES = 2;           // 送信に失敗した投稿は、この回数までやり直す
const NG = /けが|負傷|死亡|亡くな|死者|重体|心肺停止|大炎上|ヤバ|やば/;   // 書かない言葉（site/check_social.py と同じ）
const SITE_OK = /^https:\/\/kajisoku\.jp\//;   // リンク・画像は火事速のページだけ（SOCIAL_KEY が漏れても、よそへのリンクは投稿させない）

export function configured(env, d) {
  if (d === 'bsky') return !!(env.BSKY_HANDLE && env.BSKY_APP_PASSWORD);
  if (d === 'misskey') return !!(env.MISSKEY_HOST && env.MISSKEY_TOKEN);
  if (d === 'mastodon') return !!(env.MASTODON_HOST && env.MASTODON_TOKEN);
  if (d === 'threads') return !!(env.THREADS_USER_ID && env.THREADS_TOKEN);
  return false;   // instagram・facebook は送り方（G9）ができるまで投稿しない
}
export function dailyMax(env, d) {
  const raw = env['SOCIAL_MAX_' + d.toUpperCase()];
  return raw !== undefined && raw !== null && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : DAILY_MAX[d];
}
const jstDayStart = now => { const j = new Date(+now + 9 * 3600e3); j.setUTCHours(0, 0, 0, 0); return new Date(+j - 9 * 3600e3).toISOString(); };

const readyDBs = new WeakSet();   // 表は1つの実行環境で1回だけ作る（毎分の cron で何度も CREATE しない）
export async function setupSocial(DB) {
  if (readyDBs.has(DB)) return;
  await DB.prepare(`CREATE TABLE IF NOT EXISTS social_queue (id TEXT NOT NULL, dest TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, url TEXT, image TEXT,
    title TEXT, descr TEXT, first TEXT NOT NULL, expires TEXT NOT NULL, added TEXT NOT NULL, PRIMARY KEY (id, dest))`).run();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS social_posts (id TEXT NOT NULL, dest TEXT NOT NULL, status TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
    post_id TEXT, post_url TEXT, error TEXT, at TEXT NOT NULL, PRIMARY KEY (id, dest))`).run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_social_posts_dest ON social_posts(dest, at)').run();
  // Threads のトークン（60日で切れる）を自動で更新して持つ（G5 で使う）
  await DB.prepare('CREATE TABLE IF NOT EXISTS social_tokens (dest TEXT PRIMARY KEY, token TEXT NOT NULL, expires TEXT, refreshed TEXT, seed TEXT)').run();
  try { await DB.prepare('ALTER TABLE social_tokens ADD COLUMN seed TEXT').run(); } catch (e) {}   // 2026-11-25 の最初の版には seed の列がない
  readyDBs.add(DB);
}

// キューの中身を確かめて入れる。入れた件数と、断った理由を返す
export async function enqueue(env, body, now = new Date()) {
  await setupSocial(env.DB);
  const items = Array.isArray(body && body.items) ? body.items.slice(0, 50) : null;
  if (!items) return { error: 'items がありません', status: 400 };
  const iso = now.toISOString();
  let added = 0; const skipped = [];
  for (const it of items) {
    const id = String(it && it.id || '').slice(0, 200), kind = String(it && it.kind || 'fire_post').slice(0, 20);
    const first = String(it && it.first || ''), expires = String(it && it.expires || '');
    if (!id || !it.posts || isNaN(Date.parse(first)) || isNaN(Date.parse(expires))) { skipped.push(`${id || '?'}: 形が正しくない`); continue; }
    if (Date.parse(expires) <= +now) { skipped.push(`${id}: 期限切れ`); continue; }
    for (const d of DESTS) {
      const p = it.posts[d]; if (!p || typeof p.text !== 'string' || !p.text.trim()) continue;
      const text = p.text, url = p.url ? String(p.url) : null, image = p.image ? String(p.image) : null;
      if (text.length > TEXT_MAX[d]) { skipped.push(`${id}/${d}: 長すぎる`); continue; }
      if (NG.test(text)) { skipped.push(`${id}/${d}: 書かない言葉`); continue; }
      const links = [url, image, ...(text.match(/https?:\/\/\S+/g) || [])].filter(Boolean);
      if (links.some(u => !SITE_OK.test(u))) { skipped.push(`${id}/${d}: 火事速以外のリンク`); continue; }
      const r = await env.DB.prepare(`INSERT INTO social_queue (id, dest, kind, text, url, image, title, descr, first, expires, added) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id, dest) DO NOTHING`).bind(id, d, kind, text, url, image, p.title ? String(p.title).slice(0, 200) : null, p.desc ? String(p.desc).slice(0, 300) : null, first, expires, iso).run();
      added += (r.meta && r.meta.changes) || 0;
    }
  }
  // 期限を2日過ぎたキューは消す（投稿の記録 social_posts は残す）
  await env.DB.prepare('DELETE FROM social_queue WHERE expires < ?').bind(new Date(+now - 2 * 864e5).toISOString()).run();
  return { added, skipped };
}

// 毎分：配信先ごとに、投稿してよければ1件だけ投稿する
export async function socialTick(env, now = new Date(), fetcher = fetch) {
  if (env.SOCIAL_PAUSE) return { paused: true };
  await setupSocial(env.DB);
  const DB = env.DB, iso = now.toISOString(), out = {};
  if (configured(env, 'threads')) { try { out.threadsToken = await refreshThreadsToken(env, now, fetcher); } catch (e) { out.threadsToken = 'error'; } }
  for (const d of DESTS) {
    if (!configured(env, d)) continue;
    const max = dailyMax(env, d);
    const { n } = await DB.prepare("SELECT COUNT(*) AS n FROM social_posts WHERE dest = ? AND status = 'ok' AND at >= ?").bind(d, jstDayStart(now)).first();
    if (n >= max) { out[d] = 'limit'; continue; }
    const last = await DB.prepare('SELECT MAX(at) AS at FROM social_posts WHERE dest = ?').bind(d).first();
    if (last && last.at && +now - Date.parse(last.at) < GAP_MIN * 60e3) { out[d] = 'gap'; continue; }
    // まだ出していない・期限内・発生の新しいものから
    const row = await DB.prepare(`SELECT q.* FROM social_queue q LEFT JOIN social_posts p ON p.id = q.id AND p.dest = q.dest
      WHERE q.dest = ? AND q.expires > ? AND (p.id IS NULL OR (p.status = 'error' AND p.tries < ?)) ORDER BY q.first DESC LIMIT 1`).bind(d, iso, MAX_TRIES).first();
    if (!row) { out[d] = 'empty'; continue; }
    let res;
    try { res = await SEND[d](env, row, fetcher, now); }
    catch (e) { res = { error: String(e && e.message || e).slice(0, 300) }; }
    if (res && res.id) {
      await DB.prepare(`INSERT INTO social_posts (id, dest, status, tries, post_id, post_url, error, at) VALUES (?, ?, 'ok', 1, ?, ?, NULL, ?)
        ON CONFLICT(id, dest) DO UPDATE SET status = 'ok', tries = tries + 1, post_id = excluded.post_id, post_url = excluded.post_url, error = NULL, at = excluded.at`).bind(row.id, d, String(res.id), res.url || null, iso).run();
      out[d] = 'ok';
    } else {
      const err = (res && res.error) || '不明';
      await DB.prepare(`INSERT INTO social_posts (id, dest, status, tries, error, at) VALUES (?, ?, 'error', 1, ?, ?)
        ON CONFLICT(id, dest) DO UPDATE SET status = 'error', tries = tries + 1, error = excluded.error, at = excluded.at`).bind(row.id, d, err, iso).run();
      console.error(JSON.stringify({ at: 'social', dest: d, id: row.id, error: err }));
      out[d] = 'error';
    }
  }
  return out;
}

// 直近の投稿の数（配信先・日・結果ごと）。本文は返さない
export async function socialStatus(env, days = 7, now = new Date()) {
  await setupSocial(env.DB);
  const since = new Date(+now - Math.min(Math.max(days, 1), 60) * 864e5).toISOString();
  const { results: byDay } = await env.DB.prepare("SELECT substr(datetime(at, '+9 hours'), 1, 10) AS day, dest, status, COUNT(*) AS n FROM social_posts WHERE at >= ? GROUP BY day, dest, status ORDER BY day").bind(since).all();
  const { results: queued } = await env.DB.prepare('SELECT dest, COUNT(*) AS n FROM social_queue q WHERE expires > ? AND NOT EXISTS (SELECT 1 FROM social_posts p WHERE p.id = q.id AND p.dest = q.dest) GROUP BY dest').bind(now.toISOString()).all();
  return { paused: !!env.SOCIAL_PAUSE, active: DESTS.filter(d => configured(env, d)), byDay, queued };
}

// ---------- 配信先ごとの送り方 ----------
const enc = new TextEncoder();
// 本文の #タグ を、Bluesky のハッシュタグ（facet）にする。位置は UTF-8 のバイト数で数える
export function bskyFacets(text) {
  const facets = [];
  for (const m of text.matchAll(/(^|\s)#([^\s#]+)/g)) {
    const start = enc.encode(text.slice(0, m.index + m[1].length)).length;
    const end = start + enc.encode('#' + m[2]).length;
    facets.push({ index: { byteStart: start, byteEnd: end }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2] }] });
  }
  return facets;
}
async function sendBsky(env, row, fetcher, now) {
  const svc = (env.BSKY_SERVICE || 'https://bsky.social').replace(/\/$/, '');
  const r1 = await fetcher(`${svc}/xrpc/com.atproto.server.createSession`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: env.BSKY_HANDLE, password: env.BSKY_APP_PASSWORD }) });
  if (!r1.ok) return { error: `createSession ${r1.status}` };
  const s = await r1.json();
  const auth = { Authorization: 'Bearer ' + s.accessJwt };
  const record = { $type: 'app.bsky.feed.post', text: row.text, createdAt: now.toISOString(), langs: ['ja'] };
  const facets = bskyFacets(row.text); if (facets.length) record.facets = facets;
  if (row.url) {
    const external = { uri: row.url, title: row.title || '火事速', description: row.descr || '' };
    if (row.image) {   // リンクカードの画像（OG 画像）。読めなくてもカードだけで投稿する
      try {
        const img = await fetcher(row.image);
        const type = img.headers.get('Content-Type') || 'image/png';
        if (img.ok && /^image\//.test(type)) {
          const bytes = await img.arrayBuffer();
          if (bytes.byteLength < 950000) {
            const up = await fetcher(`${svc}/xrpc/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...auth, 'Content-Type': type }, body: bytes });
            if (up.ok) external.thumb = (await up.json()).blob;
          }
        }
      } catch (e) {}
    }
    record.embed = { $type: 'app.bsky.embed.external', external };
  }
  const r2 = await fetcher(`${svc}/xrpc/com.atproto.repo.createRecord`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record }) });
  if (!r2.ok) return { error: `createRecord ${r2.status} ${(await r2.text()).slice(0, 200)}` };
  const p = await r2.json();
  const rkey = String(p.uri || '').split('/').pop();
  return { id: p.uri, url: rkey ? `https://bsky.app/profile/${env.BSKY_HANDLE}/post/${rkey}` : null };
}
async function sendMisskey(env, row, fetcher) {
  const host = String(env.MISSKEY_HOST).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const r = await fetcher(`https://${host}/api/notes/create`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.MISSKEY_TOKEN },
    body: JSON.stringify({ i: env.MISSKEY_TOKEN, text: row.text, visibility: env.MISSKEY_VISIBILITY || 'home' }) });   // 古い版の Misskey は本文の i でしか受け付けないので両方で送る   // 公開範囲は規約に合わせる（初期は「ホーム」）
  if (!r.ok) return { error: `notes/create ${r.status} ${(await r.text()).slice(0, 200)}` };
  const n = (await r.json()).createdNote || {};
  return n.id ? { id: n.id, url: `https://${host}/notes/${n.id}` } : { error: 'createdNote がない' };
}
async function sendMastodon(env, row, fetcher) {
  const host = String(env.MASTODON_HOST).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const body = new URLSearchParams({ status: row.text, visibility: env.MASTODON_VISIBILITY || 'unlisted', language: 'ja' });
  const r = await fetcher(`https://${host}/api/v1/statuses`, { method: 'POST', headers: { Authorization: 'Bearer ' + env.MASTODON_TOKEN,
    'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `${row.id}|mastodon` }, body });
  if (!r.ok) return { error: `statuses ${r.status} ${(await r.text()).slice(0, 200)}` };
  const s = await r.json();
  return s.id ? { id: s.id, url: s.url || null } : { error: 'id がない' };
}
// Threads：長期トークンは60日で切れる。最初の1回だけ Secret の THREADS_TOKEN を使い、以後は週1回 refresh_access_token で新しくして D1 に持つ（docs/growth.md）。
// 運営者・Muse が Secret を入れ直したら（値が変わったら）、そちらを使い直す
const THREADS_API = 'https://graph.threads.net';
const REFRESH_DAYS = 7;
async function shortHash(t) { const b = await crypto.subtle.digest('SHA-256', enc.encode(String(t))); return [...new Uint8Array(b)].slice(0, 8).map(x => x.toString(16).padStart(2, '0')).join(''); }
export async function threadsToken(env) {
  const seed = await shortHash(env.THREADS_TOKEN);
  const row = await env.DB.prepare("SELECT token, expires, refreshed, seed FROM social_tokens WHERE dest = 'threads'").first();
  if (row && row.seed === seed) return { token: row.token, refreshed: row.refreshed, seed };
  return { token: env.THREADS_TOKEN, refreshed: null, seed };
}
export async function refreshThreadsToken(env, now = new Date(), fetcher = fetch) {
  const t = await threadsToken(env);
  if (t.refreshed && +now - Date.parse(t.refreshed) < REFRESH_DAYS * 864e5) return 'fresh';
  // まだ1回も更新していない Secret の値は、登録した直後（24時間以内）だと更新できないことがある。失敗しても次の回でやり直す
  const last = await env.DB.prepare("SELECT refreshed FROM social_tokens WHERE dest = 'threads:try'").first();
  if (last && +now - Date.parse(last.refreshed) < 6 * 3600e3) return 'wait';
  await env.DB.prepare("INSERT INTO social_tokens (dest, token, refreshed) VALUES ('threads:try', '-', ?) ON CONFLICT(dest) DO UPDATE SET refreshed = excluded.refreshed").bind(now.toISOString()).run();
  const r = await fetcher(`${THREADS_API}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(t.token)}`);
  if (!r.ok) { console.error(JSON.stringify({ at: 'threads_refresh', status: r.status })); return 'error'; }
  const j = await r.json();
  if (!j.access_token) return 'error';
  const expires = j.expires_in ? new Date(+now + j.expires_in * 1000).toISOString() : null;
  await env.DB.prepare(`INSERT INTO social_tokens (dest, token, expires, refreshed, seed) VALUES ('threads', ?, ?, ?, ?)
    ON CONFLICT(dest) DO UPDATE SET token = excluded.token, expires = excluded.expires, refreshed = excluded.refreshed, seed = excluded.seed`).bind(j.access_token, expires, now.toISOString(), t.seed).run();
  return 'refreshed';
}
async function sendThreads(env, row, fetcher) {
  const { token } = await threadsToken(env);
  const uid = encodeURIComponent(env.THREADS_USER_ID);
  const q = new URLSearchParams({ media_type: 'TEXT', text: row.text, access_token: token });
  if (row.url) q.set('link_attachment', row.url);   // リンクのプレビューを付ける（本文に URL は入れない）
  const r1 = await fetcher(`${THREADS_API}/v1.0/${uid}/threads`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: q });
  if (!r1.ok) return { error: `threads ${r1.status} ${(await r1.text()).slice(0, 200)}` };
  const c = await r1.json();
  if (!c.id) return { error: 'コンテナの id がない' };
  const r2 = await fetcher(`${THREADS_API}/v1.0/${uid}/threads_publish`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: c.id, access_token: token }) });
  if (!r2.ok) return { error: `threads_publish ${r2.status} ${(await r2.text()).slice(0, 200)}` };
  const p = await r2.json();
  return p.id ? { id: p.id } : { error: '投稿の id がない' };
}
const SEND = { bsky: sendBsky, misskey: sendMisskey, mastodon: sendMastodon, threads: sendThreads };
