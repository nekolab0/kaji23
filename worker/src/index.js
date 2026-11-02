// 火事どこ23区 — 「サイレンが聞こえた」報告の受付サーバー（Cloudflare Workers + D1）
// POST /api/report   {ward, town?, kind}  … 報告を1件受け付ける
// GET  /api/reports?hours=24                … 区・町ごとの件数（直近N時間）
// 生のIPアドレスは保存しない（日ごとに変わる塩を混ぜたハッシュだけを、連投防止に使う）
export const WARDS = ['足立区', '荒川区', '板橋区', '江戸川区', '大田区', '葛飾区', '北区', '江東区', '品川区', '渋谷区', '新宿区', '杉並区', '墨田区',
  '世田谷区', '台東区', '中央区', '千代田区', '豊島区', '中野区', '練馬区', '文京区', '港区', '目黒区'];
export const KINDS = ['siren', 'smoke', 'fire'];
const COOLDOWN_MIN = 10;     // 同じ人・同じ区は10分に1回まで
const KEEP_DAYS = 7;         // 7日より古い報告は削除

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

// 初回アクセス時に表を作り、ハッシュ用の塩をランダムに作って保存する（手作業の設定・秘密鍵の登録を不要にする）
let ready = null;
async function setup(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, ward TEXT NOT NULL, town TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('siren','smoke','fire')), at TEXT NOT NULL, who TEXT NOT NULL)`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_reports_at ON reports(at)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_reports_who ON reports(who, ward, at)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)').run();
  if (env.SALT) return env.SALT;
  const rnd = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT OR IGNORE INTO meta (k, v) VALUES (?, ?)').bind('salt', rnd).run();
  return (await env.DB.prepare('SELECT v FROM meta WHERE k = ?').bind('salt').first()).v;
}

export async function handle(request, env, now = new Date()) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return cors(env, new Response(null, { status: 204 }));
  if (!ready || ready.env !== env) { const p = setup(env); ready = { env, p }; p.catch(() => { ready = null; }); }
  const salt = await ready.p;

  if (url.pathname === '/api/report' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json(env, { error: '送信内容を読み取れませんでした' }, 400); }
    const ward = String(body.ward || '');
    const kind = String(body.kind || '');
    let town = body.town == null ? '' : String(body.town).trim();
    if (!WARDS.includes(ward)) return json(env, { error: '区名が正しくありません' }, 400);
    if (!KINDS.includes(kind)) return json(env, { error: '報告の種類が正しくありません' }, 400);
    // 町名は丁目まで。番地・号や記号は受け付けない（個人の特定を避ける）
    town = town.replace(/[0-9０-９]+(番地?|号|-|－).*$/, '').slice(0, 20);
    if (town && !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々ヶケ0-9０-９・]+$/u.test(town)) return json(env, { error: '町名に使えない文字が含まれています' }, 400);
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const day = now.toISOString().slice(0, 10);
    const who = await sha256(`${ip}|${salt}|${day}`);
    const since = new Date(now - COOLDOWN_MIN * 60e3).toISOString();
    const dup = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE who = ? AND ward = ? AND at > ?').bind(who, ward, since).first();
    if (dup && dup.n > 0) return json(env, { error: `同じ区への報告は${COOLDOWN_MIN}分に1回までです`, cooldown: true }, 429);
    await env.DB.prepare('INSERT INTO reports (ward, town, kind, at, who) VALUES (?, ?, ?, ?, ?)').bind(ward, town || null, kind, now.toISOString(), who).run();
    return json(env, { ok: true });
  }

  if (url.pathname === '/api/reports' && request.method === 'GET') {
    const hours = Math.min(72, Math.max(1, parseInt(url.searchParams.get('hours') || '24', 10) || 24));
    const since = new Date(now - hours * 3600e3).toISOString();
    const { results } = await env.DB.prepare(
      'SELECT ward, town, kind, COUNT(*) AS n, MAX(at) AS last FROM reports WHERE at > ? GROUP BY ward, town, kind').bind(since).all();
    const wards = {};
    for (const r of results) {
      const w = wards[r.ward] = wards[r.ward] || { siren: 0, smoke: 0, fire: 0, total: 0, last: null, towns: {} };
      w[r.kind] += r.n; w.total += r.n;
      if (!w.last || r.last > w.last) w.last = r.last;
      if (r.town) w.towns[r.town] = (w.towns[r.town] || 0) + r.n;
    }
    return json(env, { generatedAt: now.toISOString(), hours, wards }, 200, { 'Cache-Control': 'public, max-age=60' });
  }
  return json(env, { error: 'not found' }, 404);
}

export default {
  fetch: (request, env) => handle(request, env),
  // 毎日、古い報告を削除
  scheduled: async (event, env) => {
    await setup(env);
    await env.DB.prepare('DELETE FROM reports WHERE at < ?').bind(new Date(Date.now() - KEEP_DAYS * 864e5).toISOString()).run();
  },
};
