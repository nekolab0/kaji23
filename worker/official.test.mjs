// 消防の出動情報の読み取りテスト（実際のページの書式をまねた見本）
import { parseSource, SOURCES, fireKind, townPart, robotsAllows } from './src/official.js';
const now = new Date('2026-11-03T00:00:00Z'); // 日本時間 11/3 9:00
const src = id => SOURCES.find(s => s.id === id);
const results = []; const ok = (n, c, d = '') => results.push({ name: n, ok: !!c, detail: String(d) });
const sapporo = `<h2>現在の災害出動</h2>〇札幌市<BR>\r\n　　●火災出動<BR>\r\n　　　・中央区南6条西23丁目（08時40分）<BR>\r\n<BR>\r\n〇江別市<BR>\r\n　　現在出動中の災害はありません<BR>\r\n<h2>現在の救急出動</h2>〇札幌市<BR>
<h2>過去の災害出動</h2>\r\n<TABLE>\r\n<TR>\r\n<TD WIDTH=350 ALIGN=CENTER>\r\n<FONTSIZE=+1>本日（03日）\r\n</TD>\r\n<TD WIDTH=350 ALIGN=CENTER>\r\n<FONTSIZE=+1>昨日（02日）\r\n</TD>\r\n</TR>
<TR>\r\n<TD ALIGN=LEFT COLSPAN=2>\r\n<FONTSIZE=+1>〇札幌市\r\n</TD>\r\n</TR>\r\n<TR>\r\n<TD ALIGN=LEFT VALIGN=TOP>\r\n●救助出動<BR>\r\n・東区北43条東3丁目（03時51分）<BR>\r\n</TD><TD ALIGN=LEFT VALIGN=TOP>●火災出動<BR>\r\n・北区北32条西7丁目（22時46分）<BR>\r\n・西区山の手4条10丁目（09時47分）<BR>\r\n●車両火災出動<BR>\r\n・南区澄川6条4丁目（06時54分）<BR>\r\n●警戒出動<BR>\r\n・豊平区豊平8条11丁目（22時59分）<BR>\r\n</TD></TR>
<TR>\r\n<TD ALIGN=LEFT COLSPAN=2>\r\n<FONTSIZE=+1>〇千歳市\r\n</TD>\r\n</TR>\r\n<TR>\r\n<TD ALIGN=LEFT VALIGN=TOP>●建物火災出動<BR>\r\n・北栄2丁目（01時10分）<BR>\r\n</TD><TD>\r\n</TD></TR></TABLE>`;
const s = parseSource(sapporo, src('sapporo'), now);
const f = k => s.find(x => x.town === k);
ok('札幌: 現在の火災出動', f('南6条西23丁目') && f('南6条西23丁目').city === '札幌市中央区' && f('南6条西23丁目').at === '2026-11-02T23:40:00.000Z', JSON.stringify(f('南6条西23丁目')));
ok('札幌: 昨日の火災・車両火災', f('北32条西7丁目') && f('北32条西7丁目').at === '2026-11-02T13:46:00.000Z' && f('澄川6条4丁目') && f('澄川6条4丁目').kind === '車両火災', JSON.stringify(s.map(x => x.town)));
ok('札幌: 救助・警戒は捨てる', !f('北43条東3丁目') && !f('豊平8条11丁目'));
ok('札幌: 千歳市（区のない市）', f('北栄2丁目') && f('北栄2丁目').city === '千歳市' && f('北栄2丁目').kind === '建物火災');
ok('札幌: 48時間より古い「西区山の手」は昨日9:47なので残る', f('山の手4条10丁目'));
const kyoto = '<p>2026年11月3日 (8時56分現在)</p><p>【火災】</p><p>11月3日8時16分頃、右京区太秦中筋町付近の火災に、消防隊等が出動しています。</p><p>11月3日7時00分頃、左京区北白川の災害に、消防隊等が出動しています。</p>';
const k = parseSource(kyoto, src('kyoto'), now);
ok('京都: 区だけの表記を京都市○○区に', k.length === 1 && k[0].city === '京都市右京区' && k[0].town === '太秦中筋町' && k[0].status === '出動', JSON.stringify(k));
const okayama = '<li>11月03日　02:31入電　岡山市北区辰巳地内、目標御南中学校口交差点　東　４３０メートル付近で、建物火災のため消防車が出動しています。</li><li>11月03日　02:29入電　岡山市南区妹尾地内、目標南ノ町踏切　北　１１９メートル付近で、救急支援のため消防車が出動しています。</li>';
const o = parseSource(okayama, src('okayama'), now);
ok('岡山: 目標物・距離は捨て、町名まで', o.length === 1 && o[0].city === '岡山市北区' && o[0].town === '辰巳' && o[0].kind === '建物火災', JSON.stringify(o));
const chikugo = '<p>11/02 14:20出動のうきは市浮羽町三春付近の枯草火災は、鎮火しました。</p><p>11/02 15:00出動の久留米市城南町付近の救急支援出動は終了しました。</p>';
const c = parseSource(chikugo, src('chikugo-kurume'), now);
ok('筑後: 広域でも市町名で振り分け・鎮火', c.length === 1 && c[0].city === 'うきは市' && c[0].town === '浮羽町三春' && c[0].kind === '枯草火災' && c[0].status === '鎮火', JSON.stringify(c));
const sendai = '<li>青葉区愛子東五丁目で救急活動支援のため消防車が出場しています</li><li>太白区八木山香澄町付近で建物火災のため消防車が出場しています</li>';
const sd = parseSource(sendai, src('sendai'), now), sd2 = parseSource(sendai, src('sendai'), new Date(+now + 600e3));
ok('仙台: 時刻のない「出場中」ページは見つけた時刻で、同じ発表は同じキー', sd.length === 1 && sd[0].city === '仙台市太白区' && sd[0].town === '八木山香澄町' && sd[0].kind === '建物火災' && sd[0].key && sd[0].key === sd2[0].key, JSON.stringify(sd));
ok('種別: 自動火災報知設備は火災にしない', fireKind('自動火災報知設備鳴動のため出動') === null && fireKind('●車両火災出動') === '車両火災');
ok('町名: 番地は捨てる', townPart('赤羽西2丁目3番地付近') === '赤羽西2丁目' && townPart('浮羽町三春付近の枯草火災') === '浮羽町三春');
ok('robots.txt: 禁止なら読まない', robotsAllows('User-agent: *\nDisallow: /', 'http://x.jp/a.html') === false && robotsAllows('User-agent: *\nDisallow: /admin/', 'http://x.jp/saigai/a.html') === true && robotsAllows('', 'http://x.jp/') === true);

