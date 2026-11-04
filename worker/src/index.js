// 火事速 — 目撃報告・口コミの受付サーバー（Cloudflare Workers + D1）。全国の市区町村に対応
//
// 報告（サイレン／煙・におい／火）を、同じ町・2時間以内なら同じ「火事」にまとめる。
// 火事ごと・町ごとに口コミを投稿でき、3人が「不適切」と通報すると非表示になる。
// /f/<火事ID> は共有用のページ。X や LINE に貼ると「どこで・何件」が見出しとして出る。
//
// POST /api/report   {pref, city, town?, kind}      → {ok, incident}   （東京23区は {ward} だけでも可）
// POST /api/comment  {inc? | pref+city+town?, body} → {ok, id, inc}   （火事を指定しなければ、同じ場所の進行中の火事に付く）
// POST /api/flag     {id}                           → {ok}
// GET  /api/live?hours=6                            → いま報告が上がっている火事
// GET  /api/incident?id=                            → 火事1件（件数・口コミ）
// GET  /api/town?pref=&city=&town=                 → 町の火事（30日）と口コミ掲示板
// GET  /api/counts                                  → 場所ごとの火事の件数（365日）
// GET  /api/official?days=7                         → 消防本部の発表（サイト生成用）
// （/api/incident・/api/town の sns）                  → X の投稿のID（口コミ・未確認。X_BEARER 設定時）
// GET  /api/reports?hours=24                        → 区・町ごとの件数（旧形式）
// POST /api/contact  {body}                         → 削除依頼・問い合わせ
// GET  /f/<id>                                      → 共有用ページ
//
// 個人の特定を避けるため: 町名は丁目まで、番地・電話番号・URLは受け付けない。
// IPアドレスは保存しない（日替わりの塩付きハッシュを連投防止にだけ使う）。
import { AREAS } from './areas.js';
import { SOURCES, parseSource, robotsAllows, htmlText } from './official.js';
import { parseMail } from './mail.js';
import { pollX, snsFor } from './xposts.js';

export const WARDS = ['足立区', '荒川区', '板橋区', '江戸川区', '大田区', '葛飾区', '北区', '江東区', '品川区', '渋谷区', '新宿区', '杉並区', '墨田区',
  '世田谷区', '台東区', '中央区', '千代田区', '豊島区', '中野区', '練馬区', '文京区', '港区', '目黒区'];
export const KINDS = ['siren', 'smoke', 'fire'];
const KIND_JA = { siren: 'サイレン', smoke: '煙・におい', fire: '火' };
// 場所は「都道府県＋市区町村（政令市は区）」。東京23区だけは区名だけでも受け付ける（旧形式）
export function areaOf(b) {
  let pref = String((b && b.pref) || ''), city = String((b && (b.city || b.ward)) || '');
  if (!pref && WARDS.includes(city)) pref = '東京都';
  return AREAS[pref] && AREAS[pref].includes(city) ? { pref, city } : null;
}
export const placeName = (pref, city, town) => (pref === '東京都' && WARDS.includes(city) ? '' : pref || '') + city + (town || '');
const REPORT_COOLDOWN_MIN = 10;   // 同じ人・同じ区の報告は10分に1回
const COMMENT_COOLDOWN_SEC = 60;  // 口コミは1分に1回
const MERGE_HOURS = 2;            // 最後の報告から2時間以内なら同じ火事
const HIDE_AT_FLAGS = 3;          // 3人が通報したら非表示
const KEEP_REPORT_DAYS = 30;      // 報告の明細は30日で削除（火事の件数と口コミは残す）
const DEFAULT_SITE = 'https://kajisoku.jp';

// ---------- 町名 ----------
const Z2H = s => String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
const KNUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const KD = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export const toKanjiNum = n => n <= 0 || n > 99 ? String(n) : (n >= 20 ? KD[Math.floor(n / 10)] : '') + (n >= 10 ? '十' : '') + KD[n % 10];
export function cleanTown(t) {
  // 「赤羽西二丁目3番地」→「赤羽西2丁目」。番地・号は捨てる
  let s = Z2H(String(t || '').trim()).replace(/\s/g, '');
  s = s.replace(/([一二三四五六七八九十]+)丁目/, (_, k) => (k.length === 1 ? KNUM[k] : k === '十' ? 10 : k.length === 2 && k[0] === '十' ? 10 + KNUM[k[1]] : k) + '丁目');
  s = s.replace(/(\d+丁目).*$/, '$1');
  // 「北32条西」→「北三十二条西」（町名データは条・線の数字が漢数字）
  s = s.replace(/(\d{1,2})(?=条|線|軒)/g, (_, d) => toKanjiNum(+d));
  s = s.replace(/\d+(番地?|号|-|－|ー).*$/, '');
  return s.slice(0, 20);
}
export const baseTown = t => cleanTown(t).replace(/\d+丁目$/, '').replace(/\d+$/, '');
const TOWN_OK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々ヶケ0-9・]+$/u;

