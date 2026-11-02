// 火事どこ: 町名検索・現在地・いまの火事・目撃報告（全国）・口コミ・火事のページ・共有
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
    s = s.replace(/(\d+丁目).*$/, '$1').replace(/\d+(番地?|号|-|－|ー).*$/, '');
    return s.slice(0, 20);
  }
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
  var TOWN_FILES = readJSON('town-files') || {};
  TOWN_INDEX.forEach(function (t) { TOWN_FILES[t.w + '|' + t.t] = t.f; });
  function townFile(pref, city, town) { return pref === '東京都' && town ? TOWN_FILES[city + '|' + baseTown(town)] : null; }

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
  var liveBoxes = $$('[data-live]'), tiles = $$('[data-ward-tile]');
  function fireCard(x) {
    var li = el('li', { class: 'fire-card' + (Date.now() - Date.parse(x.last) > 90 * 60000 ? ' calm' : '') });
    var a = el('a', { class: 'place', href: 'fire.html?id=' + encodeURIComponent(x.id) });
    a.appendChild(el('b', null, placeOf(x) + '付近')); li.appendChild(a);
    var row = el('div', { class: 'row' });
    row.appendChild(el('span', { class: 'tag warn' }, '報告 ' + x.counts.total + '件'));
    var ct = countsText(x.counts); if (ct) row.appendChild(el('span', { class: 'small muted' }, ct));
    if (x.comments) row.appendChild(el('span', { class: 'tag' }, '口コミ ' + x.comments));
    li.appendChild(row);
    li.appendChild(el('span', { class: 'small muted' }, '最新の報告 ' + ago(x.last) + '（' + hm(x.last) + '）' + (Date.now() - Date.parse(x.last) > 90 * 60000 ? '・落ち着いている可能性があります' : '')));
    if (x.latest && x.latest[0]) li.appendChild(el('p', { class: 'quote' }, '「' + x.latest[0].body + '」'));
    return li;
  }
  function loadLive() {
    if (!liveBoxes.length && !tiles.length) return;
    if (!API) { liveBoxes.forEach(function (b) { b.innerHTML = ''; b.appendChild(el('p', { class: 'muted small' }, '目撃報告の受付を準備中です。')); }); return; }
    getJSON('/api/live?hours=6').then(function (j) {
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
  loadLive(); if (liveBoxes.length || tiles.length) setInterval(loadLive, 60000);

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
    var NEWS = readJSON('news-fires') || {}, WARD_FILES = readJSON('ward-files') || {};
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
      document.title = title + '｜火事どこ';
      var crumb = $('.f-crumb');
      if (crumb) {
        crumb.innerHTML = '';
        var wf = pref === '東京都' && WARD_FILES[ward]; if (wf) { crumb.appendChild(el('a', { href: wf + '.html' }, ward)); crumb.appendChild(document.createTextNode(' ／ ')); }
        else { crumb.appendChild(document.createTextNode(pref + ward + ' ／ ')); }
        var tf = townFile(pref, ward, town); if (tf) { crumb.appendChild(el('a', { href: tf }, baseTown(town))); crumb.appendChild(document.createTextNode(' ／ ')); }
        crumb.appendChild(document.createTextNode('火事のページ'));
      }
      if (API && AREAS.prefs[pref] && AREAS.prefs[pref].indexOf(ward) >= 0) {
        $('.f-rep-sec', fire).hidden = false;
        var r = makePanel(pref, ward, town); $('.f-report', fire).appendChild(r); initPanel(r);
      }
      // 口コミの一覧
      var cb = el('div', { class: 'comments', 'data-comments': '', 'data-pref': pref, 'data-city': ward, 'data-inc': id });
      if (town) cb.setAttribute('data-town', town);
      cb.innerHTML = '<ul class="com-list" aria-live="polite"><li class="muted small">口コミを読み込んでいます…</li></ul>';
      $('.f-comments', fire).appendChild(cb); initComments(cb);
      // SNS
      var q = (town ? baseTown(town) : ward) + ' 火事', sns = $('.f-sns', fire);
      [['Xで「' + q + '」を見る', 'https://x.com/search?q=' + encodeURIComponent(q) + '&f=live'],
       ['Yahoo!リアルタイム検索', 'https://search.yahoo.co.jp/realtime/search?p=' + encodeURIComponent(q)],
       ['ニュースを探す', 'https://news.google.com/search?q=' + encodeURIComponent(q) + '&hl=ja&gl=JP&ceid=JP:ja']].forEach(function (l) {
        sns.appendChild(el('a', { class: 'btn', href: l[1], target: '_blank', rel: 'noopener' }, l[0]));
      });
      sns.className += ' btn-row';
    };
    var renderUGC = function (j) {
      var x = j.incident, place = placeOf(x), calm = Date.now() - Date.parse(x.last) > 90 * 60000;
      setText('.f-kind', calm ? '火事の目撃情報（落ち着いている可能性）' : '火事の目撃情報');
      setText('.f-title', place + '付近で火事？');
      setText('.f-lead', '近所の人から' + x.counts.total + '件の報告がありました。最初の報告は' + hm(x.first) + '、最新は' + ago(x.last) + '（' + hm(x.last) + '）です。' +
        (calm ? '最後の報告から時間がたっているため、落ち着いている可能性があります。' : ''));
      var st = $('.f-stats', fire); st.innerHTML = '';
      st.appendChild(stat('報告', String(x.counts.total), countsText(x.counts), true));
      st.appendChild(stat('最新の報告', ago(x.last), hm(x.last)));
      st.appendChild(stat('口コミ', String(j.comments.length), '下に表示'));
      setup(x.pref || '東京都', x.ward, x.town, place + '付近の火事の目撃情報');
      var ss = $('.f-share-sec', fire); ss.hidden = false;
      var tags = ' #' + x.ward + (x.town ? ' #' + baseTown(x.town) : '') + ' #火事';
      var text = '【火事の目撃情報】' + place + '付近　報告' + x.counts.total + '件（' + countsText(x.counts) + '）' + hm(x.last) + '時点' + tags;
      shareButtons($('.f-share', fire), text, API + '/f/' + encodeURIComponent(x.id));
    };
    var renderNews = function (x) {
      var place = x.ward + (x.town ? x.town + (x.chome ? x.chome + '丁目' : '') : '');
      setText('.f-kind', '報道された火事');
      setText('.f-title', place + 'の火事');
      setText('.f-lead', hm(x.first) + 'ごろから報道されている火事です。' + (x.building !== '建物不明' ? '建物：' + x.building + '。' : '') + '詳しくは報道各社の記事をご覧ください。');
      var st = $('.f-stats', fire); st.innerHTML = '';
      st.appendChild(stat('最初の報道', hm(x.first), ago(x.first), true));
      if (!x.sensitive && (x.dead || x.injured)) st.appendChild(stat('けが人など', x.dead ? '亡くなった方あり' : 'けが人あり', '報道による'));
      var ns = $('.f-news-sec', fire); ns.hidden = false;
      var ul = el('ul', { class: 'plain' });
      x.sources.forEach(function (s) { var li = el('li'); li.appendChild(el('a', { href: s.link, target: '_blank', rel: 'noopener nofollow' }, s.name + ' の記事')); li.appendChild(el('span', { class: 'small muted' }, '　' + hm(s.pub))); ul.appendChild(li); });
      $('.f-news', fire).appendChild(ul);
      setup('東京都', x.ward, x.town, place + 'の火事');
      var ss = $('.f-share-sec', fire); ss.hidden = false;
      shareButtons($('.f-share', fire), '【報道】' + place + 'の火事（' + hm(x.first) + '〜）' + ' #' + x.ward + ' #火事', location.href);
    };
    var notFound = function (t) {
      $$('.section', fire).forEach(function (s) { s.hidden = true; });
      setText('.f-title', '火事のページが見つかりません'); setText('.f-lead', t || 'URLが正しいか確かめてください。古い報告は表示されなくなることがあります。');
      var a = el('a', { class: 'btn', href: 'index.html' }, 'いまの火事を見る'); $('.f-stats', fire).appendChild(a);
    };
    if (isNews) { if (NEWS[id]) renderNews(NEWS[id]); else notFound('この報道は表示期間（30日）を過ぎました。'); }
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
