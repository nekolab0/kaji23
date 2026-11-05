// 火災メールの読み取りテスト（実際の配信の書式をまねた見本）
import { parseMail, decodeHeader, mailText } from './src/mail.js';
const now = new Date('2026-11-04T08:00:00Z');   // 日本時間 17:00
const results = []; const ok = (n, c, d = '') => results.push({ name: n, ok: !!c, detail: String(d) });
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const mk = (from, subject, body, enc = 'base64') => `From: ${from}\r\nSubject: =?UTF-8?B?${b64(subject)}?=\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: ${enc}\r\n\r\n${enc === 'base64' ? b64(body) : Buffer.from(body, 'utf8').toString('latin1')}`;
ok('件名のデコード', decodeHeader(`=?UTF-8?B?${b64('【火災発生】')}?=`) === '【火災発生】');
const a = parseMail(mk('kasai@city.nagoya.lg.jp', '火災発生', '2026年11月04日16時28分頃、中川区本前田町　地内から火災の通報があり消防車が出動しています。'), now);
ok('名古屋市: 送り主から政令市、区だけの書き方を名古屋市○○区に', a.items.length === 1 && a.items[0].city === '名古屋市中川区' && a.items[0].town === '本前田町' && a.items[0].pref === '愛知県', JSON.stringify(a));
const b = parseMail(mk('info@mail.example-bousai.jp', '消防情報', '11月4日 15時10分\n長岡市今朝白一丁目付近で建物火災が発生し、消防車が出動しています。', '8bit'), now);
ok('知らない送り主: 本文の市名（全国で1つだけ）で振り分け・日時と場所が別の行', b.items.length === 1 && b.items[0].pref === '新潟県' && b.items[0].city === '長岡市' && b.items[0].kind === '建物火災', JSON.stringify(b));
const c = parseMail(mk('info@mail.example-bousai.jp', '消防情報', '11月4日 15時10分 府中市宮町付近で建物火災が発生しました。'), now);
ok('同じ名前の市がほかの県にもある（府中市）: 県名がなければ採らない', c.items.length === 0, JSON.stringify(c));
const d = parseMail(mk('info@mail.example-bousai.jp', '救急', '11月4日 15時10分 長岡市今朝白付近で救急出動しています。'), now);
ok('救急は捨てる', d.items.length === 0);
const e = parseMail(mk('kasai@city.nagoya.lg.jp', '火災誤報', '2026年11月04日16時28分頃、中川区本前田町　地内から火災との通報で消防車が出動しましたが、火災ではありませんでした。'), now);
ok('誤報は取り消しの印として渡す', e.items.length === 1 && e.items[0].status === '誤報', JSON.stringify(e));
const sa = parseMail(mk('saitama.city-all@mpme.jp', 'さいたま市消防局　火災情報', '11月4日15時40分\n浦和区常盤6丁目付近で建物火災が発生しました。'), now);
ok('共用の配信サービス（さいたま市）: 区名と丁目から', sa.items.length === 1 && sa.items[0].city === 'さいたま市浦和区' && sa.items[0].town.startsWith('常盤'), JSON.stringify(sa));
const hm = parseMail(mk('info@sg-p.jp', '【浜松市】火災情報', '11月4日15時40分頃、中央区鴨江三丁目付近で建物火災が発生しました。'), now);
ok('「中央区」は本文の市名（浜松）で決める', hm.items.length === 1 && hm.items[0].city === '浜松市中央区', JSON.stringify(hm));
const amb = parseMail(mk('info@sg-p.jp', '火災情報', '11月4日15時40分頃、中央区本町付近で建物火災が発生しました。'), now);
ok('市名がなく「中央区」だけなら採らない', amb.items.length === 0, JSON.stringify(amb));
const tk = parseMail(mk('bousai@city.takasaki.gunma.jp', '火災情報', '11月4日15時40分頃、上並榎町地内で建物火災が発生しました。'), now);
ok('送信元のドメインで市を決める（本文に市名がない：高崎市）', tk.items.length === 1 && tk.items[0].city === '高崎市' && tk.items[0].town.startsWith('上並榎町'), JSON.stringify(tk));
const multi =`From: a@b.jp\r\nSubject: fire\r\nContent-Type: multipart/alternative; boundary="XX"\r\n\r\n--XX\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64('本文です')}\r\n--XX\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>html</p>\r\n--XX--`;
ok('マルチパート: text/plain を使う', mailText(multi).text === '本文です', JSON.stringify(mailText(multi)));
results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
process.exit(results.some(r => !r.ok) ? 1 : 0);
