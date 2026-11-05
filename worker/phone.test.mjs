// 案内ダイヤルへの自動電話のテスト（Twilio・Workers AI・サイトの報道データはまねたもの）
import { makeEnv } from './test.mjs';
import { handle, ingestOfficial } from './src/index.js';
import { phoneTick, parsePhone, dialFor, coveredByWeb, e164, enqueue } from './src/phone.js';
const results = []; const ok = (n, c, d = '') => results.push({ name: n, ok: !!c, detail: String(d) });
const now = new Date('2026-11-04T10:00:00Z');   // 日本時間 19:00

ok('番号の形（+81）', e164('0250-42-3399') === '+81250423399' && e164('050-5830-5367') === '+815058305367');
ok('案内ダイヤルの番号を引ける・東京はかけない', dialFor('新潟県', '五泉市') === '0250-42-3399' && dialFor('東京都', '北区') === null);
ok('消防の発表ページで取れている市はかけない', coveredByWeb('愛知県', '名古屋市中川区') && coveredByWeb('茨城県', '水戸市') && !coveredByWeb('新潟県', '五泉市'));

// 文字起こしの読み取り
const at = '2026-11-04T09:56:00Z';   // 18:56
const p1 = parsePhone('こちらは五泉市消防本部です。ただいま、五泉市中島地内で林野火災が発生し、消防車が出動しています。', { pref: '新潟県', city: '五泉市', at, source: 'tel-新潟県五泉市' });
ok('文字起こし: 「ただいま○○地内で林野火災」→ 電話した時刻で取り込む', p1.length === 1 && p1[0].town === '中島' && p1[0].kind === '林野火災' && p1[0].at === '2026-11-04T09:56:00.000Z', JSON.stringify(p1));
const p2 = parsePhone('延岡市消防本部です。十六時四十分ごろ、北方町上鹿川で建物火災が発生しました。', { pref: '宮崎県', city: '延岡市', at: '2026-11-04T08:10:00Z', source: 't' });
ok('文字起こし: 漢数字の時刻（十六時四十分）', p2.length === 1 && p2[0].town === '北方町上鹿川' && p2[0].at === '2026-11-04T07:40:00.000Z', JSON.stringify(p2));
const p3 = parsePhone('こちらは桑名市消防本部です。現在、桑名市内で火災は発生していません。', { pref: '三重県', city: '桑名市', at, source: 't' });
ok('文字起こし: 「火災は発生していません」は取り込まない', p3.length === 0, JSON.stringify(p3));
const p4 = parsePhone('先ほど、西別所で発生した車両火災は鎮火しました。', { pref: '三重県', city: '桑名市', at, source: 't' });
ok('文字起こし: 鎮火の案内は状態つき', p4.length === 1 && p4[0].status === '鎮火' && p4[0].kind === '車両火災', JSON.stringify(p4));

// 一連の流れ
const { env, db } = makeEnv();
await handle(new Request('https://w.example/api/live'), env, now);   // 表を用意
const news = { 'n-1': { pref: '新潟県', city: '五泉市', town: null, first: '2026-11-04T09:20:00Z' },
  'n-2': { pref: '愛知県', city: '名古屋市中川区', town: '吉津', first: '2026-11-04T09:30:00Z' },     // 発表ページで取れている
  'n-3': { pref: '東京都', city: '北区', town: '赤羽', first: '2026-11-04T09:30:00Z' },               // 東京はかけない
  'n-4': { pref: '兵庫県', city: '宍粟市', town: null, first: '2026-11-03T20:00:00Z' } };            // 古い