// ktaiwork（名古屋市など、消防メールのブログ版）: 誤報は捨て、発生と鎮火は同じ火事に
const ktai = { id: 't-nagoya', name: '名古屋市消防局', pref: '愛知県', type: 'sentence', wardCity: '名古屋市' };
const kh = '<h2>火災誤報</h2><p>2026年11月02日16時28分頃、中川区本前田町　地内から火災との通報で消防車が出動しましたが、火災ではありませんでした。</p><h2>火災発生</h2><p>2026年11月02日16時30分頃、中川区本前田町　地内から火災の通報があり消防車が出動しています。</p><h2>火災鎮火</h2><p>2026年11月02日12時38分頃に発生した　天白区八事天道　地内の火災は　2026年11月02日13時14分　に鎮火しました。</p>';
const kt = parseSource(kh, ktai, now);
ok('ktaiwork: 誤報は取り消しの印に、区を名古屋市○○区に', kt.length === 3 && kt.some(x => x.status === '誤報' && x.town === '本前田町' && x.at === '2026-11-02T07:28:00.000Z') && kt.some(x => x.city === '名古屋市中川区' && x.town === '本前田町' && x.status === '出動') && kt.some(x => x.city === '名古屋市天白区' && x.town === '八事天道' && x.status === '鎮火'), JSON.stringify(kt));
// 1つの市だけのページ（市名が書かれない）
const single = { id: 't-nagaoka', name: '長岡市消防本部', pref: '新潟県', type: 'sentence', city: '長岡市' };
const sg = parseSource('<p>11月02日 16:17 今朝白一丁目付近で建物火災が発生し、消防車が出動しています。</p><p>11月02日 15:00 現在、出動中の災害はありません</p>', single, now);
ok('単独市ページ: 市名がなくても町名を読む', sg.length === 1 && sg[0].city === '長岡市' && sg[0].town === '今朝白一丁目' && sg[0].kind === '建物火災', JSON.stringify(sg));

