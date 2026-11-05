// D1 を Node の組み込み SQLite で代用して、受付サーバーの動作を確認する
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { handle, cleanTown, baseTown, checkBody, pollSources } from './src/index.js';
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

  ok('町名の整形（札幌の条は漢数字にそろえる）', cleanTown('北32条西7丁目') === '北三十二条西7丁目' && baseTown('二十四軒1条') === '二十四軒一条' && cleanTown('本町5号') === '本町');
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
  ok('都道府県なしで23区以外の名前は断る', r.status === 400);
  r = await handle(req('POST', '/api/report', { pref: '大阪府', city: '大阪市北区', town: '梅田1丁目', kind: 'smoke' }, '11.1.1.1'), env, at(2)); const osaka = await J(r);
  ok('全国: 大阪市北区の報告を受け付ける', r.status === 200 && osaka.incident && osaka.incident !== a.incident, JSON.stringify(osaka));
  r = await handle(req('POST', '/api/report', { pref: '北海道', city: '大阪市北区', kind: 'smoke' }, '11.1.1.2'), env, at(2));
  ok('全国: 都道府県と合わない市区町村は断る', r.status === 400);
  r = await handle(req('POST', '/api/report', { pref: '北海道', city: '泊村（国後郡）', kind: 'siren' }, '11.1.1.3'), env, at(2));
  ok('全国: 同名の村も区別して受け付ける', r.status === 200);
  r = await handle(req('POST', '/api/comment', { pref: '大阪府', city: '大阪市北区', town: '梅田', body: '梅田の方で煙が上がっています' }, '11.1.1.4'), env, at(3)); const oc = await J(r);
  ok('全国: 火事を指定しない口コミは同じ場所の火事に付く', r.status === 200 && oc.inc === osaka.incident, JSON.stringify(oc));
  r = await handle(req('POST', '/api/comment', { pref: '大阪府', city: '堺市堺区', body: '堺でもサイレンが聞こえる' }, '11.1.1.5'), env, at(4)); const sc = await J(r);
  ok('全国: 火事のない場所の口コミは掲示板へ', r.status === 200 && sc.inc === null);
  r = await handle(req('GET', '/f/' + osaka.incident), env, at(5));
  ok('全国: 共有ページに都道府県から表示', /大阪府大阪市北区梅田1丁目付近で火事の目撃情報 1件/.test(await r.text()));
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
  const tk = live.incidents.filter(x => x.pref === '東京都');
  ok('いまの火事の一覧（新しい順・最新口コミ付き・全国）', live.incidents.length === 5 && tk.length === 3 && live.incidents[0].id === e.incident && la && la.latest.length === 1, live.incidents.map(x => x.id).join(','));
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
  r = await handle(req('GET', '/api/counts'), env, at(60)); const cnt = (await J(r)).counts;
  ok('場所ごとの件数', cnt['東京都|北区|赤羽西'] === 2 && cnt['大阪府|大阪市北区|梅田'] === 1, JSON.stringify(cnt));
  r = await handle(req('POST', '/api/contact', { body: '赤羽西の口コミを削除してください' }), env, at(50));
  ok('削除依頼を受け付けて保存', r.status === 200 && db.prepare('SELECT COUNT(*) n FROM contact').get().n === 1);
  const salt = db.prepare("SELECT v FROM meta WHERE k='salt'").get();
  // 消防本部の出動情報: robots.txt を守り、火災だけを取り込み、利用者の報告と同じ火事にまとめる
  { const m = makeEnv(); const pnow = new Date('2026-11-03T00:00:00Z');
    // 先に利用者の報告（札幌市北区北32条西で 22:50）
    await handle(req('POST', '/api/report', { pref: '北海道', city: '札幌市北区', town: '北32条西7丁目', kind: 'smoke' }, '21.1.1.1'), m.env, new Date('2026-11-02T13:50:00Z'));
    const pages = {
      'https://www.119.city.sapporo.jp/robots.txt': [404, ''],
      'https://www.119.city.sapporo.jp/saigai/sghp.html': [200, '<h2>現在の災害出動</h2>〇札幌市<BR>　　現在出動中の災害はありません<BR><h2>現在の救急出動</h2><h2>過去の災害出動</h2><TABLE><TR><TD>本日（03日）</TD><TD>昨日（02日）</TD></TR><TR><TD COLSPAN=2>〇札幌市</TD></TR><TR><TD>●救助出動<BR>・東区北43条東3丁目（03時51分）<BR></TD><TD>●火災出動<BR>・北区北32条西7丁目（22時46分）<BR>●車両火災出動<BR>・南区澄川6条4丁目（06時54分）<BR></TD></TR></TABLE>'],
      'https://disif.city.kyoto.lg.jp/robots.txt': [200, 'User-agent: *\nDisallow: /annai/'],
    };
    const fetcher = async (u, opts = {}) => { new Headers(opts.headers || {}); /* 本番の fetch と同じく、見出しは英数字だけ（日本語が入ると読み取りが全部失敗する） */ const p = pages[u] || [404, '']; return new Response(p[1], { status: p[0], headers: { 'Content-Type': 'text/html; charset=utf-8' } }); };
    const rep = await pollSources(m.env, pnow, fetcher, 3);
    const sp = rep.find(r => r.id === 'sapporo'), ky = rep.find(r => r.id === 'kyoto');
    ok('出動情報: 札幌から火災2件（救助は捨てる）', sp && sp.status === 'ok' && sp.items === 2, JSON.stringify(rep));
    ok('出動情報: robots.txt で禁止されたページは読まない', ky && /robots/.test(ky.status), JSON.stringify(ky));
    const merged = m.db.prepare("SELECT * FROM incidents WHERE ward='札幌市北区'").all();
    ok('出動情報: 同じ場所の利用者の報告と同じ火事にまとめる', merged.length === 1 && merged[0].official === 1 && merged[0].n === 1 && merged[0].official_kind === '火災', JSON.stringify(merged));
    const car = m.db.prepare("SELECT * FROM incidents WHERE ward='札幌市南区'").get();
    ok('出動情報: 報告のない場所は新しい火事として作る', car && car.official === 1 && car.n === 0 && car.official_kind === '車両火災');
    await pollSources(m.env, new Date(+pnow + 300e3), fetcher, 3);
    ok('出動情報: 同じ発表を二重に取り込まない', m.db.prepare('SELECT COUNT(*) n FROM official').get().n === 2);
    const inc = await (await handle(req('GET', '/api/incident?id=' + merged[0].id), m.env, pnow)).json();
    ok('出動情報: 火事のページに消防の発表と出典', inc.official.length === 1 && inc.official[0].name.includes('札幌市消防局') && inc.incident.official.kind === '火災', JSON.stringify(inc.official));
    const live = await (await handle(req('GET', '/api/live?hours=48'), m.env, pnow)).json();
    ok('出動情報: いまの火事の一覧に出る', live.incidents.filter(x => x.official).length === 2);
    const srcs = await (await handle(req('GET', '/api/sources'), m.env, pnow)).json();
    ok('出動情報: 読み取り状況を確認できる', srcs.sources.find(x => x.id === 'sapporo').status === 'ok');
    const nf = await handle(req('GET', '/api/incident?id=nothere&soft=1'), m.env, pnow); const nfj = await nf.json();
    ok('固定ページからの問い合わせは、見つからなくても200で incident: null', nf.status === 200 && nfj.incident === null && (await handle(req('GET', '/api/incident?id=nothere'), m.env, pnow)).status === 404);
    const ex = await (await handle(req('GET', '/api/official?days=7'), m.env, pnow)).json();
    ok('出動情報: サイト生成用に発表の記録を出す（町名まで・出典つき）', ex.items.length === 2 && ex.items.every(x => x.pref === '北海道' && x.source_name && x.kind) && ex.items.some(x => x.ward === '札幌市北区' && x.town === '北32条西7丁目'), JSON.stringify(ex.items));
  }
  // 23区だけの頃のデータ（都道府県なし）を東京都として引き継ぐ
  { const m = makeEnv(); const d = m.db;
    d.exec(`CREATE TABLE incidents (id TEXT PRIMARY KEY, ward TEXT NOT NULL, town TEXT, base TEXT, first_at TEXT NOT NULL, last_at TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, siren INTEGER NOT NULL DEFAULT 0, smoke INTEGER NOT NULL DEFAULT 0, fire INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0)`);
    d.exec(`INSERT INTO incidents (id, ward, town, base, first_at, last_at, n, siren) VALUES ('old1','北区','赤羽','赤羽','2026-11-02T09:00:00Z','2026-11-02T09:59:00Z',1,1)`);
    const x = await (await handle(req('POST', '/api/report', { ward: '北区', town: '赤羽', kind: 'smoke' }, '12.1.1.1'), m.env, t0)).json();
    ok('旧データを東京都として引き継ぎ、同じ火事にまとめる', x.incident === 'old1' && d.prepare("SELECT pref FROM incidents WHERE id='old1'").get().pref === '東京都', JSON.stringify(x)); }
  ok('表と塩を自動で用意（塩はランダム48桁）', salt && /^[0-9a-f]{48}$/.test(salt.v));

  results.forEach(x => console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.detail !== '' ? ' — ' + x.detail : ''}`));
  fs.mkdirSync(new URL('../verify/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('../verify/worker.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), results }));
  process.exit(results.some(x => !x.ok) ? 1 : 0);
}
