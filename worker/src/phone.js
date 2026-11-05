// 消防の「案内ダイヤル」（出動中の火災を自動音声で案内する電話）に、必要なときだけ自動で電話して火災を確かめる
//
// 仕組み（kaji.news と同じ「何かあった地域だけ、そのときにかける」方式＋むだ打ちを減らす工夫）
//  1. きっかけ: ①報道の火事（3時間以内）②サイレン・煙の報告が2件以上 の地域のうち、
//     消防の発表ページや火災メールで取れていない市区町村で、案内ダイヤルの番号がわかるところ
//  2. 電話: Twilio で発信し、相手の自動音声を最大50秒ほど録音（1分の課金単位に収める）（こちらは何も話さない）
//  3. 文字起こし: Cloudflare Workers AI の Whisper（1日約200分まで無料）→ 消防の発表と同じ読み取りで「町名・種別・時刻」を取り出す
//  4. むだ打ちの防止: 同じ番号へは45分あける／1日の上限 PHONE_DAILY_MAX 回（初期値20回・1回約12円）／
//     2回続けて録音できなかった番号は7日休む／東京消防庁など人が出る番号はかけない
//  5. 録音は文字起こしが済んだら Twilio から消す（保存しない）。文字起こしの文章は確認用に D1 に残す
//  TWILIO_SID・TWILIO_TOKEN・TWILIO_FROM を Cloudflare の Secret に入れるまでは何もしない（費用はかからない）
import { DIAL } from './dial.js';
import { SOURCES, parseSource, fireKind } from './official.js';

const NO_CALL_PREFS = new Set(['東京都']);          // 東京消防庁の案内（03-3212-2119）は人が応対する
const NO_CALL_TELS = new Set(['03-3212-2119']);
const GAP_MIN = 45;                                   // 同じ番号へは45分あける
const NEWS_HOURS = 3, SIREN_MIN = 30;

export function e164(tel) { const d = String(tel).replace(/\D/g, ''); return d.startsWith('0') ? '+81' + d.slice(1) : null; }
export function dialFor(pref, city) {
  if (NO_CALL_PREFS.has(pref)) return null;
  let t = DIAL[pref + '|' + city];
  if (!t) { const m = String(city).match(/^(.+?市).+区$/); if (m) t = DIAL[pref + '|' + m[1]]; }
  return t && !NO_CALL_TELS.has(t) && e164(t) ? t : null;
}
// 消防の発表ページで取れている市区町村（電話は不要）
export function coveredByWeb(pref, city) {
  return SOURCES.some(s => s.pref === pref && (s.city === city || (s.wardCity && city.startsWith(s.wardCity)) ||
    String(s.name).split(/の消防|（/)[0].split(/[・、]/).includes(city)));
}

async function setupPhone(DB) {
  await DB.prepare('CREATE TABLE IF NOT EXISTS phone_queue (area TEXT PRIMARY KEY, pref TEXT, city TEXT, tel TEXT, reason TEXT, ref TEXT, created TEXT)').run();
  await DB.prepare('CREATE TABLE IF NOT EXISTS phone_calls (sid TEXT PRIMARY KEY, area TEXT, pref TEXT, city TEXT, tel TEXT, reason TEXT, ref TEXT, at TEXT, status TEXT, text TEXT, found INTEGER)').run();
  await DB.prepare('CREATE INDEX IF NOT EXISTS idx_phone_calls_tel ON phone_calls(tel, at)').run();
}
async function meta(DB, k, v) {
  if (v === undefined) { const r = await DB.prepare('SELECT v FROM meta WHERE k = ?').bind(k).first(); return r ? r.v : null; }
  await DB.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, String(v)).run();
}
export async function phoneKey(DB) {
  let k = await meta(DB, 'phone_key');
  if (!k) { k = [...crypto.getRandomValues(new Uint8Array(18))].map(b => b.toString(16).padStart(2, '0')).join(''); await meta(DB, 'phone_key', k); }
  return k;
}

