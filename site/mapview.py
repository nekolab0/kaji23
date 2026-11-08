# 火事マップ（map.html）と、地図に使うデータ（data/map.json・data/geo/NN.json）
# build.py の名前空間で exec される（RECORDS・TOWNS_JP・CODE_OF・PREFS・page・esc などを使う）
# SEO 担当の決定（seo/decisions.md 2026-11-07・11-08）：地図は1ページだけ。絞り込みは # で、canonical は map.html。
# 地図の下に直近24時間（0件なら直近3日）の火事を HTML のリンクで並べ、JS なしでも読めるようにする

_PT_CACHE = {}
def _mean(pts):
    pts = [p for p in pts if p and p[0] is not None and p[1] is not None]
    return [round(sum(p[0] for p in pts) / len(pts), 5), round(sum(p[1] for p in pts) / len(pts), 5)] if pts else None

def city_pt(p, c):
    """市区町村の代表点（町の代表点の平均）。政令市は区の平均"""
    k = (p, c)
    if k in _PT_CACHE: return _PT_CACHE[k]
    code = CODE_OF.get(k)
    ts = TOWNS_JP.get(code) if code else None
    if ts:
        pt = _mean([(t[1], t[2]) for t in ts])
    else:
        wards_ = [w for (pp, w), n in WARD_PARENT.items() if pp == p and n == c]
        pt = _mean([q for q in (city_pt(p, w) for w in wards_) if q])
    _PT_CACHE[k] = pt
    return pt

_TOWN_PT = {}
def town_pt(p, c, t):
    code = CODE_OF.get((p, c))
    if not code or not t: return None
    if code not in _TOWN_PT:
        _TOWN_PT[code] = {x[0]: [x[1], x[2]] for x in TOWNS_JP.get(code, []) if x[1] is not None}
    return _TOWN_PT[code].get(t)

def rec_time(r):
    """記録の時刻（ISO）。報道は最初の報道の時刻、消防の発表は出動の時刻、わからなければその日の正午"""
    x = r['x'] or {}; o = r.get('official') or {}
    return x.get('first') or o.get('at') or f'{r["day"]}T12:00:00+09:00'

def _ts(iso):
    return datetime.datetime.fromisoformat(iso.replace('Z', '+00:00'))

def map_records(days=30):
    now = datetime.datetime.now(datetime.timezone.utc)
    out = []
    for r in RECORDS:
        try: t = _ts(rec_time(r))
        except ValueError: continue
        if t.tzinfo is None: t = t.replace(tzinfo=JST)
        if now - t > datetime.timedelta(days=days): continue
        pt = town_pt(r['pref'], r['city'], r['town']) or city_pt(r['pref'], r['city'])
        if not pt: continue
        out.append((r, t, pt))
    return out

def map_json(recs):
    fires = []
    for r, t, pt in recs:
        p, c, tw = r['pref'], r['city'], r['town']
        fires.append([pt[0], pt[1], 'o' if r.get('official') else 'n', t.astimezone(JST).isoformat(timespec='minutes'),
                      p, c, tw, rec_kind(r), fire_href(r['fid']) if has_page(r) else '',
                      town_href(p, c, tw) if tw else city_file(p, c), 1 if town_pt(p, c, tw) else 0])
    return {'generatedAt': datetime.datetime.now(JST).isoformat(timespec='minutes'), 'prefs': PREFS, 'fires': fires}