const nemuro = { id: 't-nemuro', name: '根室市消防本部', pref: '北海道', type: 'sentence', city: '根室市' };
const nm = parseSource('<p>11月02日午後03時48分昭和町4丁目建物火災のため消防車が出動しました。</p><p>11月02日午前00時30分珸瑤瑁1丁目林野火災のため消防車が出動しました。</p><p>住宅用火災警報器を設置しましょう</p>', nemuro, now);
ok('午前・午後の時刻、町名の直後に「建物火災」', nm.length === 2 && nm.some(x => x.town === '昭和町4丁目' && x.kind === '建物火災' && x.at === '2026-11-02T06:48:00.000Z') && nm.some(x => x.town === '珸瑤瑁1丁目' && x.kind === '林野火災' && x.at === '2026-11-01T15:30:00.000Z'), JSON.stringify(nm));
const ichikawa = { id: 't-ichikawa', name: '市川市消防局', pref: '千葉県', type: 'sentence', city: '市川市' };
const ic = parseSource('<p>11月2日午後8時6分頃市川市南大野2丁目4番付近で発生した、中高層建物火災は、鎮火いたしました。</p>', ichikawa, now);
ok('市名つき・番地は捨てる・中高層建物火災', ic.length === 1 && ic[0].town === '南大野2丁目' && ic[0].kind === '建物火災' && ic[0].status === '鎮火', JSON.stringify(ic));
ok('お知らせ・警報器・件数は火災にしない', fireKind('住宅用火災警報器を設置しましょう') === null && fireKind('火災件数（速報値）11月01日現在') === null && fireKind('現在、火災等の災害は発生していません。') === null);

// WordPress（本文に日付がない）: 投稿日＋本文の覚知時刻
const wp1 = { id: 't-joetsu', name: '上越市', pref: '新潟県', type: 'wp', city: '上越市' };
const wh = `<article id="post-1"><h2>火災誤報連絡</h2><time datetime="2026-11-02T06:10:00+09:00">2026年11月2日 06:10</time><p>上越南消防署</p><p>覚知 05時58分</p><p>上越市寺町3丁目6-37付近の福祉建物火災は、火災ではありませんでした。</p></article>
<article id="post-2"><h2>火災発生連絡</h2><time datetime="2026-11-02T05:58:00+09:00">2026年11月2日 05:58</time><p>上越南消防署</p><p>覚知 05時58分</p><p>上越市寺町3丁目6-37付近で福祉建物火災が発生しました。</p></article>
<article id="post-3"><h2>災害情報</h2><time datetime="2026-11-02T15:12:00+09:00">2026年11月2日 15:12</time><p>ただいま、会津美里町吉田字村中乙地内の、その他火災のため消防車が出動しています。</p></article>`;
const wj = parseSource(wh.split('<article id="post-3">')[0], wp1, now), wa = parseSource(wh, { id: 't-aizu', name: '会津', pref: '福島県', type: 'wp' }, now);
ok('WordPress: 投稿日＋覚知時刻、誤報は取り消しの印', wj.length === 2 && wj.some(x => x.town === '寺町3丁目' && x.kind === '建物火災' && x.at === '2026-11-01T20:58:00.000Z' && x.status !== '誤報') && wj.some(x => x.status === '誤報' && x.at === '2026-11-01T20:58:00.000Z'), JSON.stringify(wj));
ok('WordPress: 「ただいま、○○町…地内の」', wa.some(x => x.city === '会津美里町' && x.town === '吉田字村中乙' && x.kind === 'その他火災' && x.at === '2026-11-02T06:12:00.000Z'), JSON.stringify(wa));
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
process.exit(results.some(r => !r.ok) ? 1 : 0);