// 電話をかける候補に入れる（条件に合わなければ何もしない）
export async function enqueue(env, { pref, city, reason, ref }, now = new Date()) {
  const DB = env.DB;
  const tel = dialFor(pref, city); if (!tel) return 'no-dial';
  if (coveredByWeb(pref, city)) return 'covered';
  // 火災メール・発表ページで3時間以内に取れている市区町村は不要
  const off = await DB.prepare("SELECT 1 FROM official WHERE pref = ? AND ward = ? AND at > ? AND source NOT LIKE 'tel-%' LIMIT 1").bind(pref, city, new Date(now - 3 * 3600e3).toISOString()).first();
  if (off) return 'covered';
  const rest = await meta(DB, 'phone_rest:' + tel); if (rest && rest > now.toISOString()) return 'resting';
  const last = await DB.prepare('SELECT at FROM phone_calls WHERE tel = ? ORDER BY at DESC LIMIT 1').bind(tel).first();
  if (last && now - new Date(last.at) < GAP_MIN * 60e3) return 'recent';
  const r = await DB.prepare('INSERT OR IGNORE INTO phone_queue (area, pref, city, tel, reason, ref, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(pref + '|' + city, pref, city, tel, reason, ref || null, now.toISOString()).run();
  return r.meta && r.meta.changes ? 'queued' : 'queued-already';
}

// 毎分: きっかけを集めて、1回だけ電話する
export async function phoneTick(env, now = new Date(), fetcher = fetch) {
  if (!env.TWILIO_SID || !env.TWILIO_TOKEN || !env.TWILIO_FROM) return { skipped: 'Twilio が未設定' };
  const DB = env.DB; await setupPhone(DB);
  const log = { queued: [] };
  // ① 報道の火事（10分ごとにサイトの公開データを読む）
  const lastNews = await meta(DB, 'phone_news_at');
  if (!lastNews || now - new Date(lastNews) > 10 * 60e3) {
    await meta(DB, 'phone_news_at', now.toISOString());
    try {
      const site = (env.SITE_URL || 'https://kajisoku.jp').replace(/\/$/, '');
      const r = await fetcher(site + '/data/news.js', { headers: { 'User-Agent': 'kaji23-bot/1.0' } });
      const txt = r.ok ? await r.text() : '';
      const data = txt ? JSON.parse(txt.slice(txt.indexOf('=') + 1).trim().replace(/;$/, '')) : {};
      for (const [id, x] of Object.entries(data)) {
        if (!x.pref || !x.city || now - new Date(x.first) > NEWS_HOURS * 3600e3) continue;
        const s = await enqueue(env, { pref: x.pref, city: x.city, reason: 'news', ref: id }, now);
        if (s === 'queued') log.queued.push(x.pref + x.city + '（報道）');
      }
    } catch (e) { log.newsError = String(e.message).slice(0, 80); }
  }
  // ② サイレン・煙の報告が2件以上（消防の発表がまだない）
  const { results: sir } = await DB.prepare('SELECT id, pref, ward FROM incidents WHERE official = 0 AND n >= 2 AND last_at > ? ORDER BY last_at DESC LIMIT 10')
    .bind(new Date(now - SIREN_MIN * 60e3).toISOString()).all();
  for (const x of sir) { const s = await enqueue(env, { pref: x.pref || '東京都', city: x.ward, reason: 'siren', ref: x.id }, now); if (s === 'queued') log.queued.push(x.ward + '（報告）'); }
  // ③ 1分に1回まで発信（1日の上限つき）
  const max = Math.max(0, parseInt(env.PHONE_DAILY_MAX || '20', 10) || 0);
  const day = new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const used = +(await meta(DB, 'phone_used:' + day) || 0);
  if (used >= max) return { ...log, skipped: '今日の上限に達しました', used, max };
  const q = await DB.prepare('SELECT * FROM phone_queue ORDER BY created LIMIT 1').first();
  if (!q) return { ...log, used, max };
  await DB.prepare('DELETE FROM phone_queue WHERE area = ?').bind(q.area).run();
  if (now - new Date(q.created) > 2 * 3600e3) return { ...log, dropped: q.area };   // 古いきっかけは捨てる
  const call = await placeCall(env, q, now, fetcher);
  await meta(DB, 'phone_used:' + day, used + 1);
  return { ...log, call, used: used + 1, max };
}

export async function placeCall(env, q, now = new Date(), fetcher = fetch) {
  const DB = env.DB;
  const key = await phoneKey(DB);
  const api = (env.API_URL || 'https://api.kajisoku.jp').replace(/\/$/, '');
  const form = new URLSearchParams({
    To: e164(q.tel), From: env.TWILIO_FROM,
    Twiml: '<Response><Pause length="50"/><Hangup/></Response>',   // こちらは話さず、相手の案内を聞くだけ（1分の課金単位に収める）
    Record: 'true', RecordingChannels: 'mono', TimeLimit: '55', Timeout: '25',
    RecordingStatusCallback: `${api}/api/phone/rec?k=${key}`, RecordingStatusCallbackMethod: 'POST',
    StatusCallback: `${api}/api/phone/status?k=${key}`, StatusCallbackMethod: 'POST',
  });
  let sid = 'err-' + now.getTime(), status = 'error';
  try {
    const r = await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Calls.json`, {
      method: 'POST', body: form,
      headers: { Authorization: 'Basic ' + btoa(env.TWILIO_SID + ':' + env.TWILIO_TOKEN), 'Content-Type': 'application/x-www-form-urlencoded' } });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.sid) { sid = j.sid; status = 'calling'; } else status = 'error ' + r.status + ' ' + String(j.message || '').slice(0, 80);
  } catch (e) { status = 'error ' + String(e.message).slice(0, 80); }
  await DB.prepare('INSERT INTO phone_calls (sid, area, pref, city, tel, reason, ref, at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(sid, q.area, q.pref, q.city, q.tel, q.reason, q.ref, now.toISOString(), status).run();
  return { sid, status, area: q.area };
}

// 漢数字の時刻（十六時四十分）を算用数字に
function kanjiTime(s) {
  const K = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const num = t => { if (/^\d+$/.test(t)) return +t; let n = 0, cur = 0; for (const c of t) { if (c === '十') { n += (cur || 1) * 10; cur = 0; } else cur = K[c] ?? 0; } return n + cur; };
  return String(s).replace(/([〇零一二三四五六七八九十\d]+)時([〇零一二三四五六七八九十\d]+)?分?/g, (m, h, mi) => num(h) + '時' + (mi ? num(mi) + '分' : ''))
    .replace(/([〇零一二三四五六七八九十]+)丁目/g, (m, t) => num(t) + '丁目');
}
// 文字起こしから火災を取り出す（「発生していません」だけなら空）
export function parsePhone(text, { pref, city, at, source }) {
  const t = kanjiTime(String(text || '').replace(/[\s　]+/g, ''));
  const jst = new Date(new Date(at).getTime() + 9 * 3600e3);
  const md = `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`;
  const hm = `${jst.getUTCHours()}時${String(jst.getUTCMinutes()).padStart(2, '0')}分`;
  const out = [];
  for (const s of t.split(/[。！？]/)) {
    if (!fireKind(s) || /ありません|いません|ございません|なし$/.test(s)) continue;
    // 時刻がなければ電話した時刻で（日付は当日）。消防の発表ページと同じ読み取りに渡す
    const line = (/\d{1,2}時\d{1,2}分/.test(s) ? (/\d{1,2}月\d{1,2}日/.test(s) ? '' : md) : md + hm + '頃、') + s.replace(/^(ただいま|現在|本日)[、,]?/, '');
    const city0 = /^(.+?市).+区$/.test(city) ? null : city;
    const src = { id: source, name: source, pref, type: 'sentence', ...(city0 ? { city: city0 } : { wardCity: city.match(/^(.+?市)/)[1] }) };
    for (const x of parseSource(`<p>${line.replace(/</g, '')}</p>`, src, new Date(at), { hours: 24 })) out.push({ ...x, source });
  }
  const seen = new Set();
  return out.filter(x => { const k = `${x.city}|${x.town}|${x.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Twilio から「録音ができた」知らせ → 文字起こし → 取り込み → 録音を消す
export async function onRecording(env, form, ingest, now = new Date(), fetcher = fetch) {
  const DB = env.DB; await setupPhone(DB);
  const sid = form.get('CallSid'), rurl = form.get('RecordingUrl'), rsid = form.get('RecordingSid');
  const row = await DB.prepare('SELECT * FROM phone_calls WHERE sid = ?').bind(sid).first();
  if (!row || !rurl) return { error: 'not found' };
  const auth = { Authorization: 'Basic ' + btoa(env.TWILIO_SID + ':' + env.TWILIO_TOKEN) };
  let text = '', items = [], added = 0, status = 'ok';
  try {
    const r = await fetcher(rurl + '.mp3', { headers: auth });
    if (!r.ok) throw new Error('録音を取得できない ' + r.status);
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    const res = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: btoa(bin), language: 'ja' });
    text = String((res && res.text) || '').trim();
    items = parsePhone(text, { pref: row.pref, city: row.city, at: row.at, source: 'tel-' + row.pref + row.city });
    added = items.length ? await ingest(env, items, now) : 0;
  } catch (e) { status = 'error ' + String(e.message).slice(0, 80); }
  // 録音は残さない
  if (rsid) { try { await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Recordings/${rsid}.json`, { method: 'DELETE', headers: auth }); } catch (e) {} }
  await DB.prepare('UPDATE phone_calls SET status = ?, text = ?, found = ? WHERE sid = ?').bind(status, text.slice(0, 1000), items.length, sid).run();
  // 案内が短すぎる（つながらない・番号が変わった）ことが2回続いたら、その番号は7日休む
  if (text.length < 15) {
    const prev = await DB.prepare('SELECT text FROM phone_calls WHERE tel = ? AND sid <> ? ORDER BY at DESC LIMIT 1').bind(row.tel, sid).first();
    if (prev && String(prev.text || '').length < 15) await meta(DB, 'phone_rest:' + row.tel, new Date(now.getTime() + 7 * 864e5).toISOString());
  }
  return { sid, status, found: items.length, added };
}

// 通話の結果（話し中・応答なしなど）。録音がない終わり方のときだけ記録する
export async function onCallStatus(env, form) {
  const DB = env.DB; await setupPhone(DB);
  const st = form.get('CallStatus'), sid = form.get('CallSid');
  if (/busy|no-answer|failed|canceled/.test(st || '')) {
    await DB.prepare("UPDATE phone_calls SET status = ?, text = COALESCE(text, '') WHERE sid = ?").bind(st, sid).run();
    // つながらないことが2回続いたら、その番号は7日休む
    const row = await DB.prepare('SELECT tel FROM phone_calls WHERE sid = ?').bind(sid).first();
    if (row) {
      const { results } = await DB.prepare('SELECT status FROM phone_calls WHERE tel = ? ORDER BY at DESC LIMIT 2').bind(row.tel).all();
      if (results.length === 2 && results.every(r => /busy|no-answer|failed|error/.test(r.status || ''))) await meta(DB, 'phone_rest:' + row.tel, new Date(Date.now() + 7 * 864e5).toISOString());
    }
  }
  return { sid, st };
}

// 確認用: 最近の電話（番号・きっかけ・文字起こし・見つかった件数）
export async function phoneLog(env, limit = 30) {
  try { return (await env.DB.prepare('SELECT area, tel, reason, at, status, text, found FROM phone_calls ORDER BY at DESC LIMIT ?').bind(limit).all()).results; }
  catch (e) { return []; }
}
