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
ok('種別: 自動火災報知設備は火災にしない', fireKind('自動火災報知設備鳴動のため出動') === null && fireKind('●車両火災出動') === '車両火災');
ok('町名: 番地は捨てる', townPart('赤羽西2丁目3番地付近') === '赤羽西2丁目' && townPart('浮羽町三春付近の枯草火災') === '浮羽町三春');
ok('robots.txt: 禁止なら読まない', robotsAllows('User-agent: *\nDisallow: /', 'http://x.jp/a.html') === false && robotsAllows('User-agent: *\nDisallow: /admin/', 'http://x.jp/saigai/a.html') === true && robotsAllows('', 'http://x.jp/') === true);
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
process.exit(results.some(r => !r.ok) ? 1 : 0);