// ---------- 口コミの中身の確認 ----------
const NG = /死ね|殺す|ころす|ガイジ|キチガイ|きちがい|在日|チョン|ゴキブリ|クズ|ブス|自殺|焼身|心中|放火犯は|犯人は/;
export function checkBody(body) {
  const b = String(body || '').trim().replace(/\s+/g, ' ');
  if (b.length < 2) return [null, '口コミを入力してください'];
  if (b.length > 200) return [null, '口コミは200文字までです'];
  if (/https?:|www\.|\.(com|jp|net|io)\b/i.test(b)) return [null, 'URLは書き込めません'];
  if (/\d{2,4}[-ー－]\d{2,4}[-ー－]\d{3,4}|\d{10,}/.test(Z2H(b))) return [null, '電話番号は書き込めません'];
  if (/\d+番地|\d+番\d+|\d+[-－]\d+[-－]\d+/.test(Z2H(b))) return [null, '番地までの住所は書き込めません（丁目まででお願いします）'];
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(b)) return [null, 'メールアドレスは書き込めません'];
  if (NG.test(b)) return [null, '誹謗中傷・原因や人についての憶測は書き込めません'];
  return [b, null];
}

// ---------- 共通 ----------
function cors(env, res) {
  res.headers.set('Access-Control-Allow-Origin', env.ALLOW_ORIGIN || '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}
const json = (env, body, status = 200, extra = {}) =>
  cors(env, new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra } }));
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
const newId = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; return [...crypto.getRandomValues(new Uint8Array(7))].map(b => a[b % a.length]).join(''); };
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 初回アクセス時に表を作り、ハッシュ用の塩をランダムに作って保存する（手作業の設定を不要にする）
let ready = null;
async function setup(env) {
  const run = sql => env.DB.prepare(sql).run();
  await run(`CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, ward TEXT NOT NULL, town TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('siren','smoke','fire')), at TEXT NOT NULL, who TEXT NOT NULL)`);
  // 旧版の表に列を足す（すでにあれば何もしない）
  for (const col of ['inc TEXT', 'base TEXT', 'pref TEXT']) { try { await run(`ALTER TABLE reports ADD COLUMN ${col}`); } catch (e) {} }
  await run('CREATE INDEX IF NOT EXISTS idx_reports_at ON reports(at)');
  await run('CREATE INDEX IF NOT EXISTS idx_reports_who ON reports(who, ward, at)');
  await run(`CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, ward TEXT NOT NULL, town TEXT, base TEXT, first_at TEXT NOT NULL, last_at TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0, siren INTEGER NOT NULL DEFAULT 0, smoke INTEGER NOT NULL DEFAULT 0, fire INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0)`);
  try { await run('ALTER TABLE incidents ADD COLUMN pref TEXT'); } catch (e) {}
  await run('CREATE INDEX IF NOT EXISTS idx_inc_last ON incidents(last_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_inc_area ON incidents(pref, ward, base, last_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_inc_place ON incidents(ward, base, last_at)');
  await run(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, inc TEXT, ward TEXT NOT NULL, town TEXT, base TEXT, body TEXT NOT NULL,
    at TEXT NOT NULL, who TEXT NOT NULL, flags INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0)`);
  try { await run('ALTER TABLE comments ADD COLUMN pref TEXT'); } catch (e) {}
  await run('CREATE INDEX IF NOT EXISTS idx_com_inc ON comments(inc, at)');
  await run('CREATE INDEX IF NOT EXISTS idx_com_area ON comments(pref, ward, base, at)');
  // 23区だけだった頃のデータは東京都とみなす
  for (const t of ['reports', 'incidents', 'comments']) await run(`UPDATE ${t} SET pref = '東京都' WHERE pref IS NULL`);
  await run('CREATE INDEX IF NOT EXISTS idx_com_place ON comments(ward, base, at)');
  await run('CREATE INDEX IF NOT EXISTS idx_com_who ON comments(who, at)');
  await run('CREATE TABLE IF NOT EXISTS flags (comment INTEGER NOT NULL, who TEXT NOT NULL, PRIMARY KEY (comment, who))');
  await run('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  // 消防本部の発表（出動情報）と、各ページの読み取り状況
  await run(`CREATE TABLE IF NOT EXISTS official (id TEXT PRIMARY KEY, source TEXT NOT NULL, pref TEXT NOT NULL, ward TEXT NOT NULL, town TEXT, base TEXT,
    kind TEXT NOT NULL, status TEXT, at TEXT NOT NULL, seen_first TEXT NOT NULL, seen_last TEXT NOT NULL, inc TEXT)`);
  await run('CREATE INDEX IF NOT EXISTS idx_off_inc ON official(inc)');
  await run('CREATE INDEX IF NOT EXISTS idx_off_at ON official(at)');
  await run(`CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, last_try TEXT, last_ok TEXT, status TEXT, items INTEGER, robots TEXT, robots_at TEXT)`);
  try { await run('ALTER TABLE sources ADD COLUMN sample TEXT'); } catch (e) {}   // 読み取りの確認用: 火災・出動を含む行の見本
  for (const col of ['official INTEGER NOT NULL DEFAULT 0', 'official_kind TEXT', 'official_src TEXT']) { try { await run(`ALTER TABLE incidents ADD COLUMN ${col}`); } catch (e) {} }
  await run('CREATE TABLE IF NOT EXISTS contact (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, at TEXT NOT NULL, who TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)');
  if (env.SALT) return env.SALT;
  const rnd = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)').bind('salt', rnd).run();
  return (await env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind('salt').first()).v;
}

// 同じ場所（町名がなければ市区町村内の直近）で、指定時刻より後に報告がある火事
async function openIncident(DB, pref, ward, base, since) {
  return base
    ? DB.prepare('SELECT * FROM incidents WHERE pref = ? AND ward = ? AND (base = ? OR base IS NULL) AND last_at > ? ORDER BY (base = ?) DESC, last_at DESC LIMIT 1').bind(pref, ward, base, since, base).first()
    : DB.prepare('SELECT * FROM incidents WHERE pref = ? AND ward = ? AND last_at > ? ORDER BY last_at DESC LIMIT 1').bind(pref, ward, since).first();
}
const incOut = r => r && ({ id: r.id, pref: r.pref, city: r.ward, ward: r.ward, town: r.town, place: placeName(r.pref, r.ward, r.town), first: r.first_at, last: r.last_at,
  counts: { total: r.n, siren: r.siren, smoke: r.smoke, fire: r.fire }, comments: r.comments,
  official: r.official ? { kind: r.official_kind, source: r.official_src, name: (SOURCES.find(s => s.id === r.official_src) || {}).name || null } : null });
const comOut = r => ({ id: r.id, inc: r.inc, pref: r.pref, city: r.ward, ward: r.ward, town: r.town, body: r.body, at: r.at });

export async function handle(request, env, now = new Date()) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return cors(env, new Response(null, { status: 204 }));
  if (!ready || ready.env !== env) { const p = setup(env); ready = { env, p }; p.catch(() => { ready = null; }); }
  const salt = await ready.p;
  const DB = env.DB;
  const iso = now.toISOString();
  const ago = ms => new Date(now - ms).toISOString();
  const whoOf = async () => {
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    return sha256(`${ip}|${salt}|${iso.slice(0, 10)}`);
  };
  const body = async () => { try { return await request.json(); } catch { return null; } };
  const P = url.pathname;

  // ---- 目撃報告 ----
  if (P === '/api/report' && request.method === 'POST') {
    const b = await body(); if (!b) return json(env, { error: '送信内容を読み取れませんでした' }, 400);
    const area = areaOf(b), kind = String(b.kind || '');
    if (!area) return json(env, { error: '都道府県・市区町村を選んでください' }, 400);
    const { pref, city: ward } = area;
    if (!KINDS.includes(kind)) return json(env, { error: '報告の種類が正しくありません' }, 400);
    const town = cleanTown(b.town);
    if (town && !TOWN_OK.test(town)) return json(env, { error: '町名に使えない文字が含まれています' }, 400);
    const base = town ? baseTown(town) : null;
    const who = await whoOf();
    const dup = await DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE who = ? AND pref = ? AND ward = ? AND at > ?').bind(who, pref, ward, ago(REPORT_COOLDOWN_MIN * 60e3)).first();
    if (dup && dup.n > 0) return json(env, { error: `同じ市区町村への報告は${REPORT_COOLDOWN_MIN}分に1回までです`, cooldown: true }, 429);
    // 同じ町（町名なしなら区内で直近）の、2時間以内に報告がある火事にまとめる
    const since = ago(MERGE_HOURS * 3600e3);
    let inc = await openIncident(DB, pref, ward, base, since);
    if (inc) {
      await DB.prepare(`UPDATE incidents SET last_at = ?, n = n + 1, ${kind} = ${kind} + 1, town = COALESCE(town, ?), base = COALESCE(base, ?) WHERE id = ?`)
        .bind(iso, town || null, base, inc.id).run();
    } else {
      inc = { id: newId() };
      await DB.prepare(`INSERT INTO incidents (id, pref, ward, town, base, first_at, last_at, n, ${kind}) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`)
        .bind(inc.id, pref, ward, town || null, base, iso, iso).run();
    }
    await DB.prepare('INSERT INTO reports (pref, ward, town, base, kind, at, who, inc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(pref, ward, town || null, base, kind, iso, who, inc.id).run();
    return json(env, { ok: true, incident: inc.id });
  }

  // ---- 口コミ ----
  if (P === '/api/comment' && request.method === 'POST') {
    const b = await body(); if (!b) return json(env, { error: '送信内容を読み取れませんでした' }, 400);
    const [text, err] = checkBody(b.body);
    if (err) return json(env, { error: err }, 400);
    let pref, ward, town, base, incId = null;
    if (b.inc) {
      const inc = await DB.prepare('SELECT * FROM incidents WHERE id = ?').bind(String(b.inc)).first();
      if (!inc && !/^n-/.test(String(b.inc))) return json(env, { error: 'この火事は見つかりませんでした' }, 404);
      incId = String(b.inc).slice(0, 80);
      if (inc) { pref = inc.pref || '東京都'; ward = inc.ward; town = inc.town; }
      else { const area = areaOf(b); if (!area) return json(env, { error: '都道府県・市区町村を選んでください' }, 400); pref = area.pref; ward = area.city; town = cleanTown(b.town); }
    } else {
      const area = areaOf(b); if (!area) return json(env, { error: '都道府県・市区町村を選んでください' }, 400);
      pref = area.pref; ward = area.city; town = cleanTown(b.town);
    }
    if (town && !TOWN_OK.test(town)) return json(env, { error: '町名に使えない文字が含まれています' }, 400);
    base = town ? baseTown(town) : null;
    // 火事を指定していない口コミは、同じ場所で2時間以内に報告がある火事に付ける
    if (!incId) { const open = await openIncident(DB, pref, ward, base, ago(MERGE_HOURS * 3600e3)); if (open) incId = open.id; }
    const who = await whoOf();
    const dup = await DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE who = ? AND at > ?').bind(who, ago(COMMENT_COOLDOWN_SEC * 1e3)).first();
    if (dup && dup.n > 0) return json(env, { error: '口コミは1分に1回までです', cooldown: true }, 429);
    const r = await DB.prepare('INSERT INTO comments (inc, pref, ward, town, base, body, at, who) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(incId, pref, ward, town || null, base, text, iso, who).run();
    if (incId) await DB.prepare('UPDATE incidents SET comments = comments + 1 WHERE id = ?').bind(incId).run();
    return json(env, { ok: true, id: r.meta && r.meta.last_row_id != null ? r.meta.last_row_id : r.lastInsertRowid, inc: incId });
  }

  // ---- 不適切な口コミの通報 ----
  if (P === '/api/flag' && request.method === 'POST') {
    const b = await body(); const id = b && parseInt(b.id, 10);
    if (!id) return json(env, { error: '対象が正しくありません' }, 400);
    const who = await whoOf();
    const r = await DB.prepare('INSERT OR IGNORE INTO flags (comment, who) VALUES (?, ?)').bind(id, who).run();
    const changed = r.meta ? r.meta.changes : r.changes;
    if (changed) await DB.prepare('UPDATE comments SET flags = flags + 1, hidden = CASE WHEN flags + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?').bind(HIDE_AT_FLAGS, id).run();
    return json(env, { ok: true });
  }

  // ---- 削除依頼・問い合わせ（運営者だけが D1 のコンソールで読む） ----
  if (P === '/api/contact' && request.method === 'POST') {
    const b = await body(); const text = String((b && b.body) || '').trim().slice(0, 1000);
    if (text.length < 5) return json(env, { error: '内容を書いてください' }, 400);
    const who = await whoOf();
    const dup = await DB.prepare('SELECT COUNT(*) AS n FROM contact WHERE who = ? AND at > ?').bind(who, ago(10 * 60e3)).first();
    if (dup && dup.n >= 3) return json(env, { error: '短時間に送れるのは3件までです', cooldown: true }, 429);
    await DB.prepare('INSERT INTO contact (body, at, who) VALUES (?, ?, ?)').bind(text, iso, who).run();
    return json(env, { ok: true });
  }

  // ---- いまの火事 ----
  if (P === '/api/live' && request.method === 'GET') {
    const hours = Math.min(72, Math.max(1, parseInt(url.searchParams.get('hours') || '6', 10) || 6));
    const { results } = await DB.prepare('SELECT * FROM incidents WHERE last_at > ? ORDER BY last_at DESC LIMIT 40').bind(ago(hours * 3600e3)).all();
    const out = [];
    for (const r of results) {
      const c = await DB.prepare('SELECT * FROM comments WHERE inc = ? AND hidden = 0 ORDER BY at DESC LIMIT 2').bind(r.id).all();
      out.push({ ...incOut(r), latest: c.results.map(comOut) });
    }
    return json(env, { generatedAt: iso, hours, incidents: out }, 200, { 'Cache-Control': 'public, max-age=30' });
  }

  if (P === '/api/incident' && request.method === 'GET') {
    const id = String(url.searchParams.get('id') || '');
    const inc = /^n-/.test(id) ? null : await DB.prepare('SELECT * FROM incidents WHERE id = ?').bind(id).first();
    if (!inc && !/^n-/.test(id)) return json(env, { error: 'この火事は見つかりませんでした' }, 404);
    const c = await DB.prepare('SELECT * FROM comments WHERE inc = ? AND hidden = 0 ORDER BY at ASC LIMIT 300').bind(id).all();
    const t = inc ? await DB.prepare("SELECT kind, strftime('%Y-%m-%dT%H:%M:00Z', at) AS m, COUNT(*) AS n FROM reports WHERE inc = ? GROUP BY kind, m ORDER BY m").bind(id).all() : { results: [] };
    const o = inc ? await DB.prepare('SELECT source, kind, status, at, town FROM official WHERE inc = ? ORDER BY at').bind(id).all() : { results: [] };
    const official = o.results.map(x => { const sc = SOURCES.find(s => s.id === x.source) || {}; return { ...x, name: sc.name || x.source, url: sc.url || null }; });
    const sns = inc ? await snsFor(env, { inc: id }) : [];
    return json(env, { generatedAt: iso, incident: incOut(inc), comments: c.results.map(comOut), timeline: t.results, official, sns }, 200, { 'Cache-Control': 'public, max-age=15' });
  }

  if (P === '/api/town' && request.method === 'GET') {
    const area = areaOf({ pref: url.searchParams.get('pref'), city: url.searchParams.get('city') || url.searchParams.get('ward') });
    const base = baseTown(url.searchParams.get('town') || '');
    if (!area || !base) return json(env, { error: '場所が正しくありません' }, 400);
    const i = await DB.prepare('SELECT * FROM incidents WHERE pref = ? AND ward = ? AND base = ? AND last_at > ? ORDER BY last_at DESC LIMIT 20').bind(area.pref, area.city, base, ago(30 * 864e5)).all();
    const c = await DB.prepare('SELECT * FROM comments WHERE pref = ? AND ward = ? AND base = ? AND hidden = 0 ORDER BY at DESC LIMIT 50').bind(area.pref, area.city, base).all();
    const sinceQ = url.searchParams.get('since'); const since = /^\d{4}-\d{2}-\d{2}/.test(sinceQ || '') ? new Date(sinceQ).toISOString() : ago(7 * 864e5);
    const sns = await snsFor(env, { pref: area.pref, ward: area.city, base, since });
    return json(env, { generatedAt: iso, incidents: i.results.map(incOut), comments: c.results.map(comOut), sns }, 200, { 'Cache-Control': 'public, max-age=30' });
  }

  // 消防本部のページの読み取り状況（運営の確認用）
  if (P === '/api/sources' && request.method === 'GET') {
    const { results } = await DB.prepare('SELECT * FROM sources').all();
    const st = Object.fromEntries(results.map(r => [r.id, r]));
    const dbg = url.searchParams.get('debug') === '1';
    return json(env, { generatedAt: iso, sources: SOURCES.map(s => ({ id: s.id, name: s.name, url: s.url, pref: s.pref, ...(st[s.id] ? { last_try: st[s.id].last_try, last_ok: st[s.id].last_ok, status: st[s.id].status, items: st[s.id].items, ...(dbg ? { sample: st[s.id].sample } : {}) } : {}) })) });
  }

  // 消防本部の発表の記録（サイトの生成時に読み、火事のページ・町のページ・件数に使う）。場所は町名まで
  if (P === '/api/official' && request.method === 'GET') {
    const days = Math.min(60, Math.max(1, parseInt(url.searchParams.get('days') || '7', 10) || 7));
    const { results } = await DB.prepare('SELECT source, pref, ward, town, base, kind, status, at, inc FROM official WHERE at > ? AND COALESCE(status, \'\') <> \'誤報\' ORDER BY at').bind(ago(days * 864e5)).all();
    return json(env, { generatedAt: iso, days, items: results.map(r => ({ ...r, source_name: (SOURCES.find(s => s.id === r.source) || {}).name || (/^mail-/.test(r.source) ? '消防メール（' + r.source.slice(5) + '）' : r.source), source_url: (SOURCES.find(s => s.id === r.source) || {}).url || null })) }, 200, { 'Cache-Control': 'public, max-age=120' });
  }

  // 場所ごとの火事の件数（検索候補の「記録○件」用。直近365日）
  if (P === '/api/counts' && request.method === 'GET') {
    const { results } = await DB.prepare("SELECT pref, ward, COALESCE(base, '') AS base, COUNT(*) AS n FROM incidents WHERE last_at > ? GROUP BY pref, ward, base").bind(ago(365 * 864e5)).all();
    const counts = {}; for (const r of results) counts[`${r.pref || '東京都'}|${r.ward}|${r.base}`] = r.n;
    return json(env, { generatedAt: iso, counts }, 200, { 'Cache-Control': 'public, max-age=300' });
  }

  // 旧形式（区・町ごとの件数）
  if (P === '/api/reports' && request.method === 'GET') {
    const hours = Math.min(72, Math.max(1, parseInt(url.searchParams.get('hours') || '24', 10) || 24));
    const { results } = await DB.prepare('SELECT ward, town, kind, COUNT(*) AS n, MAX(at) AS last FROM reports WHERE at > ? GROUP BY ward, town, kind').bind(ago(hours * 3600e3)).all();
    const wards = {};
    for (const r of results) {
      const w = wards[r.ward] = wards[r.ward] || { siren: 0, smoke: 0, fire: 0, total: 0, last: null, towns: {} };
      w[r.kind] += r.n; w.total += r.n;
      if (!w.last || r.last > w.last) w.last = r.last;
      if (r.town) w.towns[r.town] = (w.towns[r.town] || 0) + r.n;
    }
    return json(env, { generatedAt: iso, hours, wards }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  // ---- 共有用ページ（X・LINE などが読む見出しと説明を、火事ごとに出す） ----
  const m = P.match(/^\/f\/([a-z0-9-]{4,80})$/);
  if (m && request.method === 'GET') {
    const site = (env.SITE_URL || DEFAULT_SITE).replace(/\/$/, '');
    const inc = await DB.prepare('SELECT * FROM incidents WHERE id = ?').bind(m[1]).first();
    const dest = `${site}/fire.html?id=${encodeURIComponent(m[1])}`;
    let title = '火事の目撃情報｜火事速', desc = '「近くで火事？」を町名で確かめられるサイトです。';
    if (inc) {
      const place = placeName(inc.pref, inc.ward, inc.town);
      const parts = KINDS.filter(k => inc[k]).map(k => `${KIND_JA[k]}${inc[k]}`).join('・');
      const t = new Date(new Date(inc.last_at).getTime() + 9 * 3600e3);
      title = inc.official ? `${place}付近で${inc.official_kind || '火災'}（消防出動）${inc.n ? ` 目撃報告${inc.n}件` : ''}｜火事速` : `${place}付近で火事の目撃情報 ${inc.n}件｜火事速`;
      desc = `${parts}の報告、口コミ${inc.comments}件（最新 ${t.getUTCMonth() + 1}/${t.getUTCDate()} ${t.getUTCHours()}:${String(t.getUTCMinutes()).padStart(2, '0')}）。現場の状況を近所の人どうしで共有しています。近づかず、火や煙が見えたら119番へ。`;
    }
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title><meta name="description" content="${escHtml(desc)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="火事速"><meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(desc)}"><meta property="og:url" content="${escHtml(dest)}"><meta property="og:image" content="${site}/og/live.png">
<meta name="twitter:card" content="summary_large_image"><link rel="canonical" href="${escHtml(dest)}">
<meta http-equiv="refresh" content="0;url=${escHtml(dest)}"></head><body><p><a href="${escHtml(dest)}">${escHtml(title)}</a></p>
<script>location.replace(${JSON.stringify(dest)})</script></body></html>`;
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
  }
  return json(env, { error: 'not found' }, 404);
}

