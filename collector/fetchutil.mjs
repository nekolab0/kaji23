// 公式ページ・CSVの文字コードを判定して文字列にする（Shift_JIS のページが多い）
export function decode(buf, ctype = '') {
  let html = new TextDecoder('utf-8').decode(buf);
  const cs = ((html.slice(0, 3000).match(/charset=["']?([\w-]+)/i) || [])[1] || (ctype || '').split('charset=')[1] || 'utf-8').trim().toLowerCase();
  if (!/utf-?8/.test(cs)) { try { html = new TextDecoder(cs.replace('shift-jis', 'shift_jis').replace('x-sjis', 'shift_jis')).decode(buf); } catch (e) {} }
  else if ((html.match(/�/g) || []).length > 20) { try { html = new TextDecoder('shift_jis').decode(buf); } catch (e) {} }
  return html;
}