const calls = [], deleted = [];
const fetcher = async (u, o = {}) => {
  if (u.endsWith('/data/news.js')) return new Response('window.KAJI_NEWS = ' + JSON.stringify(news) + ';\n');
  if (u.includes('/Calls.json')) { calls.push(Object.fromEntries(new URLSearchParams(o.body))); return new Response(JSON.stringify({ sid: 'CA' + calls.length }), { status: 201 }); }
  if (u.endsWith('.mp3')) return new Response(new Uint8Array([1, 2, 3, 4]));
  if (o.method === 'DELETE') { deleted.push(u); return new Response('', { status: 204 }); }
  return new Response('', { status: 404 });
};
const r0 = await phoneTick(env, now, fetcher);
ok('Twilio を設定するまでは何もしない', r0.skipped && calls.length === 0);
Object.assign(env, { TWILIO_SID: 'AC1', TWILIO_TOKEN: 'tok', TWILIO_FROM: '+15550001111', PHONE_DAILY_MAX: '2', API_URL: 'https://api.example' });
const r1 = await phoneTick(env, now, fetcher);
ok('報道の火事: 発表ページ・東京・古いものを除いて、五泉市だけに電話', calls.length === 1 && calls[0].To === '+81250423399' && r1.queued.length === 1 && /k=[0-9a-f]{36}/.test(calls[0].RecordingStatusCallback), JSON.stringify(r1) + JSON.stringify(calls[0]));
ok('こちらは話さず録音だけ（60秒ほど）', calls[0].Record === 'true' && /<Pause length="58"\/>/.test(calls[0].Twiml) && calls[0].TimeLimit === '62');
await phoneTick(env, new Date(+now + 60e3), fetcher);
ok('同じ地域へ続けてかけない', calls.length === 1);
ok('同じ番号へは45分あける', await enqueue(env, { pref: '新潟県', city: '五泉市', reason: 'news' }, new Date(+now + 30 * 60e3)) === 'recent');

// 録音ができた知らせ → 文字起こし → 取り込み
const key = db.prepare("SELECT v FROM meta WHERE k = 'phone_key'").get().v;
env.__fetch = fetcher; env.AI = { run: async (model, input) => ({ text: 'こちらは五泉市消防本部です。ただいま、五泉市中島地内で林野火災が発生し、消防車が出動しています。' }) };
const form = new URLSearchParams({ CallSid: 'CA1', RecordingUrl: 'https://api.twilio.com/rec/RE1', RecordingSid: 'RE1' });
const bad = await handle(new Request('https://w.example/api/phone/rec?k=wrong', { method: 'POST', body: form }), env, now);
ok('鍵が違う知らせは断る', bad.status === 403);
const rec = await (await handle(new Request('https://w.example/api/phone/rec?k=' + key, { method: 'POST', body: form }), env, new Date(+now + 70e3))).json();
ok('録音 → 文字起こし → 火災を取り込み', rec.found === 1 && rec.added === 1, JSON.stringify(rec));
ok('録音は Twilio から消す', deleted.some(u => u.includes('/Recordings/RE1.json')));
const off = await (await handle(new Request('https://w.example/api/official?days=7'), env, now)).json();
ok('サイト用の記録に「案内ダイヤル（自動音声を文字起こし）」として出る', off.items.some(x => x.town === '中島' && /案内ダイヤル/.test(x.source_name)), JSON.stringify(off.items));
const log = await (await handle(new Request('https://w.example/api/phone'), env, now)).json();
ok('確認用の記録（文字起こしの文章と件数）', log.enabled && log.calls[0].found === 1 && log.calls[0].text.includes('中島'), JSON.stringify(log.calls));
// サイレン報告がきっかけ
db.prepare("INSERT INTO incidents (id, pref, ward, town, base, first_at, last_at, n, official) VALUES ('s1','三重県','桑名市','西別所','西別所',?,?,2,0)").run(now.toISOString(), now.toISOString());
const r2 = await phoneTick(env, new Date(+now + 120e3), fetcher);
ok('サイレン・煙の報告2件以上で、その市に電話', calls.length === 2 && calls[1].To === '+81594217777', JSON.stringify(r2));
db.prepare("INSERT INTO incidents (id, pref, ward, town, base, first_at, last_at, n, official) VALUES ('s2','兵庫県','宍粟市','山崎町','山崎町',?,?,3,0)").run(now.toISOString(), now.toISOString());
const r3 = await phoneTick(env, new Date(+now + 180e3), fetcher);
ok('1日の上限（PHONE_DAILY_MAX）を超えてかけない', calls.length === 2 && /上限/.test(r3.skipped || ''), JSON.stringify(r3));

results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? ' — ' + r.detail : ''}`));
process.exit(results.some(r => !r.ok) ? 1 : 0);
