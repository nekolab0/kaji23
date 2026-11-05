// Web プッシュ通知のテスト（ブラウザ側の鍵を作り、送られた中身を実際に復号して確かめる）
import { makeEnv } from './test.mjs';
import { handle } from './src/index.js';
import { pushTick } from './src/push.js';
const results = []; const ok = (n, c, d = '') => results.push({ name: n, ok: !!c, detail: String(d) });
const b64u = buf => Buffer.from(buf).toString('base64url');
const enc = new TextEncoder();
const now = new Date('2026-11-04T10:00:00Z');

// ブラウザ（受け手）の鍵
const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));
const sub = { endpoint: 'https://push.example/send/abc', keys: { p256dh: b64u(uaPub), auth: b64u(auth) } };
async function hkdf(salt, ikm, info, len) { const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8)); }
async function decrypt(body) {   // 受け手側の RFC 8291 の手順
  const b = new Uint8Array(body); const salt = b.slice(0, 16), idlen = b[20], asPub = b.slice(21, 21 + idlen), ct = b.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, shared, new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPub, ...asPub]), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, ct));
  return JSON.parse(new TextDecoder().decode(pt.slice(0, pt.lastIndexOf(2))));
}

const { env, db } = makeEnv();
const req = (m, p, b) => new Request('https://w.example' + p, { method: m, body: b && JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });
const key = await (await handle(req('GET', '/api/push/key'), env, now)).json();
ok('VAPID の公開鍵を自動で作って返す（65バイト）', Buffer.from(key.key, 'base64url').length === 65);
const key2 = await (await handle(req('GET', '/api/push/key'), env, now)).json();
ok('鍵は保存して使い回す', key2.key === key.key);
const bad = await handle(req('POST', '/api/push/subscribe', { subscription: sub }), env, now);
ok('地域なしの登録は断る', bad.status === 400);
const s1 = await (await handle(req('POST', '/api/push/subscribe', { subscription: sub, area: { pref: '新潟県', city: '五泉市', town: '' } }), env, now)).json();
const s2 = await (await handle(req('POST', '/api/push/subscribe', { subscription: sub, area: { pref: '愛知県', city: '名古屋市中川区', town: '吉津' } }), env, now)).json();
ok('市区町村・町で登録できる（同じブラウザで複数）', s1.ok && s2.areas.length === 2, JSON.stringify(s2));

// 火事: 五泉市（市全体の登録に当たる）・名古屋市中川区の別の町（当たらない）・吉津（当たる）
const ins = (id, pref, ward, town, official, n) => db.prepare('INSERT INTO incidents (id, pref, ward, town, base, first_at, last_at, n, official, official_kind) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, pref, ward, town, town, now.toISOString(), now.toISOString(), n, official, official ? '建物火災' : null);
ins('g1', '新潟県', '五泉市', '中島', 1, 0); ins('n1', '愛知県', '名古屋市中川区', '八熊', 0, 3); ins('n2', '愛知県', '名古屋市中川区', '吉津2丁目', 0, 2); ins('x1', '新潟県', '五泉市', '本町', 0, 1);
const sent = [];
const fetcher = async (u, o = {}) => {
  if (u.endsWith('/data/news.js')) return new Response('window.KAJI_NEWS = {};');
  if (u.startsWith('https://push.example/')) { sent.push({ u, o }); return new Response('', { status: 201 }); }
  return new Response('', { status: 404 });
};
const r1 = await pushTick(env, now, fetcher);
ok('地域が合う火事だけ送る（五泉市の発表・吉津の報告2件。八熊・報告1件は送らない）', sent.length === 2, JSON.stringify(r1));
const msgs = await Promise.all(sent.map(x => decrypt(x.o.body)));
ok('中身を復号できる（RFC 8291）・題名とリンク', msgs.some(m => /五泉市中島付近で火災（消防の発表）/.test(m.title) && /fire\.html\?id=g1/.test(m.url)) && msgs.some(m => /吉津2丁目/.test(m.title) && /報告が2件/.test(m.body)), JSON.stringify(msgs));
const h = sent[0].o.headers;
ok('暗号化と緊急度の見出し', h['Content-Encoding'] === 'aes128gcm' && h.TTL && h.Urgency === 'high');
// VAPID の署名を公開鍵で確かめる
const [, t, k] = h.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
const [hd, bd, sg] = t.split('.');
const pk = await crypto.subtle.importKey('raw', Buffer.from(k, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const okSig = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pk, Buffer.from(sg, 'base64url'), enc.encode(hd + '.' + bd));
const claims = JSON.parse(Buffer.from(bd, 'base64url').toString());
ok('VAPID の署名が正しい・宛先はプッシュサービスの origin', okSig && claims.aud === 'https://push.example' && k === key.key, JSON.stringify(claims));
await pushTick(env, new Date(+now + 60e3), fetcher);
ok('同じ火事は二度送らない', sent.length === 2);
// 解除済みのブラウザ（410）は消す
const gone = async (u, o = {}) => u.startsWith('https://push.example/') ? new Response('', { status: 410 }) : fetcher(u, o);
ins('g2', '新潟県', '五泉市', '泉町', 1, 0);
const r3 = await pushTick(env, new Date(+now + 120e3), gone);
ok('ブラウザ側で解除済み（410）の登録は消す', r3.gone === 1 && db.prepare('SELECT COUNT(*) n FROM push_subs').get().n === 0, JSON.stringify(r3));
const r4 = await pushTick(env, new Date(+now + 180e3), fetcher);
ok('登録がなければ何もしない', r4.skipped);
// 解除
await handle(req('POST', '/api/push/subscribe', { subscription: sub, area: { pref: '新潟県', city: '五泉市' } }), env, now);
const un = await (await handle(req('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }), env, now)).json();
ok('解除すると登録が消える', un.ok && un.areas.length === 0 && db.prepare('SELECT COUNT(*) n FROM push_subs').get().n === 0);

results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? ' — ' + r.detail : ''}`));
process.exit(results.some(r => !r.ok) ? 1 : 0);
