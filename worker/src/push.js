// Web プッシュ通知: 「この町（市区町村）で火事が起きたら知らせる」
//
// 仕組み
//  - 鍵（VAPID）は受付サーバーが初回に自動で作り、D1 に保存する（Cloudflare の設定は不要・費用なし）
//  - ブラウザの登録（endpoint と暗号鍵）と、知らせてほしい地域（都道府県・市区町村・町名は任意）を D1 に保存する。個人を特定する情報は持たない
//  - 毎分、新しい火事（消防の発表・火災メール・案内ダイヤル、サイレン・煙の報告2件以上、報道）を見て、地域が合う登録に1回だけ送る
//  - 送れなかった登録（ブラウザ側で解除済み: 404/410）は消す。1つの登録に送るのは1日10回まで
//  - 中身は RFC 8291（aes128gcm）で暗号化し、RFC 8292（VAPID）の署名をつける
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const DAILY_MAX = 10;

async function setupPush(DB) {
  await DB.prepare('CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created TEXT NOT NULL, sent_day TEXT, sent_n INTEGER NOT NULL DEFAULT 0)').run();
  await DB.prepare('CREATE TABLE IF NOT EXISTS push_areas (endpoint TEXT NOT NULL, pref TEXT NOT NULL, city TEXT NOT NULL, town TEXT NOT NULL DEFAULT \'\', PRIMARY KEY (endpoint, pref, city, town))').run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_push_area ON push_areas(pref, city)').run();
  await DB.prepare('CREATE TABLE IF NOT EXISTS push_sent (endpoint TEXT NOT NULL, ref TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (endpoint, ref))').run();
  await DB.prepare('CREATE TABLE IF NOT EXISTS push_done (ref TEXT PRIMARY KEY, at TEXT NOT NULL)').run();
}
async function meta(DB, k, v) {
  if (v === undefined) { const r = await DB.prepare('SELECT v FROM meta WHERE k = ?').bind(k).first(); return r ? r.v : null; }
  await DB.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, String(v)).run();
}