def geo_files(out_dir):
    """近所の人の報告（受付サーバー）を地図に置くための、都道府県ごとの町の代表点"""
    d = out_dir / 'data' / 'geo'
    d.mkdir(parents=True, exist_ok=True)
    by_pref = {p: {} for p in PREFS}
    for (p, c), code in CODE_OF.items():
        ts = TOWNS_JP.get(code)
        if not ts: continue
        m = {'_': city_pt(p, c)}
        for x in ts:
            if x[1] is not None: m[x[0]] = [x[1], x[2]]
        by_pref[p][c] = m
    for (p, w), par in WARD_PARENT.items():
        if par not in by_pref[p]: by_pref[p][par] = {'_': city_pt(p, par)}
    for i, p in enumerate(PREFS, 1):
        (d / f'{i:02d}.json').write_text(json.dumps(by_pref[p], ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

def map_page():
    recs = map_records(30)
    now = datetime.datetime.now(datetime.timezone.utc)
    day1 = [x for x in recs if now - x[1] <= datetime.timedelta(hours=24)]
    span, lst = ('24時間', day1) if day1 else ('3日', [x for x in recs if now - x[1] <= datetime.timedelta(days=3)])
    asof = datetime.datetime.now(JST)
    asof_s = f'{asof.month}月{asof.day}日 {asof.hour}:{asof.minute:02d}'
    groups = ''
    for p in PREFS:
        rs = [x for x in lst if x[0]['pref'] == p]
        if not rs: continue
        lis = []
        for r, t, pt in rs:
            c, tw = r['city'], r['town']
            jt = t.astimezone(JST)
            place = f'{c}{tw}'
            name = f'<a class="place" href="{esc(fire_href(r["fid"]))}"><b>{esc(place)}</b></a>' if has_page(r) else f'<b class="place">{esc(place)}</b>'
            k = rec_kind(r)
            area = f'<a href="{esc(town_href(p, c, tw))}">{esc(tw)}の火事情報</a>' if tw else f'<a href="{esc(city_file(p, c))}">{esc(c)}の火事情報</a>'
            lis.append(f'<li class="news-item"><div class="row">{name}{f"<span class=tag>{esc(k)}</span>" if k else ""}</div>'
                       f'<span class="small muted">{jt.month}月{jt.day}日 {jt.hour}:{jt.minute:02d}ごろ（{rec_src(r)}）・{area}</span></li>')
        groups += f'<h3 class="map-pref"><a href="{esc(pref_file(p))}">{esc(p)}</a>（{len(rs)}件）</h3><ul class="news">{"".join(lis)}</ul>'
    if not groups:
        groups = '<p class="muted">直近3日に記録された火事はありません。</p>'
    pref_opts = ''.join(f'<option>{esc(p)}</option>' for p in PREFS)
    n_label = f'直近{span}に記録された火事は<strong>{len(lst)}件</strong>（{asof_s}時点）'
    body = f'''<div class="wrap">
<section class="hero"><p class="crumb"><a href="index.html">トップ</a> ／ 火事マップ</p>
<h1>火事マップ（全国）</h1>
<p class="lead">今日どこで火事があったかを、全国の地図で確かめられます。{n_label}。消防の発表・報道・近所の人の目撃報告を色分けして表示します。</p></section>
<section class="section map-sec" aria-labelledby="mp">
<h2 id="mp" class="sr-only">地図</h2>
<div class="map-ctrl">
  <div class="seg" role="group" aria-label="期間"><button type="button" data-days="1" aria-pressed="true">24時間</button><button type="button" data-days="7" aria-pressed="false">7日</button><button type="button" data-days="30" aria-pressed="false">30日</button></div>
  <label class="map-pref-sel"><span class="sr-only">都道府県</span><select data-map-pref><option value="">全国</option>{pref_opts}</select></label>
</div>
<div id="fire-map" class="fire-map" role="region" aria-label="火事の地図"><p class="muted small map-loading">地図を読み込んでいます…</p></div>
<div class="map-foot"><ul class="map-legend"><li><i class="dot o"></i>消防の発表</li><li><i class="dot n"></i>報道</li><li><i class="dot r"></i>近所の人の報告</li></ul><span class="small muted" data-map-count></span></div>
<noscript><p class="small muted">地図を表示するには JavaScript を有効にしてください。下の一覧は JavaScript なしでも読めます。</p></noscript>
</section>
<section class="section" aria-labelledby="recent">
<h2 id="recent">直近{span}の火事</h2>
<p class="small muted">報道と消防本部の発表から記録した火事です（{asof_s}時点。収録した分だけで、すべての火事ではありません）。近所の人の報告は地図と<a href="index.html">トップ</a>に表示しています。</p>
{groups}
</section>
<section class="section" aria-labelledby="how">
<h2 id="how">地図の見方と注意</h2>
<ul>
<li><strong>火や煙が目の前に見えたら、地図を見る前に119番</strong>してください。火事かどうかの確認のためだけに119番にかけないでください。</li>
<li>丸の位置は<strong>町の代表点</strong>（町名がわからないときは市区町村の中心）で、火事が起きた建物の場所ではありません。</li>
<li>報道や発表が載るまで時間がかかることがあります。出動中の火事は、各地の<a href="dial-list.html">火災の案内ダイヤル</a>で確かめられます。</li>
<li>近所の人の報告は利用者の投稿で、内容を確認したものではありません。</li>
</ul>
</section>
<section class="section" aria-labelledby="rel">
<h2 id="rel">あわせて見る</h2>
<ul class="plain"><li><a href="g-kajidoko.html">今どこで火事か調べる方法5つ</a></li><li><a href="dial-list.html">都道府県別 火災の案内ダイヤル一覧</a></li><li><a href="index.html#regions">地域から探す（都道府県・市区町村・町）</a></li></ul>
</section>
</div>
<link rel="stylesheet" href="assets/vendor/leaflet.css">
<script src="assets/vendor/leaflet.js" defer></script>
<script src="assets/map.js" defer></script>'''
    title = f'火事マップ｜今日どこで火事？全国の火事を地図で（24時間・7日・30日）｜{SITE_NAME}'
    desc = '今日どこで火事があったかを全国の地図で。消防の発表・報道・近所の人の目撃報告を色分けし、24時間・7日・30日で切り替えられます。町名から火事のページへ。'
    ld = [bc_ld([('火事マップ', None)])]
    return page('map', title, desc, body, og_image='og/map.png', ld_extra=ld), map_json(recs)