// ---------- 消防本部の出動情報を取り込む ----------
const UA = 'kaji23-bot/1.0 (+https://kajisoku.jp/about.html; fire dispatch info by town)';
// 取り出した1件を保存し、同じ場所・近い時刻の「火事」にまとめる（なければ新しく作る）
export async function ingestOfficial(env, items, now = new Date()) {
  const DB = env.DB; let added = 0;
  // 同じページの発表は毎回ほぼ同じなので、既存かどうかは1回の問い合わせでまとめて調べる（D1の問い合わせ回数を抑える）
  const ids = items.map(x => x.key || `${x.source}|${x.ward || x.city}|${x.town || ''}|${x.at}`);
  let known = null;
  if (ids.length) {
    known = new Map();
    for (let i = 0; i < ids.length; i += 80) {
      const part = ids.slice(i, i + 80);
      const { results } = await DB.prepare(`SELECT id, status FROM official WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
      for (const r of results) known.set(r.id, r.status);
    }
  }
  for (const x of items) {
    const base = x.town ? baseTown(x.town) || null : null;
    if (x.status === '誤報') {   // 取り消し: 同じ場所・同じ時刻の発表を「誤報」にし、取り込まない
      await DB.prepare("UPDATE official SET status = '誤報' WHERE pref = ? AND ward = ? AND COALESCE(town, '') = ? AND at = ?").bind(x.pref, x.city, x.town || '', x.at).run();
      continue;
    }
    const id = x.key || `${x.source}|${x.ward || x.city}|${x.town || ''}|${x.at}`;   // 時刻のないページは「場所・種別・日付」で同じ発表とみなす
    if (known && known.has(id)) {   // すでにある発表は、状態（鎮火など）が変わったときだけ書き直す
      const k = known.get(id); if (x.status && x.status !== k) await DB.prepare('UPDATE official SET seen_last = ?, status = ? WHERE id = ?').bind(now.toISOString(), x.status, id).run();
      continue;
    }
    if (!known) {
      const old = await DB.prepare('SELECT id, inc FROM official WHERE id = ?').bind(id).first();
      if (old) { await DB.prepare('UPDATE official SET seen_last = ?, status = COALESCE(?, status) WHERE id = ?').bind(now.toISOString(), x.status || null, id).run(); continue; }
    }
    const city = x.city;
    const t0 = new Date(x.at);
    let inc = await DB.prepare(`SELECT * FROM incidents WHERE pref = ? AND ward = ? AND (base = ? OR base IS NULL OR ? IS NULL) AND first_at > ? AND first_at < ? ORDER BY (base = ?) DESC, last_at DESC LIMIT 1`)
      .bind(x.pref, city, base, base, new Date(t0 - MERGE_HOURS * 3600e3).toISOString(), new Date(+t0 + MERGE_HOURS * 3600e3).toISOString(), base).first();
    if (inc) {
      await DB.prepare('UPDATE incidents SET official = 1, official_kind = ?, official_src = ?, town = COALESCE(town, ?), base = COALESCE(base, ?), last_at = MAX(last_at, ?) WHERE id = ?')
        .bind(x.kind, x.source, x.town || null, base, x.at, inc.id).run();
    } else {
      inc = { id: newId() };
      await DB.prepare('INSERT INTO incidents (id, pref, ward, town, base, first_at, last_at, n, official, official_kind, official_src) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)')
        .bind(inc.id, x.pref, city, x.town || null, base, x.at, x.at, x.kind, x.source).run();
    }
    await DB.prepare('INSERT INTO official (id, source, pref, ward, town, base, kind, status, at, seen_first, seen_last, inc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, x.source, x.pref, city, x.town || null, base, x.kind, x.status || null, x.at, now.toISOString(), now.toISOString(), inc.id).run();
    added++;
  }
  return added;
}

// 1回の実行で読むページ数を絞り、古い順に回す（各ページはおよそ5〜10分に1回）
export async function pollSources(env, now = new Date(), fetcher = fetch, perRun = 8) {
  await setup(env);
  const DB = env.DB;
  const { results } = await DB.prepare('SELECT * FROM sources').all();
  const st = Object.fromEntries(results.map(r => [r.id, r]));
  const due = SOURCES.slice().sort((a, b) => String((st[a.id] || {}).last_try || '').localeCompare(String((st[b.id] || {}).last_try || ''))).slice(0, perRun);
  const report = [];
  for (const src of due) {
    const s = st[src.id] || {};
    let status = 'ok', items = 0, sample = null;
    try {
      // robots.txt は1日1回だけ取り直す
      let robots = s.robots, robotsAt = s.robots_at;
      if (!robotsAt || now - new Date(robotsAt) > 864e5) {
        try { const r = await fetcher(new URL('/robots.txt', src.url).href, { headers: { 'User-Agent': UA } }); robots = r.ok ? (await r.text()).slice(0, 20000) : ''; } catch (e) { robots = ''; }
        robotsAt = now.toISOString();
      }
      if (!robotsAllows(robots, src.url)) status = 'robots.txtで禁止';
      else {
        const r = await fetcher(src.url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
        if (!r.ok) status = 'HTTP ' + r.status;
        else {
          const buf = await r.arrayBuffer();
          let html = new TextDecoder('utf-8').decode(buf);
          const cs = (html.match(/charset=["']?([\w-]+)/i) || [])[1] || (r.headers.get('content-type') || '').split('charset=')[1] || 'utf-8';
          if (!/utf-?8/i.test(cs)) { try { html = new TextDecoder(cs.trim().toLowerCase().replace('shift-jis', 'shift_jis')).decode(buf); } catch (e) {} }
          const found = parseSource(html, src, now);
          sample = htmlText(html).filter(l => /火災|火事|出動|出場|災害|鎮火/.test(l)).slice(0, 12).map(l => l.slice(0, 120)).join('\n').slice(0, 1500);
          items = found.length;
          await ingestOfficial(env, found, now);
        }
      }
      await DB.prepare('INSERT INTO sources (id, last_try, last_ok, status, items, robots, robots_at, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_try = excluded.last_try, last_ok = COALESCE(excluded.last_ok, sources.last_ok), status = excluded.status, items = excluded.items, robots = excluded.robots, robots_at = excluded.robots_at, sample = COALESCE(excluded.sample, sources.sample)')
        .bind(src.id, now.toISOString(), status === 'ok' ? now.toISOString() : null, status, items, robots || '', robotsAt, sample).run();
    } catch (e) {
      status = 'エラー: ' + String(e && e.message || e).slice(0, 80);
      await DB.prepare('INSERT INTO sources (id, last_try, status, items) VALUES (?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET last_try = excluded.last_try, status = excluded.status, items = 0').bind(src.id, now.toISOString(), status).run();
    }
    report.push({ id: src.id, status, items });
  }
  return report;
}

// 火災メールを受け取る（Cloudflare Email Routing で、このWorker宛に転送したメール）
export async function receiveMail(env, raw, now = new Date()) {
  await setup(env);
  const r = parseMail(raw, now);
  const added = r.items.length ? await ingestOfficial(env, r.items, now) : 0;
  await env.DB.prepare('INSERT INTO sources (id, last_try, last_ok, status, items, sample) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_try = excluded.last_try, last_ok = excluded.last_ok, status = excluded.status, items = sources.items + excluded.items, sample = excluded.sample')
    .bind('mail-' + (r.from || 'unknown'), now.toISOString(), now.toISOString(), 'メール', added, (r.subject || '').slice(0, 200)).run();
  return { ...r, added };
}

export default {
  fetch: (request, env) => handle(request, env),
  email: async (message, env) => {
    const buf = new Uint8Array(await new Response(message.raw).arrayBuffer());
    let raw = ''; for (let i = 0; i < buf.length; i += 8192) raw += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    const r = await receiveMail(env, raw);
    // 火災の発表でないメール（市の配信サービスの登録確認など）は、運営のアドレスへ転送する
    // MAIL_FORWARD は Email Routing の「転送先アドレス」で確認済みのアドレス（Cloudflare の変数に設定）
    if (!r.items.length && env.MAIL_FORWARD) { try { await message.forward(env.MAIL_FORWARD); } catch (e) {} }
  },
  scheduled: async (event, env) => {
    await setup(env);
    if (event.cron === '17 4 * * *') {
      // 毎日、古い報告の明細を削除（火事の件数・口コミは残す）
      await env.DB.prepare('DELETE FROM reports WHERE at < ?').bind(new Date(Date.now() - KEEP_REPORT_DAYS * 864e5).toISOString()).run();
      return;
    }
    await pollSources(env);   // 毎分: 消防本部の出動情報
    try { await pollX(env); } catch (e) {}   // X の投稿（X_BEARER を設定したときだけ。1日の上限つき）
  },
};
