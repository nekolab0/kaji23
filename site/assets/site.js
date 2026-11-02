// 火事どこ23区: コピー、表の並べ替え、町名検索（外部通信なし）
(function () {
  'use strict';

  // シェア文のコピー
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      var done = function () { var t = btn.textContent; btn.textContent = 'コピーしました'; setTimeout(function () { btn.textContent = t; }, 1600); };
      try {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
      } catch (e) { fallback(text); done(); }
    });
  });
  function fallback(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  // 表の並べ替え（th に data-sort="num|text"）
  document.querySelectorAll('table[data-sortable]').forEach(function (table) {
    var ths = table.querySelectorAll('thead th');
    ths.forEach(function (th, idx) {
      var b = th.querySelector('button'); if (!b) return;
      b.addEventListener('click', function () {
        var dir = th.getAttribute('aria-sort') === 'descending' ? 'ascending' : 'descending';
        ths.forEach(function (o) { o.removeAttribute('aria-sort'); });
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

  // 町名検索
  var dataEl = document.getElementById('towns-data');
  var input = document.getElementById('town-q');
  var out = document.getElementById('town-results');
  var count = document.getElementById('town-count');
  if (dataEl && input && out) {
    var towns = JSON.parse(dataEl.textContent);
    var norm = function (s) {
      return String(s).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
        .replace(/[ァ-ン]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
        .replace(/[\s　]/g, '').replace(/ヶ|ケ/g, 'け').replace(/丁目.*$/, '').toLowerCase();
    };
    towns.forEach(function (t) { t._k = norm(t.t) + ' ' + norm(t.wn) + ' ' + norm(t.sn); });
    var render = function () {
      var q = norm(input.value).replace(/[0-9]+$/, '');
      out.innerHTML = '';
      if (!q) { count.textContent = '町名を入力すると、管轄の消防署とその署の火災件数が出ます。'; return; }
      var hit = towns.filter(function (t) { return t._k.indexOf(q) >= 0; }).slice(0, 60);
      count.textContent = hit.length ? hit.length + '件見つかりました' + (hit.length === 60 ? '（上位60件）' : '') : '見つかりませんでした。区名や、丁目を除いた町名で試してください。';
      hit.forEach(function (t) {
        var a = document.createElement('a');
        a.className = 'result'; a.href = t.w + '.html#st-' + t.s;
        var b = document.createElement('b'); b.textContent = t.wn + ' ' + t.t;
        var s = document.createElement('span'); s.className = 'small muted';
        s.textContent = '管轄：' + t.sn + (t.y !== null ? '　今年の火災 ' + t.y + '件' + (t.as ? '（' + t.as + '時点）' : '') : '　火災件数は未公表');
        a.appendChild(b); a.appendChild(s); out.appendChild(a);
      });
    };
    input.addEventListener('input', render);
    try { var p = new URLSearchParams(location.search).get('q'); if (p) input.value = p; } catch (e) {}
    render();
  }

  // 「サイレンが聞こえた」報告
  // 保存先: data-api（本番の受付サーバー）があればそこへ。なければ、このページを開いている
  // 共有の保存領域（claude.use("db")）へ。どちらも使えないときはボタンを出さず案内だけ残す。
  var KIND = { siren: 'サイレン', smoke: '煙・におい', fire: '火' };
  var DAY = 24 * 3600 * 1000;
  document.querySelectorAll('[data-reports]').forEach(function (box) {
    var api = box.getAttribute('data-api');
    var fixedWard = box.getAttribute('data-ward');
    var form = box.querySelector('.report-form');
    var status = box.querySelector('.report-status');
    var list = box.querySelector('.report-list');
    var buttons = form.querySelectorAll('button');
    var lastKey = 'kaji23-last-' + (fixedWard || 'all');
    var say = function (t) { status.textContent = t; };
    var setBusy = function (b) { buttons.forEach(function (x) { x.disabled = b; }); };

    // 集計を表示（区ページはその区の町ごと、トップは区ごと）
    var render = function (wardsAgg) {
      list.innerHTML = '';
      var rows = [];
      if (fixedWard) {
        var w = wardsAgg[fixedWard];
        if (!w || !w.total) { list.textContent = 'この24時間、' + fixedWard + 'からの報告はまだありません。'; return; }
        rows.push([fixedWard + ' 全体', w.total, w]);
        Object.keys(w.towns).sort(function (a, b) { return w.towns[b] - w.towns[a]; }).slice(0, 6).forEach(function (t) { rows.push([t, w.towns[t], null]); });
      } else {
        Object.keys(wardsAgg).sort(function (a, b) { return wardsAgg[b].total - wardsAgg[a].total; }).slice(0, 8).forEach(function (k) { rows.push([k, wardsAgg[k].total, wardsAgg[k]]); });
        if (!rows.length) { list.textContent = 'この24時間の報告はまだありません。'; return; }
      }
      var h = document.createElement('p'); h.className = 'muted'; h.textContent = 'この24時間に寄せられた報告'; list.appendChild(h);
      var ul = document.createElement('ul');
      rows.forEach(function (r) {
        var li = document.createElement('li');
        var l = document.createElement('span'); l.textContent = r[0];
        if (r[2]) { var d = []; ['fire', 'smoke', 'siren'].forEach(function (k) { if (r[2][k]) d.push(KIND[k] + ' ' + r[2][k]); });
          var s = document.createElement('span'); s.className = 'muted'; s.textContent = '（' + d.join('・') + (r[2].last ? '／最新 ' + hm(r[2].last) : '') + '）'; l.appendChild(s); }
        var n = document.createElement('span'); n.className = 'n'; n.textContent = r[1];
        li.appendChild(l); li.appendChild(n); ul.appendChild(li);
      });
      list.appendChild(ul);
    };
    var hm = function (iso) { var t = new Date(iso); return t.getHours() + ':' + ('0' + t.getMinutes()).slice(-2); };
    var aggregate = function (docs) {
      var out = {}, since = Date.now() - DAY;
      docs.forEach(function (r) {
        if (!r || !r.ward || !KIND[r.kind] || !(Date.parse(r.at) > since)) return;
        var w = out[r.ward] = out[r.ward] || { siren: 0, smoke: 0, fire: 0, total: 0, last: null, towns: {} };
        w[r.kind]++; w.total++; if (!w.last || r.at > w.last) w.last = r.at;
        if (r.town) w.towns[r.town] = (w.towns[r.town] || 0) + 1;
      });
      return out;
    };
    var cleanTown = function (t) { return String(t || '').trim().replace(/[0-9０-９]+(番地?|号|-|－).*$/, '').slice(0, 20); };

    var backend = null; // {send(rec) → Promise, start()}
    if (api) {
      backend = {
        send: function (rec) {
          return fetch(api.replace(/\/$/, '') + '/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) })
            .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || '送信できませんでした'); return j; }); });
        },
        start: function () {
          var load = function () { fetch(api.replace(/\/$/, '') + '/api/reports?hours=24').then(function (r) { return r.json(); }).then(function (j) { render(j.wards || {}); }).catch(function () {}); };
          load(); setInterval(load, 60000);
        }
      };
      ready();
    } else if (window.claude && typeof window.claude.use === 'function') {
      // 共有の保存領域が使えるまでボタンは押せない（10秒で諦める）
      setBusy(true); say('報告の受付を準備しています…');
      var timer = setTimeout(function () { unavailable(); }, 10000);
      window.claude.use('db').then(function (db) {
        clearTimeout(timer);
        if (!db) { unavailable(); return; }
        var col = db.collection('reports');
        backend = {
          send: function (rec) { return col.add(rec); },
          start: function () {
            var since = new Date(Date.now() - DAY).toISOString();
            col.where('at', '>=', since).onSnapshot(function (snap) {
              var docs = (snap.docs || snap || []).map(function (d) { return typeof d.data === 'function' ? d.data() : (d.data || d); });
              render(aggregate(docs));
            }, function () { list.textContent = '報告の集計を読み込めませんでした。'; });
          }
        };
        say(''); setBusy(false); ready();
      }, function () { clearTimeout(timer); unavailable(); });
    } else unavailable();

    function unavailable() {
      setBusy(true);
      form.hidden = true;
      say('このページでは報告の受付を準備中です。いま出動中の災害は、東京消防庁の災害情報案内（03-3212-2119）で確かめられます。');
    }
    function ready() {
      backend.start();
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var kind = (ev.submitter && ev.submitter.value) || 'siren';
        var ward = fixedWard || (form.querySelector('[name=ward]') || {}).value;
        if (!ward) { say('区を選んでください。'); return; }
        var town = cleanTown((form.querySelector('[name=town]') || {}).value);
        if (town && !/^[぀-ヿ㐀-鿿０-９0-9・ー々ヶ]+$/.test(town)) { say('町名は漢字・かなで入れてください（番地は不要です）。'); return; }
        try { var last = +localStorage.getItem(lastKey + ward) || 0; if (Date.now() - last < 10 * 60000) { say('同じ区への報告は10分に1回までです。'); return; } } catch (e) {}
        setBusy(true); say('送信しています…');
        var rec = { ward: ward, kind: kind, at: new Date().toISOString() };
        if (town) rec.town = town;
        backend.send(rec).then(function () {
          try { localStorage.setItem(lastKey + ward, String(Date.now())); } catch (e) {}
          say('報告しました。ありがとうございます。' + (kind === 'fire' ? ' 火が見える場合は、119番への通報もお願いします。' : ''));
        }, function (e) {
          say((e && e.message && /[ぁ-ん]/.test(e.message)) ? e.message : '送信できませんでした。閲覧のみの権限では報告できません。');
        }).then(function () { setBusy(false); });
      });
    }
  });
})();
