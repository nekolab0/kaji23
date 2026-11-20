// 調査用: 指定したページを読み、本文の行（火災・日付を含むもの）とリンクを控える（読み取り方を作るための下調べ）
// 入力: verify/probe_pages_in.json（URLの配列）、出力: verify/probe_pages.json
import fs from 'node:fs';
import { htmlText, robotsAllows, parseSource } from '../worker/src/official.js';
import { decode } from './fetchutil.mjs';
const UA = 'kaji23-bot/1.0 (+https://kajisoku.jp/about.html; fire dispatch info by town)';
const urls = JSON.parse(fs.readFileSync(new URL('../verify/probe_pages_in.json', import.meta.url), 'utf8'));
const out = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const it of urls) {
  const u = typeof it === 'string' ? it : it.url;
  const o = { url: u };
  try {
    const origin = new URL(u).origin;
    let rb = ''; try { const r = await fetch(origin + '/robots.txt', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }); rb = r.ok ? await r.text() : ''; } catch (e) {}
    if (!robotsAllows(rb, u)) { o.status = 'robots'; out.push(o); continue; }
    const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    o.status = r.status; o.final = r.url;
    const html = decode(await r.arrayBuffer(), r.headers.get('content-type'));
    o.size = html.length;
    const lines = htmlText(html);
    o.lines = lines.filter(l => /火災|火事|出動|鎮火|\d{1,2}[月/]\d{1,2}|\d{1,2}[時:]\d{2}/.test(l)).slice(0, 60).map(l => l.slice(0, 160));
    o.links = [...html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => [m[1], m[2].replace(/<[^>]+>/g, '').trim().slice(0, 50)])
      .filter(([h, t]) => /火災|出動|災害|速報|info|saigai|kasai|fire|list/i.test(h + t)).slice(0, 40);
    o.tables = (html.match(/<table[\s\S]*?<\/table>/gi) || []).slice(0, 2).map(t => t.replace(/\s+/g, ' ').slice(0, 1500));
    try { o.parsed = parseSource(html, { id: 'p', name: 'p', url: u, pref: '', type: 'sentence' }, new Date(), { hours: 24 * 31 }).length; } catch (e) { o.parsed = 'err'; }
    if (typeof it === 'object') { try { const r2 = parseSource(html, { name: 'p', ...it }, new Date(), { hours: 24 * 31 }); o.parsedOwn = r2.length; o.parsedOwnItems = r2.slice(0, 5); } catch (e) { o.parsedOwn = 'err ' + String(e.message).slice(0, 80); } }
    o.articles = (html.match(/<article\b/gi) || []).length;
    const ai = html.search(/<article\b/i); o.head = html.slice(ai >= 0 ? ai : Math.max(0, html.search(/<body/i)), (ai >= 0 ? ai : Math.max(0, html.search(/<body/i))) + 3000);
  } catch (e) { o.status = 'error ' + String(e.message).slice(0, 60); }
  out.push(o); await sleep(1500);
}
fs.writeFileSync(new URL('../verify/probe_pages.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out.map(o => `${o.status} ${o.url} lines=${(o.lines || []).length}`).join('\n'));
