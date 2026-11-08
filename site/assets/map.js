// 火事マップ（map.html）：消防の発表・報道（data/map.js）と、近所の人の報告（受付サーバー /api/live）を地図に置く
// 地図は Leaflet ＋ 国土地理院の地図タイル。絞り込みは URL の # に入れる（例 #p=東京都&d=7）
(function () {
  var box = document.getElementById('fire-map');
  if (!box) return;
  var meta = document.querySelector('meta[name="kaji23-api"]');
  var API = meta && meta.content ? meta.content.replace(/\/$/, '') : '';
  var COLORS = { o: '#c2341b', n: '#e8891c', r: '#2f6fb3' };
  var SRC = { o: '消防の発表', n: '報道', r: '近所の人の報告' };
  var JAPAN = [[24.0, 122.9], [45.6, 146.0]];
  var state = { days: 1, pref: '' };
  var fires = [], prefs = [], geoCache = {}, map, layer;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hm(d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }
  function readHash() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    h.split('&').forEach(function (kv) {
      var p = kv.split('='); if (p[0] === 'p') state.pref = p[1] || ''; if (p[0] === 'd' && /^(1|7|30)$/.test(p[1])) state.days = +p[1];
    });
  }
  function writeHash() {
    var parts = []; if (state.pref) parts.push('p=' + state.pref); if (state.days !== 1) parts.push('d=' + state.days);
    var h = parts.length ? '#' + parts.join('&') : '';
    if (h !== location.hash) history.replaceState(null, '', location.pathname + location.search + h);
  }
  function getJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function loadScript(src) {
    return new Promise(function (ok, ng) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ng; document.head.appendChild(s); });
  }
  function baseTown(t) { return String(t || '').replace(/[0-9０-９一二三四五六七八九十]+丁目.*$/, '').replace(/[0-9０-９]+(番地?|号|-).*$/, '').replace(/付近$/, ''); }

  // 近所の人の報告に、町の代表点をつける（都道府県ごとの data/geo/NN.json を必要な分だけ読む）
  function geoOf(pref) {
    var i = prefs.indexOf(pref); if (i < 0) return Promise.resolve(null);
    if (!geoCache[pref]) geoCache[pref] = loadScript('data/geo/' + ('0' + (i + 1)).slice(-2) + '.js').then(function () { return (window.KAJI_GEO || {})[i + 1] || null; }, function () { return null; });
    return geoCache[pref];
  }
  function liveFires() {
    if (!API) return Promise.resolve([]);
    return getJSON(API + '/api/live?hours=72').then(function (j) {
      var list = (j.incidents || []).filter(function (x) { return x.counts && x.counts.total > 0 && !x.official; });
      var ps = {}; list.forEach(function (x) { ps[x.pref || '東京都'] = 1; });
      return Promise.all(Object.keys(ps).map(geoOf)).then(function () {
        return Promise.all(list.map(function (x) {
          var pref = x.pref || '東京都', city = x.city || x.ward;
          return geoOf(pref).then(function (g) {
            var c = g && g[city]; if (!c) return null;
            var t = baseTown(x.town), pt = (t && c[t]) || c._; if (!pt) return null;
            return { lat: pt[0], lng: pt[1], src: 'r', at: new Date(x.last), pref: pref, city: city, town: x.town || '', kind: '報告' + x.counts.total + '件',
                     href: 'fire.html?id=' + encodeURIComponent(x.id), area: '', exact: !!(t && c[t]) };
          });
        }));
      }).then(function (a) { return a.filter(Boolean); });
    }).catch(function () { return []; });
  }

  function popup(f) {
    var place = f.city + (f.town || '');
    var h = '<div class="map-pop"><b>' + esc(place) + (f.exact ? '' : '（場所は市区町村まで）') + '</b><br><span class="small">' + esc(hm(f.at)) + 'ごろ・' + SRC[f.src] + (f.kind ? '・' + esc(f.kind) : '') + '</span><br>';
    if (f.href) h += '<a href="' + esc(f.href) + '">火事のページ →</a> ';
    if (f.area) h += '<a href="' + esc(f.area) + '">' + esc(f.town || f.city) + 'の火事情報</a>';
    return h + '</div>';
  }
  function render(fit) {
    var now = Date.now(), lim = state.days * 864e5, shown = [];
    layer.clearLayers();
    fires.forEach(function (f) {
      var age = now - f.at.getTime();
      if (age > lim || age < -36e5) return;
      if (state.pref && f.pref !== state.pref) return;
      shown.push(f);
      var fresh = age < 864e5;
      L.circleMarker([f.lat, f.lng], { radius: fresh ? 8 : 6, color: '#fff', weight: 1.5, fillColor: COLORS[f.src], fillOpacity: fresh ? 0.9 : 0.55 })
        .bindPopup(popup(f)).addTo(layer);
    });
    var c = document.querySelector('[data-map-count]');
    if (c) c.textContent = (state.pref || '全国') + '・' + (state.days === 1 ? '24時間' : state.days + '日') + '：' + shown.length + '件';
    if (fit) {
      if (state.pref && shown.length) map.fitBounds(L.latLngBounds(shown.map(function (f) { return [f.lat, f.lng]; })).pad(0.3), { maxZoom: 11 });
      else if (state.pref) geoOf(state.pref).then(function (g) {
        var pts = g ? Object.keys(g).map(function (k) { return g[k]._; }).filter(Boolean) : [];
        if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.1));
      });
      else if (shown.length > 3) map.fitBounds(L.latLngBounds(shown.map(function (f) { return [f.lat, f.lng]; })).pad(0.15), { maxZoom: 8 });
      else map.fitBounds(JAPAN);
    }
    var btns = document.querySelectorAll('.map-ctrl [data-days]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(+btns[i].getAttribute('data-days') === state.days));
    var sel = document.querySelector('[data-map-pref]'); if (sel) sel.value = state.pref;
  }

  function start() {
    if (!window.L) { box.innerHTML = '<p class="muted small">地図を読み込めませんでした。下の一覧をご覧ください。</p>'; return; }
    readHash();
    box.innerHTML = '';
    map = L.map(box, { scrollWheelZoom: false, zoomSnap: 0.5 });
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      maxZoom: 18, minZoom: 4, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>'
    }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.fitBounds(JAPAN);
    layer = L.layerGroup().addTo(map);
    var btns = document.querySelectorAll('.map-ctrl [data-days]');
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener('click', function () { state.days = +this.getAttribute('data-days'); writeHash(); render(false); });
    var sel = document.querySelector('[data-map-pref]');
    if (sel) sel.addEventListener('change', function () { state.pref = sel.value; writeHash(); render(true); });
    loadScript('data/map.js').then(function () {
      var j = window.KAJI_MAP;
      prefs = j.prefs || [];
      fires = j.fires.map(function (a) {
        return { lat: a[0], lng: a[1], src: a[2], at: new Date(a[3]), pref: a[4], city: a[5], town: a[6], kind: a[7], href: a[8], area: a[9], exact: !!a[10] };
      });
      render(true);
      return liveFires().then(function (lv) {
        var seen = {}; fires.forEach(function (f) { if (f.href) seen[f.href] = 1; });
        fires = fires.concat(lv.filter(function (f) { return !seen[f.href]; }));
        render(false);
      });
    }).catch(function () {
      var c = document.querySelector('[data-map-count]'); if (c) c.textContent = '火事の記録を読み込めませんでした。少し待ってから再読み込みしてください。';
    });
    window.addEventListener('hashchange', function () { readHash(); render(true); });
  }
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();