// ---------- 鍵（VAPID） ----------
export async function vapidKeys(DB) {
  const saved = await meta(DB, 'vapid_jwk');
  if (saved) { const j = JSON.parse(saved); return { jwk: j.jwk, pub: j.pub }; }
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  await meta(DB, 'vapid_jwk', JSON.stringify({ jwk, pub }));
  return { jwk, pub };
}
async function vapidHeader(DB, endpoint, now) {
  const { jwk, pub } = await vapidKeys(DB);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: 'mailto:contact@kajisoku.jp' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`;
}

// ---------- 中身の暗号化（RFC 8291） ----------
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
export async function encryptPayload(text, p256dh, auth, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const uaPub = unb64u(p256dh), authSecret = unb64u(auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, cat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // レコードの大きさ 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export async function sendPush(env, sub, payload, now = new Date(), fetcher = fetch) {
  const body = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
  const r = await fetcher(sub.endpoint, { method: 'POST', body, headers: {
    Authorization: await vapidHeader(env.DB, sub.endpoint, now), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high' } });
  return r.status;
}

// ---------- 登録・解除 ----------
export async function subscribe(env, body, now = new Date()) {
  const DB = env.DB; await setupPush(DB);
  const s = body && body.subscription, a = body && body.area;
  if (!s || !/^https:\/\//.test(s.endpoint || '') || !s.keys || !s.keys.p256dh || !s.keys.auth) return { error: '通知の登録情報が正しくありません', status: 400 };
  if (!a || !a.pref || !a.city) return { error: '地域を選んでください', status: 400 };
  const { results } = await DB.prepare('SELECT COUNT(*) n FROM push_areas WHERE endpoint = ?').bind(s.endpoint).all();
  if (results[0].n >= 10) return { error: '通知を受け取る地域は10か所までです', status: 400 };
  await DB.prepare('INSERT INTO push_subs (endpoint, p256dh, auth, created) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth')
    .bind(s.endpoint, s.keys.p256dh, s.keys.auth, now.toISOString()).run();
  await DB.prepare('INSERT OR IGNORE INTO push_areas (endpoint, pref, city, town) VALUES (?, ?, ?, ?)').bind(s.endpoint, String(a.pref).slice(0, 10), String(a.city).slice(0, 30), String(a.town || '').slice(0, 30)).run();
  return { ok: true, areas: (await DB.prepare('SELECT pref, city, town FROM push_areas WHERE endpoint = ?').bind(s.endpoint).all()).results };
}
export async function unsubscribe(env, body) {
  const DB = env.DB; await setupPush(DB);
  const ep = body && body.endpoint; if (!ep) return { error: 'endpoint がありません', status: 400 };
  const a = body.area;
  if (a && a.pref && a.city) await DB.prepare('DELETE FROM push_areas WHERE endpoint = ? AND pref = ? AND city = ? AND town = ?').bind(ep, a.pref, a.city, a.town || '').run();
  else await DB.prepare('DELETE FROM push_areas WHERE endpoint = ?').bind(ep).run();
  const left = (await DB.prepare('SELECT pref, city, town FROM push_areas WHERE endpoint = ?').bind(ep).all()).results;
  if (!left.length) await DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(ep).run();
  return { ok: true, areas: left };
}
export async function myAreas(env, endpoint) {
  try { return (await env.DB.prepare('SELECT pref, city, town FROM push_areas WHERE endpoint = ?').bind(endpoint).all()).results; } catch (e) { return []; }
}

// ---------- 毎分: 新しい火事を地域の登録者へ ----------
const base = t => String(t || '').replace(/[0-9０-９一二三四五六七八九十]+丁目.*$/, '');
function fireUrl(site, ref) { return site + (/^(n|o)-/.test(ref) ? `/f-${encodeURIComponent(ref)}.html` : `/fire.html?id=${encodeURIComponent(ref)}`); }
export async function pushTick(env, now = new Date(), fetcher = fetch) {
  const DB = env.DB; await setupPush(DB);
  const has = await DB.prepare('SELECT 1 FROM push_subs LIMIT 1').first();
  if (!has) return { skipped: '登録なし' };
  const site = (env.SITE_URL || 'https://kajisoku.jp').replace(/\/$/, '');
  const events = [];
  // ① 受付サーバーの火事（消防の発表・メール・電話、または報告2件以上）。15分以内に動きがあったもの
  const { results } = await DB.prepare(`SELECT id, pref, ward, town, official, official_kind, n, siren, smoke, fire FROM incidents
    WHERE last_at > ? AND (official = 1 OR n >= 2) ORDER BY last_at DESC LIMIT 30`).bind(new Date(now - 15 * 60e3).toISOString()).all();
  for (const x of results) {
    const pref = x.pref || '東京都', place = x.ward + (x.town || '');
    events.push({ ref: x.id, pref, city: x.ward, town: base(x.town),
      title: `${place}付近で火災${x.official ? '（消防の発表）' : 'の可能性'}`,
      body: x.official ? `${x.official_kind || '火災'}の発表がありました。火事速で場所と状況を確認できます。` : `サイレン・煙などの報告が${x.n}件あります（消防の発表ではありません）。`,
      url: fireUrl(site, x.id) });
  }
  // ② 報道の火事（10分ごとにサイトの公開データを読む。2時間以内の報道）
  const last = await meta(DB, 'push_news_at');
  if (!last || now - new Date(last) > 10 * 60e3) {
    await meta(DB, 'push_news_at', now.toISOString());
    try {
      const r = await fetcher(site + '/data/news.js', { headers: { 'User-Agent': 'kaji23-bot/1.0' } });
      const txt = r.ok ? await r.text() : '';
      const data = txt ? JSON.parse(txt.slice(txt.indexOf('=') + 1).trim().replace(/;$/, '')) : {};
      for (const [id, x] of Object.entries(data)) {
        if (!x.pref || !x.city || now - new Date(x.first) > 2 * 3600e3 || x.sensitive) continue;
        events.push({ ref: id, pref: x.pref, city: x.city, town: base(x.town), title: `${x.city}${x.town || ''}で火事の報道`, body: `${x.building && x.building !== '建物不明' ? x.building + 'の' : ''}火事が報道されました。`, url: fireUrl(site, id) });
      }
    } catch (e) {}
  }
  const day = new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  let sent = 0, gone = 0;
  for (const ev of events) {
    if (await DB.prepare('SELECT 1 FROM push_done WHERE ref = ?').bind(ev.ref + '|' + ev.title).first()) continue;
    // 町名つきの登録は町が合うときだけ。町名なしの登録は市区町村全体
    const { results: subs } = await DB.prepare(`SELECT DISTINCT s.endpoint, s.p256dh, s.auth, s.sent_day, s.sent_n FROM push_areas a JOIN push_subs s ON s.endpoint = a.endpoint
      WHERE a.pref = ? AND a.city = ? AND (a.town = '' OR a.town = ?)`).bind(ev.pref, ev.city, ev.town || '\u0000').all();
    for (const s of subs) {
      if (await DB.prepare('SELECT 1 FROM push_sent WHERE endpoint = ? AND ref = ?').bind(s.endpoint, ev.ref).first()) continue;
      const n = s.sent_day === day ? s.sent_n : 0; if (n >= DAILY_MAX) continue;
      let st = 0; try { st = await sendPush(env, s, { title: '【火事速】' + ev.title, body: ev.body, url: ev.url, tag: ev.ref }, now, fetcher); } catch (e) { st = -1; }
      if (st === 404 || st === 410) { await DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint).run(); await DB.prepare('DELETE FROM push_areas WHERE endpoint = ?').bind(s.endpoint).run(); gone++; continue; }
      if (st >= 200 && st < 300) {
        sent++;
        await DB.prepare('INSERT OR IGNORE INTO push_sent (endpoint, ref, at) VALUES (?, ?, ?)').bind(s.endpoint, ev.ref, now.toISOString()).run();
        await DB.prepare('UPDATE push_subs SET sent_day = ?, sent_n = ? WHERE endpoint = ?').bind(day, n + 1, s.endpoint).run();
      }
    }
    await DB.prepare('INSERT OR IGNORE INTO push_done (ref, at) VALUES (?, ?)').bind(ev.ref + '|' + ev.title, now.toISOString()).run();
  }
  // 古い送信記録は2日で消す
  if (now.getUTCMinutes() === 7) { await DB.prepare('DELETE FROM push_sent WHERE at < ?').bind(new Date(now - 2 * 864e5).toISOString()).run(); await DB.prepare('DELETE FROM push_done WHERE at < ?').bind(new Date(now - 2 * 864e5).toISOString()).run(); }
  return { events: events.length, sent, gone };
}
