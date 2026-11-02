// D1 を Node の組み込み SQLite で代用して、受付サーバーの動作を確認する
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { handle, cleanTown, baseTown, checkBody } from './src/index.js';
export function makeEnv() {
  const db = new DatabaseSync(':memory:');
  const D1 = { prepare: sql => { const st = db.prepare(sql); let args = []; const o = {
    bind: (...a) => { args = a; return o; }, first: async () => st.get(...args),
    run: async () => { const r = st.run(...args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
    all: async () => ({ results: st.all(...args) }) }; return o; } };
  return { env: { DB: D1, ALLOW_ORIGIN: 'https://example.jp', SITE_URL: 'https://example.jp/kaji23' }, db };
}
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { env, db } = makeEnv();
  const req = (method, path, body, ip = '1.2.3.4') => new Request('https://w.example' + path, { method, body: body && JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip } });
  const results = []; const ok = (name, cond, detail = '') => results.push({ name, ok: !!cond, detail: String(detail) });
  const t0 = new Date('2026-11-02T10:00:00Z'); const at = min => new Date(+t0 + min * 60e3);
  const J = async r => r.json();

  ok('町名の整形（漢数字・番地）', cleanTown('赤羽西二丁目3番地') === '赤羽西2丁目' && cleanTown('白金１丁目5-3') === '白金1丁目' && baseTown('赤羽西2丁目') === '赤羽西', cleanTown('赤羽西二丁目3番地'));
  // 報告 → 火事にまとまる
  let r = await handle(req('POST', '/api/report', { ward: '北区', town: '赤羽西2丁目', kind: 'siren' }), env, t0); const a = await J(r);
  ok('報告を受け付けて火事IDを返す', r.status === 200 && a.incident, JSON.stringify(a));
  r = await handle(req('POST', '/api/report', { ward: '北区', town: '赤羽西3丁目', kind: 'smoke' }, '2.2.2.2'), env, at(5)); const b = await J(r);
  ok('同じ町・2時間以内は同じ火事', b.incident === a.incident, `${a.incident} / ${b.incident}`);
  r = await handle(req('POST', '/api/report', { ward: '北区', kind: 'fire' }, '3.3.3.3'), env, at(8)); const c = await J(r);
  ok('町名なしの報告は区内の直近の火事へ', c.incident === a.incident);
  r = await handle(req('POST', '/api/report', { ward: '北区', town: '王子', kind: 'siren' }, '4.4.4.4'), env, at(9)); const d = await J(r);
  ok('別の町は別の火事', d.incident && d.incident !== a.incident);
  r = await handle(req('POST', '/api/report', { ward: '北区', town: '赤羽西', kind: 'siren' }, '5.5.5.5'), env, at(200)); const e = await J(r);
  ok('2時間以上あくと別の火事', e.incident && e.incident !== a.incident);
  r = await handle(req('POST', '/api/report', { ward: '北区', town: '赤羽西', kind: 'smoke' }), env, at(1));
  ok('同じ人・同じ区は10分以内なら断る', r.status === 429, r.status);
  r = await handle(req('POST', '/api/report', { ward: '大阪市北区', kind: 'siren' }), env, t0);
  ok('23区以外の区名は断る', r.status === 400);
  r = await handle(req('POST', '/api/report', { ward: '港区', kind: 'explosion' }), env, t0);
  ok('決められた種類以外は断る', r.status === 400);
  r = await handle(req('POST', '/api/report', { ward: '港区', town: '<script>', kind: 'siren' }, '9.9.9.9'), env, t0);
  ok('町名にタグなどは入れられない', r.status === 400);
  ok('IPアドレスをそのまま保存しない', db.prepare("SELECT COUNT(*) n FROM reports WHERE who LIKE '%1.2.3.4%'").get().n === 0);

  // 口コミ
  r = await handle(req('POST', '/api/comment', { inc: a.incident, body: '黒い煙が見えます。消防車5台くらい。119番は通報済み' }), env, at(10));
  const c1 = await J(r);
  ok('火事への口コミを受け付ける', r.status === 200 && c1.id, JSON.stringify(c1));
  r = await handle(req('POST', '/api/comment', { inc: a.incident, body: 'もう一件' }), env, at(10.5));
  ok('口コミは1分に1回まで', r.status === 429, r.status);
  const bad = [['https://example.com 見て', 'URL'], ['03-1234-5678に連絡', '電話'], ['赤羽西2-3-4の家', '番地'], ['3番地の家', '番地'], ['死ね', 'NG'], ['', '空']];
  const badRes = []; for (const [t] of bad) { const x = await handle(req('POST', '/api/comment', { ward: '北区', town: '赤羽西', body: t }, '7.7.7.' + badRes.length), env, at(20)); badRes.push(x.status); }
  ok('URL・電話番号・番地・中傷・空の口コミは断る', badRes.every(s => s === 400), badRes.join(','));
  ok('「119番」は番地とみなさない', checkBody('119番しました')[0] === '119番しました');
  r = await handle(req('POST', '/api/comment', { ward: '北区', town: '赤羽西1丁目', body: '先週も夜中にサイレンが続いていました' }, '8.8.8.8'), env, at(30));
  const c2 = await J(r);
  ok('町の掲示板への口コミ', r.status === 200 && c2.id);

  // 取得
  r = await handle(req('GET', '/api/incident?id=' + a.incident), env, at(31)); const inc = await J(r);
  ok('火事1件の件数と口コミ', inc.incident.counts.total === 3 && inc.incident.counts.siren === 1 && inc.incident.counts.smoke === 1 && inc.incident.counts.fire === 1 && inc.comments.length === 1 && inc.incident.town === '赤羽西2丁目', JSON.stringify(inc.incident));
  r = await handle(req('GET', '/api/live?hours=6'), env, at(210)); const live = await J(r);
  const la = live.incidents.find(x => x.id === a.incident);
  ok('いまの火事の一覧（新しい順・最新口コミ付き）', live.incidents.length === 3 && live.incidents[0].id === e.incident && la && la.latest.length === 1, live.incidents.map(x => x.id).join(','));
  r = await handle(req('GET', '/api/live?hours=1'), env, at(600)); 
  ok('時間の範囲外は出さない', (await J(r)).incidents.length === 0);
  r = await handle(req('GET', '/api/town?ward=北区&town=赤羽西'), env, at(300)); const town = await J(r);
  ok('町ページ: その町の火事と掲示板', town.incidents.length === 2 && town.comments.length === 2, `火事${town.incidents.length} 口コミ${town.comments.length}`);
  r = await handle(req('GET', '/api/town?ward=北区&town=赤羽'), env, at(300)); const akabane = await J(r);
  ok('「赤羽」と「赤羽西」を混同しない', akabane.incidents.length === 0 && akabane.comments.length === 0);

  // 通報で非表示
  for (const ip of ['a', 'b', 'b', 'c']) await handle(req('POST', '/api/flag', { id: c1.id }, ip), env, at(40));
  r = await handle(req('GET', '/api/incident?id=' + a.incident), env, at(41));
  ok('3人の通報で非表示（同じ人の重複は数えない）', (await J(r)).comments.length === 0 && db.prepare('SELECT flags FROM comments WHERE id=?').get(c1.id).flags === 3);

  // 共有ページ
  r = await handle(req('GET', '/f/' + a.incident), env, at(42)); const html = await r.text();
  ok('共有ページに場所と件数の見出し', /北区赤羽西2丁目付近で火事の目撃情報 3件/.test(html) && /og:title/.test(html) && html.includes('https://example.jp/kaji23/fire.html?id=' + a.incident), html.match(/<title>.*?<\/title>/)[0]);
  ok('共有ページの見出しに投稿文を入れない（中身はエスケープ）', !/<script>alert/.test(html));
  r = await handle(req('GET', '/api/reports?hours=24'), env, at(42)); const old = await J(r);
  ok('旧形式の集計も動く', old.wards['北区'].total === 5);
  ok('他サイトからの読み込み許可（CORS）', r.headers.get('Access-Control-Allow-Origin') === 'https://example.jp');
  r = await handle(req('POST', '/api/contact', { body: '赤羽西の口コミを削除してください' }), env, at(50));
  ok('削除依頼を受け付けて保存', r.status === 200 && db.prepare('SELECT COUNT(*) n FROM contact').get().n === 1);
  const salt = db.prepare("SELECT v FROM meta WHERE k='salt'").get();
  ok('表と塩を自動で用意（塩はランダム48桁）', salt && /^[0-9a-f]{48}$/.test(salt.v));

  results.forEach(x => console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.detail !== '' ? ' — ' + x.detail : ''}`));
  fs.mkdirSync(new URL('../verify/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('../verify/worker.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), results }));
  process.exit(results.some(x => !x.ok) ? 1 : 0);
}
