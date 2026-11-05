// 火事速: 町名検索・現在地・いまの火事・目撃報告（全国）・口コミ・火事のページ・共有
(function () {
  'use strict';
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var meta = $('meta[name="kaji23-api"]');
  var API = meta && meta.content ? meta.content.replace(/\/$/, '') : '';
  var KIND = { siren: 'サイレン', smoke: '煙・におい', fire: '火' };
  var AREAS = window.KAJI_AREAS || { prefs: {}, codes: {} };   // 全国の都道府県・市区町村（assets/areas.js）
  var TOKYO23 = (AREAS.prefs['東京都'] || []).slice(0, 23);
  var KNUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] != null) e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function z2h(s) { return String(s || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }
  function cleanTown(t) {
    var s = z2h(String(t || '').trim()).replace(/\s/g, '');
    s = s.replace(/([一二三四五六七八九十]+)丁目/, function (_, k) { return (k.length === 1 ? KNUM[k] : k === '十' ? 10 : (k[0] === '十' ? 10 + KNUM[k[1]] : k)) + '丁目'; });
    s = s.replace(/(\d+丁目).*$/, '$1').replace(/(\d{1,2})(?=条|線|軒)/g, function (_, d) { return kanjiNum(+d); }).replace(/\d+(番地?|号|-|－|ー).*$/, '');
    return s.slice(0, 20);
  }
  function kanjiNum(n) { var K = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']; return n <= 0 || n > 99 ? String(n) : (n >= 20 ? K[Math.floor(n / 10)] : '') + (n >= 10 ? '十' : '') + K[n % 10]; }
  function baseTown(t) { return cleanTown(t).replace(/\d+丁目$/, '').replace(/\d+$/, ''); }
  function ago(iso) {
    var m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return 'たった今'; if (m < 60) return m + '分前';
    var h = Math.floor(m / 60); if (h < 24) return h + '時間前';
    return Math.floor(h / 24) + '日前';
  }
  function hm(iso) { var t = new Date(iso); return (t.getMonth() + 1) + '/' + t.getDate() + ' ' + t.getHours() + ':' + ('0' + t.getMinutes()).slice(-2); }
  function getJSON(path) {
    return fetch(API + path).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || '読み込めませんでした'); return j; }); });
  }
  function postJSON(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || '送信できませんでした'); return j; }); });
  }
  function msg(e) { return (e && e.message && /[ぁ-んァ-ン一-龥]/.test(e.message)) ? e.message : '通信できませんでした。電波の良いところで、もう一度お試しください。'; }
  function readJSON(id) { var n = document.getElementById(id); try { return n ? JSON.parse(n.textContent) : null; } catch (e) { return null; } }
  function placeOf(x) { return x.place || ((x.pref === '東京都' && TOKYO23.indexOf(x.city || x.ward) >= 0 ? '' : (x.pref || '')) + (x.city || x.ward) + (x.town || '')); }
  function countsText(c) { return ['fire', 'smoke', 'siren'].filter(function (k) { return c[k]; }).map(function (k) { return KIND[k] + ' ' + c[k]; }).join('・'); }
  var TOWN_INDEX = readJSON('town-index') || [];
  var TOWN_FILES = AREAS.towns23 || {};             // 23区の町ページ
  var WARD_FILES = AREAS.tokyo23 || {};             // 23区の区ページ
  function townFile(pref, city, town) { return pref === '東京都' && town ? TOWN_FILES[city + '|' + baseTown(town)] : null; }
  function is23(pref, city) { return pref === '東京都' && !!WARD_FILES[city]; }
  function prefHref(p) { return 'p-' + p + '.html'; }
  // 報道された火事は固定ページ（f-<ID>.html）、目撃報告の火事は fire.html?id=
  function fireHref(id) { return /^n-/.test(id) ? 'f-' + id + '.html' : 'fire.html?id=' + encodeURIComponent(id); }
  function cityHref(p, c) { return is23(p, c) ? WARD_FILES[c] + '.html' : 'c-' + p + '-' + c + '.html'; }
  function townHref(p, c, t) {
    var f = townFile(p, c, t); if (f) return f;
    var code = codeOf(p, c); return code ? 'town.html?c=' + code + '&t=' + encodeURIComponent(baseTown(t)) : cityHref(p, c);
  }
  var CODE_OF = {}; Object.keys(AREAS.codes || {}).forEach(function (k) { CODE_OF[AREAS.codes[k][0] + '|' + AREAS.codes[k][1]] = k; });
  function codeOf(p, c) { return CODE_OF[p + '|' + c]; }
  // 外部の .js データ（ファイルのままでも読めるよう script タグで）
  var loaded = {};
  function loadScript(src) {
    if (!loaded[src]) loaded[src] = new Promise(function (ok, ng) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { delete loaded[src]; ng(new Error('読み込めませんでした')); }; document.head.appendChild(s); });
    return loaded[src];
  }
  var shardWait = {}, shardData = {};
  window.__kajiShard = function (i, list) { shardData[i] = list; if (shardWait[i]) shardWait[i](list); };
  function loadShard(i) { return shardData[i] ? Promise.resolve(shardData[i]) : new Promise(function (ok, ng) { shardWait[i] = ok; loadScript('s/' + i + '.js').catch(ng); }); }
  var townsWait = {}, townsData = {};
  window.__kajiTowns = function (code, list) { townsData[code] = list; if (townsWait[code]) townsWait[code](list); };
  function loadTowns(code) { return townsData[code] ? Promise.resolve(townsData[code]) : new Promise(function (ok, ng) { townsWait[code] = ok; loadScript('t/' + code + '.js').catch(ng); }); }
  function loadNews() { return window.KAJI_NEWS ? Promise.resolve(window.KAJI_NEWS) : loadScript('data/news.js').then(function () { return window.KAJI_NEWS || {}; }, function () { return {}; }); }

  // ---------------- 共有ボタン・コピー ----------------
  function copyText(text, btn) {
    var done = function () { var t = btn.textContent; btn.textContent = 'コピーしました'; setTimeout(function () { btn.textContent = t; }, 1600); };
    try { navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); }); } catch (e) { fallback(text); done(); }
  }
  function fallback(text) {
    var ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
  }
  $$('[data-copy]').forEach(function (b) { b.addEventListener('click', function () { copyText(b.getAttribute('data-copy'), b); }); });
  function shareButtons(box, text, url) {
    box.innerHTML = '';
    var x = el('a', { class: 'btn primary', href: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url), target: '_blank', rel: 'noopener' }, 'Xで知らせる');
    var line = el('a', { class: 'btn', href: 'https://line.me/R/msg/text/?' + encodeURIComponent(text + '\n' + url), target: '_blank', rel: 'noopener' }, 'LINEで送る');
    var cp = el('button', { class: 'btn', type: 'button' }, 'リンクをコピー');
    cp.addEventListener('click', function () { copyText(text + ' ' + url, cp); });
    box.appendChild(x); box.appendChild(line); box.appendChild(cp);
    if (navigator.share) {
      var sh = el('button', { class: 'btn', type: 'button' }, 'その他で共有');
      sh.addEventListener('click', function () { navigator.share({ title: document.title, text: text, url: url }).catch(function () {}); });
      box.appendChild(sh);
    }
  }

  // ---------------- 表の並べ替え ----------------
  $$('table[data-sortable]').forEach(function (table) {
    var ths = table.querySelectorAll('thead th');
    Array.prototype.forEach.call(ths, function (th, idx) {
      var b = th.querySelector('button'); if (!b) return;
      b.addEventListener('click', function () {
        var dir = th.getAttribute('aria-sort') === 'descending' ? 'ascending' : 'descending';
        Array.prototype.forEach.call(ths, function (o) { o.removeAttribute('aria-sort'); });
        th.setAttribute('aria-sort', dir);
        var type = th.getAttribute('data-sort');
        var rows = Array.prototype.slice.call(table.tBodies[0].rows);
        rows.sort(function (a, b) {
          var x = a.cells[idx].getAttribute('data-v'), y = b.cells[idx].getAttribute('data-v');
          if (type === 'num') {
            var xn = x === '' ? null : Number(x), yn = y === '' ? null : Number(y);
            if (xn === null && yn === null) return 0; if (xn === null) return 1; if (yn === null) return -1;
            return dir === 'descending' ? yn - xn : xn - yn;
          }
          return dir === 'descending' ? String(y).localeCompare(String(x), 'ja') : String(x).localeCompare(String(y), 'ja');
        });
        rows.forEach(function (r) { table.tBodies[0].appendChild(r); });
      });
    });
  });

  // ---------------- 現在地 → 区・町（国土地理院の逆ジオコーダ） ----------------
  function locate() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error('この端末では現在地を使えません'));
      navigator.geolocation.getCurrentPosition(function (p) {
        fetch('https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=' + p.coords.latitude + '&lon=' + p.coords.longitude)
          .then(function (r) { return r.json(); })
          .then(function (j) {
            var r = j && j.results; var a = r && AREAS.codes[String(r.muniCd).slice(0, 5)];
            if (!a) return reject(new Error('現在地の市区町村がわかりませんでした'));
            var town = cleanTown(r.lv01Nm || '');
            resolve({ pref: a[0], city: a[1], town: town, base: baseTown(town) });
          }, function () { reject(new Error('現在地の町名を調べられませんでした')); });
      }, function () { reject(new Error('現在地を使う許可がありませんでした')); }, { timeout: 10000, maximumAge: 300000 });
    });
  }

  // ---------------- 町名検索 ----------------
  function norm(s) {
    return z2h(s).replace(/[ァ-ン]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
      .replace(/[\s　]/g, '').replace(/ヶ|ケ|が/g, 'け').replace(/[0-9一二三四五六七八九十]+丁目.*$/, '').replace(/[0-9]+$/, '').toLowerCase();
  }
  $$('[data-search]').forEach(function (box) {
    var input = $('input[type=search]', box), out = $('.q-results', box), count = box.querySelector('[id$="-count"]');
    TOWN_INDEX.forEach(function (t) { t._k = norm(t.t); t._w = norm(t.w); });
    function render() {
      var q = norm(input.value); out.innerHTML = '';
      if (!q) { count.textContent = '町名を入れると候補が出ます。'; return []; }
      var hit = TOWN_INDEX.filter(function (t) { return t._k.indexOf(q) >= 0 || (q.length >= 2 && t._w.indexOf(q) === 0); });
      hit.sort(function (a, b) { return (b._k.indexOf(q) === 0) - (a._k.indexOf(q) === 0) || a._k.length - b._k.length; });
      hit = hit.slice(0, 40);
      count.textContent = hit.length ? hit.length + '件' + (hit.length === 40 ? '（上位40件）' : '') : '見つかりませんでした。丁目や番地を除いた町名で試してください。';
      hit.forEach(function (t) {
        var a = el('a', { class: 'result', href: t.f }); a.appendChild(el('b', null, t.t)); a.appendChild(el('span', { class: 'small muted' }, t.w));
        out.appendChild(a);
      });
      return hit;
    }
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var h = render(); if (h.length) location.href = h[0].f; } });
    try { var p = new URLSearchParams(location.search).get('q'); if (p) input.value = p; } catch (e) {}
    render();
    var geo = $('.geo-go', box);
    if (geo) {
      if (!navigator.geolocation) geo.hidden = true;
      geo.addEventListener('click', function () {
        count.textContent = '現在地を調べています…';
        locate().then(function (r) {
          var f = townFile(r.pref, r.city, r.base);
          if (f) { count.textContent = r.city + r.town + 'のページを開きます'; location.href = f; return; }
          if (r.pref === '東京都' && TOKYO23.indexOf(r.city) >= 0) { input.value = r.base || r.city; render(); count.textContent = r.city + (r.town || '') + '付近：候補から選んでください'; return; }
          // 23区の外: 町のページはまだないので、投稿欄に場所を入れる
          var panel = $('[data-post]'); if (panel && panel._setArea) { panel._setArea(r.pref, r.city, r.town); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
          count.textContent = r.pref + r.city + (r.town || '') + '付近です。町ごとのページは東京23区から順に作っています。下の欄から報告・口コミを送れます。';
        }, function (e) { count.textContent = msg(e); });
      });
    }
  });

  // ---------------- いまの火事 ----------------
  var liveBoxes = [], tiles = [];
  function fireCard(x) {
    var li = el('li', { class: 'fire-card' + (Date.now() - Date.parse(x.last) > 90 * 60000 ? ' calm' : '') });
    var a = el('a', { class: 'place', href: fireHref(x.id) });
    a.appendChild(el('b', null, placeOf(x) + '付近')); li.appendChild(a);
    var row = el('div', { class: 'row' });
    if (x.official) row.appendChild(el('span', { class: 'tag off' }, '消防の発表 ' + (x.official.kind || '火災')));
    if (x.counts.total) row.appendChild(el('span', { class: 'tag warn' }, '報告 ' + x.counts.total + '件'));
    var ct = countsText(x.counts); if (ct) row.appendChild(el('span', { class: 'small muted' }, ct));
    if (x.comments) row.appendChild(el('span', { class: 'tag' }, '口コミ ' + x.comments));
    li.appendChild(row);
    li.appendChild(el('span', { class: 'small muted' }, (x.counts.total ? '最新の報告 ' : '消防の出動 ') + ago(x.last) + '（' + hm(x.last) + '）' + (Date.now() - Date.parse(x.last) > 90 * 60000 ? '・落ち着いている可能性があります' : '')));
    if (x.latest && x.latest[0]) li.appendChild(el('p', { class: 'quote' }, '「' + x.latest[0].body + '」'));
    return li;
  }
  function loadLive() {
    liveBoxes = $$('[data-live]'); tiles = $$('[data-ward-tile]');
    if (!liveBoxes.length && !tiles.length) return;
    if (!API) { liveBoxes.forEach(function (b) { b.innerHTML = ''; b.appendChild(el('p', { class: 'muted small' }, '目撃報告の受付を準備中です。')); }); return; }
    getJSON('/api/live?hours=24').then(function (j) {
      liveBoxes.forEach(function (box) {
        var pf = box.getAttribute('data-pref'), w = box.getAttribute('data-city'), t = box.getAttribute('data-town');
        var list = j.incidents.filter(function (x) { return (!pf || (x.pref || '東京都') === pf) && (!w || x.ward === w) && (!t || (x.town && baseTown(x.town) === t)); });
        box.innerHTML = '';
        if (!list.length) { box.appendChild(el('p', { class: 'muted live-empty' }, box.getAttribute('data-empty'))); }
        else { var ul = el('ul', { class: 'fires' }); list.forEach(function (x) { ul.appendChild(fireCard(x)); }); box.appendChild(ul); }
      });
      tiles.forEach(function (tile) {
        var n = j.incidents.filter(function (x) { return (x.pref || '東京都') === '東京都' && x.ward === tile.getAttribute('data-ward-tile'); }).reduce(function (a, x) { return a + x.counts.total; }, 0);
        $('.tile-n', tile).textContent = n ? '報告' + n : '';
        tile.className = tile.className.replace(/\bh[x1-4]\b/, n ? (n >= 10 ? 'h4' : n >= 5 ? 'h3' : n >= 2 ? 'h2' : 'h1') : 'hx');
      });
      $$('.live-updated').forEach(function (u) { u.textContent = hm(j.generatedAt) + ' 更新'; });
    }).catch(function () {
      liveBoxes.forEach(function (b) { b.innerHTML = ''; b.appendChild(el('p', { class: 'muted small' }, 'いまの報告を読み込めませんでした。少し待ってから再読み込みしてください。')); });
    });
  }
  loadLive(); if ($$('[data-live]').length || $$('[data-ward-tile]').length) setInterval(loadLive, 60000);

  // ---------------- 投稿欄（全国）: 場所＋「ボタンで報告」／「口コミを書く」 ----------------
  function fillCities(sel, pref, city) {
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '' }, pref ? '市区町村を選ぶ' : '先に都道府県を選ぶ'));
    (AREAS.prefs[pref] || []).forEach(function (c) { var o = el('option', null, c); if (c === city) o.selected = true; sel.appendChild(o); });
    sel.disabled = !pref;
  }
  function initPanel(box) {
    var inc = box.getAttribute('data-inc');
    var prefSel = $('[name=pref]', box), citySel = $('[name=city]', box), townIn = $('[name=town]', box);
    var status = $('.post-status', box), quick = $('form.quick', box), text = $('form.text', box);
    var say = function (t, link) { status.innerHTML = ''; status.appendChild(document.createTextNode(t)); if (link) { status.appendChild(document.createTextNode(' ')); status.appendChild(link); } };
    if (!API) { quick.hidden = true; text.hidden = true; var tb = $('.tabs', box); if (tb) tb.hidden = true; var ar = $('.area', box); if (ar) ar.hidden = true;
      say('目撃報告の受付を準備中です。いま出動中の災害は、東京消防庁の災害情報案内（03-3212-2119）で確かめられます。'); return; }
    if (prefSel) {
      fillCities(citySel, prefSel.value, box.getAttribute('data-city'));
      prefSel.addEventListener('change', function () { fillCities(citySel, prefSel.value, ''); });
    }
    box._setArea = function (pref, city, town) {
      if (!prefSel) return; prefSel.value = pref; fillCities(citySel, pref, city); if (townIn) townIn.value = town || '';
    };
    // タブ
    var tabs = $$('[role=tab]', box);
    var show = function (name) {
      tabs.forEach(function (t) { var on = t.getAttribute('data-tab') === name; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; });
      quick.hidden = name !== 'quick'; text.hidden = name !== 'text'; say('');
    };
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { show(t.getAttribute('data-tab')); });
      t.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); n.click(); } });
    });
    // 現在地
    var geo = $('.geo-fill', box);
    if (geo && navigator.geolocation && prefSel) {
      geo.hidden = false;
      geo.addEventListener('click', function () {
        say('現在地を調べています…');
        locate().then(function (r) { box._setArea(r.pref, r.city, r.town); say(r.pref + r.city + (r.town || '') + 'を入れました。'); }, function (e) { say(msg(e)); });
      });
    }
    var area = function () {
      if (inc) return { pref: box.getAttribute('data-pref'), city: box.getAttribute('data-city'), town: box.getAttribute('data-town') || '' };
      var pref = prefSel.value, city = citySel.value;
      if (!pref) { say('都道府県を選んでください。'); return null; }
      if (!city) { say('市区町村を選んでください。'); return null; }
      var town = cleanTown(townIn.value);
      if (town && !/^[぀-ヿ㐀-鿿0-9・ー々ヶ]+$/.test(town)) { say('町名は漢字・かなで入れてください（番地は不要です）。'); return null; }
      return { pref: pref, city: city, town: town };
    };
    var busy = function (f, b) { $$('button', f).forEach(function (x) { x.disabled = b; }); };
    var fireLink = function (id) { return el('a', { href: 'fire.html?id=' + encodeURIComponent(id) }, 'この火事のページを見る・近所に知らせる →'); };
    quick.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var a = area(); if (!a) return;
      var kind = (ev.submitter && ev.submitter.value) || 'siren';
      busy(quick, true); say('送信しています…');
      var rec = { pref: a.pref, city: a.city, kind: kind }; if (a.town) rec.town = a.town;
      postJSON('/api/report', rec).then(function (j) {
        say('報告しました。ありがとうございます。' + (kind === 'fire' ? '火が見える場合は119番への通報もお願いします。' : ''), inc ? null : fireLink(j.incident));
        document.dispatchEvent(new CustomEvent('kaji:posted', { detail: j })); loadLive();
      }, function (e) { say(msg(e)); }).then(function () { busy(quick, false); });
    });
    text.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var a = area(); if (!a) return;
      var ta = $('textarea', text), body = ta.value.trim();
      if (body.length < 2) { say('口コミを入力してください。'); return; }
      busy(text, true); say('送信しています…');
      var rec = { pref: a.pref, city: a.city, body: body }; if (a.town) rec.town = a.town; if (inc) rec.inc = inc;
      postJSON('/api/comment', rec).then(function (j) {
        ta.value = '';
        var link = null;
        if (!inc && j.inc) link = fireLink(j.inc);
        else if (!inc) { var f = townFile(a.pref, a.city, a.town); if (f) link = el('a', { href: f + '#board' }, a.city + baseTown(a.town) + 'の口コミを見る →'); }
        say('口コミを投稿しました。' + (!inc && j.inc ? 'いま報告が上がっている火事のページにも表示されます。' : ''), link);
        document.dispatchEvent(new CustomEvent('kaji:posted', { detail: j }));
      }, function (e) { say(msg(e)); }).then(function () { busy(text, false); });
    });
  }
  $$('[data-post]').forEach(initPanel);

  // ---------------- 口コミの一覧 ----------------
  function initComments(box) {
    var pref = box.getAttribute('data-pref') || '東京都', city = box.getAttribute('data-city'), town = box.getAttribute('data-town'), inc = box.getAttribute('data-inc');
    var list = $('.com-list', box);
    if (!API) { list.innerHTML = ''; list.appendChild(el('li', { class: 'muted small' }, '口コミの受付を準備中です。')); return; }
    function render(items) {
      list.innerHTML = '';
      if (!items.length) { list.appendChild(el('li', { class: 'muted small com-empty' }, 'まだ口コミはありません。気づいたことがあれば、「口コミを書く」から最初の口コミを書いてください。')); return; }
      items.forEach(function (c) {
        var li = el('li', { class: 'com' });
        var head = el('div', { class: 'com-head small muted' });
        head.appendChild(el('span', null, hm(c.at) + '（' + ago(c.at) + '）' + (!inc && c.town && c.town !== town ? '　' + c.town : '')));
        if (!inc && c.inc && !/^n-/.test(c.inc)) head.appendChild(el('a', { href: 'fire.html?id=' + encodeURIComponent(c.inc) }, 'この火事のページ'));
        var flag = el('button', { type: 'button', class: 'flag' }, '通報');
        flag.addEventListener('click', function () {
          flag.disabled = true;
          postJSON('/api/flag', { id: c.id }).then(function () { flag.textContent = '通報しました'; }, function () { flag.disabled = false; flag.textContent = '通報できませんでした'; });
        });
        head.appendChild(flag);
        li.appendChild(head); li.appendChild(el('p', null, c.body));
        list.appendChild(li);
      });
    }
    function load() {
      var p = inc ? getJSON('/api/incident?id=' + encodeURIComponent(inc)).then(function (j) { return j.comments.slice().reverse(); })
                  : getJSON('/api/town?pref=' + encodeURIComponent(pref) + '&city=' + encodeURIComponent(city) + '&town=' + encodeURIComponent(town || '')).then(function (j) { return j.comments; });
      return p.then(render, function () { list.innerHTML = ''; list.appendChild(el('li', { class: 'muted small' }, '口コミを読み込めませんでした。')); });
    }
    load();
    document.addEventListener('kaji:posted', function () { setTimeout(load, 200); });
    box._reload = load;
  }
  $$('[data-comments]').forEach(initComments);

  // ---------------- X の投稿（口コミ・未確認）: 受付サーバーが町名で見つけた投稿を、X の公式の埋め込みで表示 ----------------
  var xLoaded = false;
  function showSNS(anchor, posts) {
    if (!posts || !posts.length || !anchor) return;
    var old = anchor.parentNode.querySelector('.sns-posts');
    if (old && old.getAttribute('data-ids') === posts.map(function (p) { return p.id; }).join()) return;   // 変わっていなければ描き直さない
    if (old) old.remove();
    var box = el('div', { class: 'sns-posts', 'data-ids': posts.map(function (p) { return p.id; }).join() });
    box.appendChild(el('h3', { class: 'sns-h' }, 'Xの投稿（' + posts.length + '件・口コミ・未確認）'));
    box.appendChild(el('p', { class: 'small muted' }, '町名と「火事・煙・サイレン」などの言葉で自動で見つけた投稿です。内容は確かめていません。別の場所や過去の話のこともあります。'));
    posts.slice(0, 6).forEach(function (p) {
      var bq = el('blockquote', { class: 'twitter-tweet', 'data-dnt': 'true', 'data-conversation': 'none', 'data-lang': 'ja' });
      bq.appendChild(el('a', { href: 'https://x.com/i/status/' + encodeURIComponent(p.id), target: '_blank', rel: 'noopener' }, 'X の投稿を開く（' + hm(p.at) + '）'));
      box.appendChild(bq);
    });
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    if (!xLoaded) { xLoaded = true; var sc = document.createElement('script'); sc.async = true; sc.src = 'https://platform.twitter.com/widgets.js'; sc.charset = 'utf-8'; document.body.appendChild(sc); }
    else if (window.twttr && twttr.widgets) twttr.widgets.load(box);
  }
  function loadTownSNS(anchor, pref, city, town, since) {
    if (!API || !town) return;
    getJSON('/api/town?pref=' + encodeURIComponent(pref) + '&city=' + encodeURIComponent(city) + '&town=' + encodeURIComponent(town) + (since ? '&since=' + encodeURIComponent(since) : ''))
      .then(function (j) { showSNS(anchor, j.sns); }, function () {});
  }

  // ---------------- 全国の検索（都道府県・市区町村・町名を1つの欄で。kaji.news と同じ使い方） ----------------
  function kn(s) { return String(s || '').replace(/ヶ|ｹ/g, 'ケ').replace(/\s|　/g, ''); }
  function hira(s) { return String(s || '').replace(/[ァ-ン]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); }); }
  function shardOf(a, b) { return (a.charCodeAt(0) * 31 + b.charCodeAt(0)) % 512; }
  var liveCounts = null;
  function countOf(key) { return ((AREAS.counts || {})[key] || 0) + ((liveCounts || {})[key] || 0); }
  function sumLive(prefix) { var n = 0; Object.keys(liveCounts || {}).forEach(function (k) { if (k === prefix || k.indexOf(prefix + '|') === 0) n += liveCounts[k]; }); return n; }
  function prefCount(p) { return ((AREAS.counts || {})[p] || 0) + sumLive(p); }
  function cityCount(p, c) { return ((AREAS.counts || {})[p + '|' + c] || 0) + sumLive(p + '|' + c); }
  function townCount(p, c, t) { return ((AREAS.counts || {})[p + '|' + c + '|' + t] || 0) + ((liveCounts || {})[p + '|' + c + '|' + t] || 0); }
  function getLiveCounts() {
    if (liveCounts || !API) return Promise.resolve();
    return getJSON('/api/counts').then(function (j) { liveCounts = j.counts || {}; }, function () { liveCounts = {}; });
  }
  function searchAll(q0, scopePref) {
    var q = kn(q0), qh = hira(q), out = [];
    if (!q) return Promise.resolve(out);
    var prefs = Object.keys(AREAS.prefs || {});
    var qPref = prefs.filter(function (p) { return q.indexOf(p) === 0; })[0];        // 「神奈川県横浜市…」のように都道府県から書いたとき
    var qRest = qPref ? q.slice(qPref.length) : q;
    prefs.forEach(function (p) {
      if (scopePref && p !== scopePref) return;
      var short = p === '北海道' ? p : p.replace(/[都府県]$/, '');
      if (!qRest || p.indexOf(q) >= 0 || (q.length >= 2 && short.indexOf(q) === 0) || (AREAS.pkana[p] || '').indexOf(qh) === 0 && qh.length >= 2)
        if (!qPref || qPref === p) out.push({ type: 0, label: p, sub: '', href: prefHref(p), n: prefCount(p) });
    });
    if (qRest) {
      prefs.forEach(function (p) {
        if (scopePref && p !== scopePref) return;
        if (qPref && p !== qPref) return;
        var names = AREAS.prefs[p].slice(); (AREAS.parents[p] || []).forEach(function (x) { names.push(x[0]); });
        names.forEach(function (c) {
          var code = codeOf(p, c), kana = code ? (AREAS.kana[code] || '') : '';
          if (kn(c).indexOf(qRest) >= 0 || (qh.length >= 2 && kana.indexOf(hira(qRest)) === 0))
            out.push({ type: 1, label: c, sub: p, href: cityHref(p, c), n: cityCount(p, c) });
        });
      });
    }
    if (qRest.length < 2) return Promise.resolve(out);
    // 町名: 2文字ずつの索引のうち、いちばん小さいファイルだけを読む
    var best = null;
    for (var i = 0; i < qRest.length - 1; i++) { var k = shardOf(qRest[i], qRest[i + 1]); if (best === null || AREAS.shards[k] < AREAS.shards[best]) best = k; }
    return loadShard(best).then(function (list) {
      var seen = 0;
      for (var j = 0; j < list.length && seen < 400; j++) {
        var e = list[j], ix = e.indexOf(':'), code = e.slice(0, ix), t = e.slice(ix + 1), a = AREAS.codes[code];
        if (!a || (scopePref && a[0] !== scopePref) || (qPref && a[0] !== qPref)) continue;
        if (kn(a[1].replace(/（.*）$/, '') + t).indexOf(qRest) < 0) continue;
        seen++;
        out.push({ type: 2, label: a[1].replace(/（.*）$/, '') + t, sub: a[0], href: townHref(a[0], a[1], t), n: townCount(a[0], a[1], t) });
      }
      return out;
    }, function () { return out; });
  }
  $$('[data-nsearch]').forEach(function (box) {
    var input = $('input', box), list = $('.nq-list', box), status = $('.nq-status', box), cur = -1, items = [], seq = 0, timer = null;
    var scope = box.getAttribute('data-pref') || '';
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); cur = -1; }
    function render(res) {
      res.sort(function (a, b) { return (b.n - a.n) || (a.type - b.type) || (a.label.length - b.label.length); });
      items = res.slice(0, 60); list.innerHTML = '';
      if (!items.length) { list.hidden = false; list.appendChild(el('li', { class: 'nq-empty' }, '見つかりませんでした。丁目や番地を除いた地名で試してください。')); return; }
      items.forEach(function (it, i) {
        var li = el('li', { role: 'option', id: 'nq-o' + i, class: 'nq-item t' + it.type });
        var a = el('a', { href: it.href, tabindex: '-1' });
        var nm = el('span', { class: 'nq-name' }, it.label); if (it.sub) nm.appendChild(el('small', null, ' ' + it.sub));
        a.appendChild(nm); a.appendChild(el('span', { class: 'nq-n' }, it.n ? it.n + '件' : ''));
        li.appendChild(a); list.appendChild(li);
      });
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
    function run() {
      var my = ++seq, q = input.value.trim();
      if (!q) { close(); return; }
      getLiveCounts().then(function () { return searchAll(q, scope); }).then(function (res) { if (my === seq) render(res); });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 120); });
    input.addEventListener('focus', function () { if (input.value.trim()) run(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!items.length) return;
        cur = (cur + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        $$('.nq-item', list).forEach(function (li, i) { li.setAttribute('aria-selected', i === cur ? 'true' : 'false'); });
        input.setAttribute('aria-activedescendant', 'nq-o' + cur);
        var on = $('#nq-o' + cur); if (on) on.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var go = function () { var it = items[cur >= 0 ? cur : 0]; if (it) location.href = it.href; };
        if (!items.length) { getLiveCounts().then(function () { return searchAll(input.value.trim(), scope); }).then(function (r) { render(r); go(); }); } else go();
      } else if (e.key === 'Escape') close();
    });
    document.addEventListener('click', function (e) { if (!box.contains(e.target)) close(); });
    var geo = $('.geo-go', box);
    if (geo) {
      if (!navigator.geolocation) geo.hidden = true;
      geo.addEventListener('click', function () {
        status.textContent = '現在地を調べています…';
        locate().then(function (r) {
          status.textContent = r.pref + r.city + (r.town || '') + 'のページを開きます';
          location.href = r.base ? townHref(r.pref, r.city, r.base) : cityHref(r.pref, r.city);
        }, function (e) { status.textContent = msg(e); });
      });
    }
  });

  // ---------------- 町のページ（23区以外。town.html?c=市区町村コード&t=町名） ----------------
  function panelHTML(uid, title) {
    return '<h3>' + title + '</h3><p class="small muted">同じ場所の近くの人の報告とまとめて「火事のページ」ができ、近所の人と共有できます。消防への通報にはなりません。<strong>火や煙が見えたら119番へ。</strong></p>' +
      '<fieldset class="area"><legend class="sr">場所</legend><label class="small" for="pf-' + uid + '">都道府県</label><select id="pf-' + uid + '" name="pref"><option value="">都道府県を選ぶ</option>' +
      Object.keys(AREAS.prefs).map(function (p) { return '<option>' + p + '</option>'; }).join('') + '</select>' +
      '<label class="small" for="ct-' + uid + '">市区町村</label><select id="ct-' + uid + '" name="city"></select>' +
      '<label class="small" for="tw-' + uid + '">町名（丁目まで・任意）</label><input id="tw-' + uid + '" name="town" maxlength="20" autocomplete="off" placeholder="例：本町2丁目">' +
      '<button type="button" class="btn ghost geo-fill" hidden>現在地の場所を入れる</button></fieldset>' +
      '<div class="tabs" role="tablist" aria-label="送り方"><button type="button" role="tab" id="tq-' + uid + '" aria-controls="pq-' + uid + '" aria-selected="true" data-tab="quick">ボタンで報告</button>' +
      '<button type="button" role="tab" id="tt-' + uid + '" aria-controls="pt-' + uid + '" aria-selected="false" data-tab="text" tabindex="-1">口コミを書く</button></div>' +
      '<form class="quick" id="pq-' + uid + '" role="tabpanel" aria-labelledby="tq-' + uid + '" data-pane="quick"><p class="small muted">いちばん近いものを押すだけで送れます。</p>' +
      '<div class="btn-row kinds"><button type="submit" class="btn" name="kind" value="siren">サイレンが聞こえた</button><button type="submit" class="btn" name="kind" value="smoke">煙・においがする</button><button type="submit" class="btn primary" name="kind" value="fire">火が見える</button></div></form>' +
      '<form class="text" id="pt-' + uid + '" role="tabpanel" aria-labelledby="tt-' + uid + '" data-pane="text" hidden><label class="sr" for="tx-' + uid + '">口コミ</label>' +
      '<textarea id="tx-' + uid + '" name="body" maxlength="200" rows="3" placeholder="例：黒い煙が北の方に見えます。消防車が5台ほど来ています。"></textarea>' +
      '<p class="small muted">見えたこと・聞こえたことを200文字まで。番地や人の名前、原因や被害者についての憶測は書かないでください。<a href="rules.html">投稿のルール</a></p>' +
      '<button class="btn primary" type="submit">口コミを投稿する</button></form><p class="post-status small" aria-live="polite"></p>';
  }
  var tp = $('[data-town-page]');
  if (tp) {
    var prm = new URLSearchParams(location.search), code = prm.get('c') || tp.getAttribute('data-c') || '', tname = baseTown(prm.get('t') || tp.getAttribute('data-t') || '');
    var ar = AREAS.codes[code];
    var T = function (sel, t) { $(sel, tp).textContent = t; };
    if (!ar || !tname) { T('.t-title', 'ページが見つかりません'); T('.t-lead', '地名で探し直してください。'); }
    else {
      var pref = ar[0], city = ar[1];
      var f23 = townFile(pref, city, tname); if (f23) { location.replace(f23); }
      var place = (is23(pref, city) ? '' : pref) + city + tname;
      document.title = tname + '（' + pref + city + '）の火事どこ？今日のサイレン・火事情報｜火事速';
      T('.t-eyebrow', pref + city + tname + 'の火事情報');
      T('.t-title', tname + '（' + city + '）の火事はどこ？');
      T('.t-lead', place + '付近の目撃報告・口コミと、報道された火事をまとめています。サイレンや煙に気づいたら、ここから近所の人と共有できます。');
      T('.t-now', 'いまの' + tname); T('.t-board', tname + 'の口コミ'); T('.t-newsh', tname + 'で報道された火事');
      var cr = $('.t-crumbs', tp); cr.innerHTML = '';
      [['トップ', 'index.html'], [pref, prefHref(pref)]].concat(WARD_PARENT_OF(pref, city) ? [[WARD_PARENT_OF(pref, city), cityHref(pref, WARD_PARENT_OF(pref, city))]] : [])
        .concat([[WARD_PARENT_OF(pref, city) ? city.slice(WARD_PARENT_OF(pref, city).length) : city, cityHref(pref, city)]]).forEach(function (x) { cr.appendChild(el('a', { href: x[1] }, x[0])); cr.appendChild(document.createTextNode(' ／ ')); });
      cr.appendChild(document.createTextNode(tname));
      $$('.t-sec', tp).forEach(function (s) { s.hidden = false; });
      var lv = el('div', { class: 'live', 'data-live': '', 'data-pref': pref, 'data-city': city, 'data-town': tname, 'data-empty': 'いま、' + tname + 'で上がっている報告はありません。' });
      $('.t-live', tp).appendChild(lv); loadLive();
      var pn = el('div', { class: 'panel post', 'data-post': '', 'data-pref': pref, 'data-city': city, 'data-town': tname });
      pn.innerHTML = panelHTML('tp', tname + 'で気づいたことを知らせる');
      $('.t-post', tp).appendChild(pn); $('[name=pref]', pn).value = pref; $('[name=town]', pn).value = tname; initPanel(pn);
      var cb = el('div', { class: 'comments', 'data-comments': '', 'data-pref': pref, 'data-city': city, 'data-town': tname });
      cb.innerHTML = '<ul class="com-list" aria-live="polite"><li class="muted small">口コミを読み込んでいます…</li></ul>';
      $('.t-comments', tp).appendChild(cb); initComments(cb);
      var q = tname + ' 火事', sns = $('.t-sns', tp);
      [['Xで「' + q + '」を見る', 'https://x.com/search?q=' + encodeURIComponent(q) + '&f=live'], ['Yahoo!リアルタイム検索', 'https://search.yahoo.co.jp/realtime/search?p=' + encodeURIComponent(q)],
       ['ニュースを探す', 'https://news.google.com/search?q=' + encodeURIComponent(city + ' ' + q) + '&hl=ja&gl=JP&ceid=JP:ja']].forEach(function (l) { sns.appendChild(el('a', { class: 'btn', href: l[1], target: '_blank', rel: 'noopener' }, l[0])); });
      loadTownSNS(sns, pref, city, tname);
      loadNews().then(function (N) {
        var box = $('.t-news', tp), ul = el('ul', { class: 'news' }), n = 0;
        Object.keys(N).forEach(function (id) {
          var x = N[id]; if (x.pref !== pref || x.city !== city || !x.town || baseTown(x.town) !== tname) return;
          var li = el('li', { class: 'news-item' }); var a = el('a', { class: 'place', href: fireHref(id) }); a.appendChild(el('b', null, x.city + x.town + (x.chome ? x.chome + '丁目' : '')));
          li.appendChild(a); li.appendChild(el('span', { class: 'small muted' }, '最初の報道 ' + hm(x.first) + '　' + x.sources.map(function (s) { return s.name; }).join('・'))); ul.appendChild(li); n++;
        });
        if (n) box.appendChild(ul); else box.appendChild(el('p', { class: 'muted small' }, '直近30日に、' + tname + 'の火事の報道は見つかっていません。'));
      });
      loadTowns(code).then(function (list) {
        var me = list.filter(function (x) { return x[0] === tname; })[0];
        if (!me) { T('.t-lead', place + 'は町名の一覧にありませんでした。報告や口コミは送れます。'); }
        var grid = $('.t-near', tp);
        var near = list.filter(function (x) { return x[0] !== tname && x[1] != null; });
        if (me && me[1] != null) near.sort(function (a, b) { return Math.hypot(a[1] - me[1], (a[2] - me[2]) * 0.81) - Math.hypot(b[1] - me[1], (b[2] - me[2]) * 0.81); });
        near.slice(0, 24).forEach(function (x) { grid.appendChild(el('a', { href: townHref(pref, city, x[0]) }, x[0])); });
      }, function () {});
    }
  }
  function WARD_PARENT_OF(pref, city) { var r = null; (AREAS.parents[pref] || []).forEach(function (x) { if (x[1].indexOf(city) >= 0) r = x[0]; }); return r; }

  // ---------------- 問い合わせ・削除依頼 ----------------
  var ct = $('.contact-form');
  if (ct) {
    ct.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var st = $('.ct-status', ct), ta = $('textarea', ct);
      if (!API) { st.textContent = '受付を準備中です。'; return; }
      st.textContent = '送信しています…';
      postJSON('/api/contact', { body: ta.value }).then(function () { ta.value = ''; st.textContent = '送信しました。確認して対応します。'; }, function (e) { st.textContent = msg(e); });
    });
  }

  // ---------------- 火事のページ ----------------
  var fire = $('[data-fire]');
  if (fire) {
    var id = ''; try { id = new URLSearchParams(location.search).get('id') || ''; } catch (e) {}
    if (!id) id = fire.getAttribute('data-id') || '';   // 報道された火事の固定ページ（f-*.html）
    var NEWS = {};
    var isNews = /^n-/.test(id);
    var shown = false;
    var stat = function (k, v, d, hot) {
      var s = el('div', { class: 'stat' + (hot ? ' hot' : '') }); s.appendChild(el('span', { class: 'k' }, k));
      var vv = el('span', { class: 'v' }, v); s.appendChild(vv); if (d) s.appendChild(el('span', { class: 'd' }, d)); return s;
    };
    var setText = function (sel, t) { $(sel, fire).textContent = t; };
    // 火事のページの投稿欄（場所はこの火事に固定。ボタンで報告／口コミを書く）
    var makePanel = function (pref, city, town) {
      var r = el('div', { class: 'panel post', 'data-post': '', 'data-inc': id, 'data-pref': pref, 'data-city': city, 'data-town': town || '' });
      r.innerHTML = '<p class="small muted">この火事の場所（<b class="f-place"></b>）に送ります。<strong>火や煙が見えたら119番へ。</strong></p>' +
        '<div class="tabs" role="tablist" aria-label="送り方"><button type="button" role="tab" id="ftq" aria-controls="fpq" aria-selected="true" data-tab="quick">ボタンで報告</button>' +
        '<button type="button" role="tab" id="ftt" aria-controls="fpt" aria-selected="false" data-tab="text" tabindex="-1">口コミを書く</button></div>' +
        '<form class="quick" id="fpq" role="tabpanel" aria-labelledby="ftq" data-pane="quick"><p class="small muted">いちばん近いものを押すだけで送れます。</p>' +
        '<div class="btn-row kinds"><button type="submit" class="btn" name="kind" value="siren">サイレンが聞こえた</button><button type="submit" class="btn" name="kind" value="smoke">煙・においがする</button><button type="submit" class="btn primary" name="kind" value="fire">火が見える</button></div></form>' +
        '<form class="text" id="fpt" role="tabpanel" aria-labelledby="ftt" data-pane="text" hidden><label class="sr" for="f-com">口コミ</label>' +
        '<textarea id="f-com" name="body" maxlength="200" rows="3" placeholder="例：黒い煙が北の方に見えます。消防車が5台ほど来ています。"></textarea>' +
        '<p class="small muted">見えたこと・聞こえたことを200文字まで。番地や人の名前、原因や被害者についての憶測は書かないでください。<a href="rules.html">投稿のルール</a></p>' +
        '<button class="btn primary" type="submit">口コミを投稿する</button></form><p class="post-status small" aria-live="polite"></p>';
      $('.f-place', r).textContent = placeOf({ pref: pref, city: city, town: town });
      return r;
    };
    var setup = function (pref, ward, town, title) {
      if (shown) return; shown = true;
      document.title = title + '｜火事速';
      var crumb = $('.f-crumb');
      if (crumb) {
        crumb.innerHTML = '';
        crumb.appendChild(el('a', { href: prefHref(pref) }, pref)); crumb.appendChild(document.createTextNode(' ／ '));
        if (codeOf(pref, ward) || is23(pref, ward)) { crumb.appendChild(el('a', { href: cityHref(pref, ward) }, ward)); crumb.appendChild(document.createTextNode(' ／ ')); }
        if (town && codeOf(pref, ward)) { crumb.appendChild(el('a', { href: townHref(pref, ward, town) }, baseTown(town))); crumb.appendChild(document.createTextNode(' ／ ')); }
        crumb.appendChild(document.createTextNode('火事のページ'));
      }
      var past = !id && fire.hasAttribute('data-pref');   // さかのぼって記録した過去の火事（報告・口コミは町・市区町村のページで）
      if (past) {
        var pc = $('.f-comments', fire); pc.innerHTML = '';
        var pp = el('p', { class: 'small muted' }, '過去の火事のため、この火事への報告・口コミは受け付けていません。近くで気づいたことは ');
        var pl = el('a', { href: town && codeOf(pref, ward) ? townHref(pref, ward, town) : cityHref(pref, ward) }, (town ? baseTown(town) : ward) + 'のページ');
        pp.appendChild(pl); pp.appendChild(document.createTextNode(' から共有できます。')); pc.appendChild(pp);
      }
      if (!past && API && AREAS.prefs[pref] && AREAS.prefs[pref].indexOf(ward) >= 0) {
        $('.f-rep-sec', fire).hidden = false;
        var r = makePanel(pref, ward, town); $('.f-report', fire).appendChild(r); initPanel(r);
      }
      // 口コミの一覧
      if (past) { /* 上で案内済み */ } else {
      var cb = el('div', { class: 'comments', 'data-comments': '', 'data-pref': pref, 'data-city': ward, 'data-inc': id });
      if (town) cb.setAttribute('data-town', town);
      cb.innerHTML = '<ul class="com-list" aria-live="polite"><li class="muted small">口コミを読み込んでいます…</li></ul>';
      $('.f-comments', fire).appendChild(cb); initComments(cb);
      }
      // SNS
      var q = (town ? baseTown(town) : ward) + ' 火事', sns = $('.f-sns', fire);
      if (fire.hasAttribute('data-pref') && !/^[0-9a-z]{6,}$/i.test(id || '') && town) {   // 報道・過去の火事の固定ページ: その日の町の投稿
        var dd = (document.querySelector('h1.f-title') || {}).textContent || '', mm = dd.match(/（(\d+)月(\d+)日）/);
        var sinceDay = mm ? new Date(new Date().getFullYear(), +mm[1] - 1, +mm[2] - 1) : null;
        if (sinceDay && sinceDay > Date.now()) sinceDay.setFullYear(sinceDay.getFullYear() - 1);
        if (sinceDay && Date.now() - sinceDay < 7 * 864e5) setTimeout(function () { loadTownSNS(sns, pref, ward, baseTown(town), sinceDay.toISOString()); }, 0);
      }
      [['Xで「' + q + '」を見る', 'https://x.com/search?q=' + encodeURIComponent(q) + '&f=live'],
       ['Yahoo!リアルタイム検索', 'https://search.yahoo.co.jp/realtime/search?p=' + encodeURIComponent(q)],
       ['ニュースを探す', 'https://news.google.com/search?q=' + encodeURIComponent(q) + '&hl=ja&gl=JP&ceid=JP:ja']].forEach(function (l) {
        sns.appendChild(el('a', { class: 'btn', href: l[1], target: '_blank', rel: 'noopener' }, l[0]));
      });
      sns.className += ' btn-row';
    };
    var renderUGC = function (j) {
      setTimeout(function () { showSNS($('.f-sns', fire), j.sns); }, 0);
      var x = j.incident, place = placeOf(x), calm = Date.now() - Date.parse(x.last) > 90 * 60000;
      var off = j.official || [], o0 = off[0];
      setText('.f-kind', (x.official ? '消防の発表あり' : '火事の目撃情報') + (calm ? '（落ち着いている可能性）' : ''));
      var fixedU = fire.hasAttribute('data-pref');   // 固定ページ（消防の発表）は見出しをHTMLのまま
      if (!fixedU) setText('.f-title', place + '付近で火事' + (x.official ? '' : '？'));
      setText('.f-lead', (o0 ? o0.name.replace(/（.*$/, '') + 'が' + hm(o0.at) + 'に' + o0.kind + 'で出動したと発表しています' + (o0.status === '鎮火' ? '（鎮火）' : '') + '。' : '') +
        (x.counts.total ? '近所の人から' + x.counts.total + '件の報告がありました（最新 ' + ago(x.last) + '）。' : (o0 ? '近所の人からの報告はまだありません。' : '')) +
        (calm ? '時間がたっているため、落ち着いている可能性があります。' : ''));
      var st = $('.f-stats', fire); st.innerHTML = '';
      if (o0) st.appendChild(stat('消防の発表', o0.kind, hm(o0.at) + (o0.status ? '・' + o0.status : ''), true));
      st.appendChild(stat('報告', String(x.counts.total), x.counts.total ? countsText(x.counts) : 'まだありません', !o0));
      st.appendChild(stat('最新', ago(x.last), hm(x.last)));
      var os = $('.f-off-sec', fire);
      if (os && off.length) {
        os.hidden = false; var ul = $('.f-off', fire); ul.innerHTML = '';
        off.forEach(function (o) {
          var li = el('li'); li.appendChild(el('b', null, hm(o.at) + ' ' + o.kind + (o.status ? '（' + o.status + '）' : '')));
          li.appendChild(document.createTextNode('　' + (o.town || '') + '　'));
          var a = el('a', { href: o.url, target: '_blank', rel: 'noopener' }, '出典：' + o.name); li.appendChild(a); ul.appendChild(li);
        });
      }
      st.appendChild(stat('口コミ', String(j.comments.length), '下に表示'));
      setup(x.pref || '東京都', x.ward, x.town, fixedU ? document.title.replace(/｜火事速$/, '') : place + '付近の火事の目撃情報');
      var ss = $('.f-share-sec', fire); ss.hidden = false;
      var tags = ' #' + x.ward + (x.town ? ' #' + baseTown(x.town) : '') + ' #火事';
      var text = (x.official ? '【消防出動】' + place + '付近で' + (x.official.kind || '火災') + (x.counts.total ? '　目撃報告' + x.counts.total + '件' : '') : '【火事の目撃情報】' + place + '付近　報告' + x.counts.total + '件（' + countsText(x.counts) + '）') + '　' + hm(x.last) + '時点' + tags;
      shareButtons($('.f-share', fire), text, API + '/f/' + encodeURIComponent(x.id));
    };
    var renderNews = function (x) {
      var place = placeOf({ pref: x.pref, city: x.city || x.ward, town: x.town ? x.town + (x.chome ? x.chome + '丁目' : '') : '' });
      var fixed = fire.hasAttribute('data-pref');   // 固定ページは見出し・タイトルをHTMLのまま使う
      setText('.f-kind', '報道された火事');
      if (!fixed) setText('.f-title', place + 'の火事');
      setText('.f-lead', hm(x.first) + 'ごろから報道されている火事です。' + (x.building !== '建物不明' ? '建物：' + x.building + '。' : '') + '詳しくは報道各社の記事をご覧ください。');
      var st = $('.f-stats', fire); st.innerHTML = '';
      st.appendChild(stat('最初の報道', hm(x.first), ago(x.first), true));
      if (!x.sensitive && (x.dead || x.injured)) st.appendChild(stat('けが人など', x.dead ? '亡くなった方あり' : 'けが人あり', '報道による'));
      var ns = $('.f-news-sec', fire); ns.hidden = false;
      var ul = el('ul', { class: 'plain' });
      x.sources.forEach(function (s) { var li = el('li'); li.appendChild(el('a', { href: s.link, target: '_blank', rel: 'noopener nofollow' }, s.name + ' の記事')); li.appendChild(el('span', { class: 'small muted' }, '　' + hm(s.pub))); ul.appendChild(li); });
      $('.f-news', fire).innerHTML = ''; $('.f-news', fire).appendChild(ul);
      setup(x.pref || '東京都', x.city || x.ward, x.town, fixed ? document.title.replace(/｜火事速$/, '') : place + 'の火事');
      var ss = $('.f-share-sec', fire); ss.hidden = false;
      shareButtons($('.f-share', fire), '【報道】' + place + 'の火事（' + hm(x.first) + '〜）' + ' #' + (x.city || x.ward) + ' #火事', location.href);
    };
    var notFound = function (t) {
      if (fire.hasAttribute('data-pref')) {   // 固定ページは書き込み済みの中身を残し、口コミ欄などだけ足す
        setup(fire.getAttribute('data-pref'), fire.getAttribute('data-city'), fire.getAttribute('data-town') || '', document.title.replace(/｜火事速$/, ''));
        return;
      }
      $$('.section', fire).forEach(function (s) { s.hidden = true; });
      setText('.f-title', '火事のページが見つかりません'); setText('.f-lead', t || 'URLが正しいか確かめてください。古い報告は表示されなくなることがあります。');
      var a = el('a', { class: 'btn', href: 'index.html' }, 'いまの火事を見る'); $('.f-stats', fire).appendChild(a);
    };
    if (isNews) loadNews().then(function (N) {
      if (N[id]) renderNews(N[id]);
      else if (fire.hasAttribute('data-pref')) {   // 固定ページは書き込み済みの中身を残し、口コミ欄などだけ足す
        var c0 = fire.getAttribute('data-city'), t0 = fire.getAttribute('data-town') || '';
        setup(fire.getAttribute('data-pref'), c0, t0, document.title.replace(/｜火事速$/, ''));
      }
      else notFound('この報道は表示期間（30日）を過ぎました。');
    });
    else if (!id) notFound();
    else if (!API) notFound('目撃報告の受付を準備中です。');
    else {
      var refresh = function () {
        return getJSON('/api/incident?id=' + encodeURIComponent(id)).then(function (j) {
          if (!j.incident) return notFound();
          renderUGC(j);
          var cb = $('[data-comments]', fire); if (cb && cb._reload && refresh.n++) cb._reload();
        }, function (e) { if (!shown) notFound(msg(e)); });
      };
      refresh.n = 0;
      refresh(); setInterval(refresh, 60000);
      document.addEventListener('kaji:posted', function () { setTimeout(refresh, 300); });
    }
  }
})();
