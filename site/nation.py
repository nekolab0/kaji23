# 全国版: 都道府県・市区町村・町のページ、検索索引、件数
# build.py から読み込む（build.py の関数・変数をそのまま使う）
import collections

AREAS_RAW = json.load(open(RAW / 'areas.json', encoding='utf-8'))
PREFS = list(AREAS_RAW['prefs'])
PARENTS = AREAS_RAW.get('parents', {})                       # 政令市 {都道府県: [[市名, [区...]], ...]}
CODE_OF = {(p, c): code for p, v in AREAS_RAW['prefs'].items() for c, code in v}
AREA_OF_CODE = {code: (p, c) for (p, c), code in CODE_OF.items()}
WARD_PARENT = {(p, w): name for p, lst in PARENTS.items() for name, wards in lst for w in wards}
TOWNS_JP = json.load(open(RAW / 'towns_jp.json', encoding='utf-8'))['towns']
TOKYO23 = [w['name'] for w in sorted(wards, key=lambda w: w['code'])]
REGIONS = [('北海道・東北', PREFS[0:7]), ('関東', PREFS[7:14]), ('中部', PREFS[14:23]), ('近畿', PREFS[23:30]),
           ('中国', PREFS[30:35]), ('四国', PREFS[35:39]), ('九州・沖縄', PREFS[39:47])]

# ---------- 件数（報道の記録。報告の件数はページを開いたときに受付サーバーから足す） ----------
_ap = RAW / 'news_archive.json'
ARCHIVE = json.load(open(_ap, encoding='utf-8'))['fires'] if _ap.exists() else {}
COUNTS = collections.Counter()
for pref, city, town, day in ARCHIVE.values():
    COUNTS[pref] += 1; COUNTS[f'{pref}|{city}'] += 1
    if town: COUNTS[f'{pref}|{city}|{town}'] += 1
    par = WARD_PARENT.get((pref, city))
    if par: COUNTS[f'{pref}|{par}'] += 1

# ---------- 記録（報道の全期間）: 火事の固定ページ・町の固定ページ・説明文に使う ----------
NEWS_BY_ID = {x['id']: x for x in news['incidents']}
def _rec(aid, v):
    x = NEWS_BY_ID.get(aid)
    pref, city, town, day = v
    return {'aid': aid, 'fid': 'n-' + aid, 'pref': pref, 'city': city, 'town': town or '', 'day': day, 'x': x}
RECORDS = [_rec(aid, v) for aid, v in ARCHIVE.items()]
for aid, x in NEWS_BY_ID.items():   # 保存前の最新分も
    if aid not in ARCHIVE:
        RECORDS.append({'aid': aid, 'fid': 'n-' + aid, 'pref': x.get('pref') or '東京都', 'city': x.get('city') or x['ward'],
                        'town': base_of(x['town']) if x.get('town') else '', 'day': x['first'][:10], 'x': x})
# 消防本部の発表（受付サーバーが集めたもの）。同じ日・同じ町の報道があれば、報道のページに発表を添える
_op = RAW / 'official_archive.json'
OFFICIAL = json.load(open(_op, encoding='utf-8'))['fires'] if _op.exists() else {}
_news_key = {(r['pref'], r['city'], r['town'], r['day']): r for r in RECORDS}
_news_city_day = {}
for r in RECORDS: _news_city_day.setdefault((r['pref'], r['city'], r['day']), []).append(r)
TOWN_NAMES = {code: {t[0] for t in ts} for code, ts in TOWNS_JP.items()}
_TOWN_SORTED = {}
def norm_town(pref, city, t):
    """発表の町名を、全国の町名一覧にある町名に合わせる（「丸谷町○○工場」→「丸谷町」）。合わなければ空（市区町村まで）"""
    if not t: return ''
    code = CODE_OF.get((pref, city))
    if not code: return ''
    names = TOWN_NAMES.get(code, ())
    if t in names: return t
    if code not in _TOWN_SORTED: _TOWN_SORTED[code] = sorted(names, key=len, reverse=True)
    t2 = t.replace('ヶ', 'ケ')
    for n in _TOWN_SORTED[code]:
        if t.startswith(n) or t2.startswith(n.replace('ヶ', 'ケ')): return n
    return ''
_off_seen = set()
for oid, v in sorted(OFFICIAL.items(), key=lambda kv: (kv[0].startswith('o-b-'), kv[0])):   # 受付サーバーの分（火事のページがある）を先に
    pref, city, town, day, kind, at, sname, surl, status = (list(v) + [''] * 9)[:9]
    if status == '誤報': continue
    town = norm_town(pref, city, town)
    dk = (pref, city, town, day) if town else (pref, city, (at or day)[:16])
    if dk in _off_seen: continue   # さかのぼって取り込んだ分と、受付サーバーの分の重なり
    _off_seen.add(dk)
    o = {'kind': kind, 'at': at, 'name': sname, 'url': surl, 'status': status}
    hit = _news_key.get((pref, city, town, day))
    if hit is None:   # 町名のない報道と同じ日・同じ市区町村
        hit = next((r for r in _news_city_day.get((pref, city, day), []) if not r['town'] or not town), None)
    if hit is not None:
        hit.setdefault('official', o)
        if not hit['town'] and town: hit['town'] = town
        continue
    if (pref, city) not in CODE_OF: continue
    RECORDS.append({'aid': oid, 'fid': oid, 'pref': pref, 'city': city, 'town': town, 'day': day, 'x': None, 'official': o})
RECORDS.sort(key=lambda r: (r['day'], (r['x'] or {}).get('first', '') or (r.get('official') or {}).get('at', '')), reverse=True)
# 件数（報道の記録＋消防の発表）
COUNTS = collections.Counter()
for r in RECORDS:
    pref, city, town = r['pref'], r['city'], r['town']
    COUNTS[pref] += 1; COUNTS[f'{pref}|{city}'] += 1
    if town: COUNTS[f'{pref}|{city}|{town}'] += 1
    par = WARD_PARENT.get((pref, city))
    if par: COUNTS[f'{pref}|{par}'] += 1
def static_town_file(p, c, t): return f'm-{p}-{c}-{t}.html'
STATIC_TOWNS = set()
for r in RECORDS:
    p_, c_, t_ = r['pref'], r['city'], r['town']
    if not t_ or p_ == '東京都' and c_ in by_name: continue
    code = CODE_OF.get((p_, c_))
    if code and t_ in TOWN_NAMES.get(code, ()): STATIC_TOWNS.add((p_, c_, t_))

def is23(pref, city): return pref == '東京都' and city in by_name
def pref_file(p): return f'p-{p}.html'
def city_file(p, c):
    if is23(p, c): return by_name[c]['slug'] + '.html'
    return f'c-{p}-{c}.html'
def town_href(p, c, t):
    if is23(p, c):
        x = TOWNS.get((c, t))
        if x: return x['file']
    if (p, c, t) in STATIC_TOWNS: return static_town_file(p, c, t)
    code = CODE_OF.get((p, c))
    return f'town.html?c={code}&t={quote(t)}' if code else city_file(p, c)
def cnt_badge(key):
    n = COUNTS.get(key, 0)
    return f'<span class="cnt">{n}</span>' if n else ''

def news_in(pref=None, city=None, town=None):
    out = []
    for x in news['incidents']:
        xp = x.get('pref', '東京都'); xc = x.get('city', x['ward'])
        if pref and xp != pref: continue
        if city and xc != city and WARD_PARENT.get((xp, xc)) != city: continue
        if town and (not x['town'] or base_of(x['town']) != town): continue
        out.append(x)
    return out

ALERT_JP = '''<div class="alert" role="note"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9e2914" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
<p><strong>火や煙が見えたらすぐ119番。</strong>火事かどうかの確認だけで119番にかけないでください。現場には近づかないでください。</p></div>'''

# ---------- 検索索引（町名12万件を、2文字ごとの分割ファイルに） ----------
N_SHARDS = 512
def knorm(s): return s.replace('ヶ', 'ケ').replace('ｹ', 'ケ')
def shard_of(a, b): return (ord(a) * 31 + ord(b)) % N_SHARDS
def build_search_index(out_dir):
    shards = [[] for _ in range(N_SHARDS)]
    for code, towns_ in TOWNS_JP.items():
        if code not in AREA_OF_CODE: continue
        p, c = AREA_OF_CODE[code]
        cname = re.sub(r'（.*）$', '', c)
        for t in towns_:
            s = knorm(cname + t[0]); entry = f'{code}:{t[0]}'
            for k in {shard_of(s[i], s[i + 1]) for i in range(len(s) - 1)}: shards[k].append(entry)
    (out_dir / 's').mkdir(parents=True, exist_ok=True)
    sizes = []
    for i, lst in enumerate(shards):
        (out_dir / 's' / f'{i}.js').write_text(f'__kajiShard({i},{json.dumps(lst, ensure_ascii=False, separators=(",", ":"))});', encoding='utf-8')
        sizes.append(len(lst))
    return sizes

def areas_js(sizes):
    data = {'prefs': {p: [c for c, _ in v] for p, v in AREAS_RAW['prefs'].items()},
            'codes': {code: [p, c] for (p, c), code in CODE_OF.items()},
            'parents': PARENTS, 'kana': AREAS_RAW.get('kana', {}), 'pkana': AREAS_RAW.get('pref_kana', {}),
            'shards': sizes, 'counts': {k: v for k, v in COUNTS.items()},
            'tokyo23': {w['name']: w['slug'] for w in wards},
            'towns23': {f'{t["ward"]}|{t["base"]}': t['file'] for t in TOWN_LIST}}
    return ('// 全国の都道府県・市区町村（総務省 全国地方公共団体コード）、検索索引の大きさ、報道の件数\n'
            'window.KAJI_AREAS = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')

def town_files(out_dir):
    """市区町村ごとの町名と位置（町のページで「近くの町」を出すのに使う）"""
    (out_dir / 't').mkdir(parents=True, exist_ok=True)
    for code, towns_ in TOWNS_JP.items():
        (out_dir / 't' / f'{code}.js').write_text(f'__kajiTowns("{code}",{json.dumps(towns_, ensure_ascii=False, separators=(",", ":"))});', encoding='utf-8')

def national_search(placeholder='都道府県・市区町村・町名で検索（例：神奈川県、名古屋市、中区栄）', autofocus=False):
    return (f'<div class="nsearch" data-nsearch><label for="nq" class="sr">都道府県・市区町村・町名で検索</label>'
            f'<input id="nq" type="search" inputmode="search" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="nq-list" aria-autocomplete="list" placeholder="{esc(placeholder)}"{" autofocus" if autofocus else ""}>'
            '<ul id="nq-list" class="nq-list" role="listbox" hidden></ul>'
            '<div class="btn-row nq-actions"><button type="button" class="btn primary geo-go">現在地から調べる</button><a class="btn" href="index.html#now">いまの火事を見る</a></div>'
            '<p class="small muted nq-status" aria-live="polite"></p></div>')

def news_list_jp(items, empty='報道は見つかっていません。', show_pref=True):
    if not items: return f'<p class="muted small news-empty">{empty}</p>'
    lis = []
    for x in items:
        xp = x.get('pref', '東京都'); xc = x.get('city', x['ward'])
        place = (esc(xp) if show_pref and not is23(xp, xc) else '') + esc(xc) + (esc(x['town']) + (f'{x["chome"]}丁目' if x.get('chome') else '') if x['town'] else '')
        tags = [f'<span class="tag">{esc(x["building"])}</span>'] if x['building'] != '建物不明' else []
        if not x.get('sensitive'):
            if x['dead']: tags.append('<span class="tag dark">亡くなった方あり</span>')
            elif x['injured']: tags.append('<span class="tag warn">けが人あり</span>')
        srcs = '・'.join(f'<a href="{esc(s["link"])}" target="_blank" rel="noopener nofollow">{esc(s["name"])}</a>' for s in x['sources'])
        lis.append(f'<li class="news-item" data-pref="{esc(xp)}" data-ward="{esc(xc)}"><div class="row"><a class="place" href="{esc(fire_href(news_fire_id(x)))}"><b>{place}</b></a>{"".join(tags)}</div>'
                   f'<span class="small muted">最初の報道 {jtime(x["first"])}　報道：{srcs}</span></li>')
    return f'<ul class="news">{"".join(lis)}</ul>'

NEWS_NOTE_JP = ('<p class="small muted">報道各社のニュースから、火事の場所（町名まで）・建物の種類・けが人の有無だけを自動で取り出しています。'
                '詳しい内容はリンク先の記事でご確認ください。報道されない小さな火事は載りません。' +
                (f'最終確認：{jtime(news["collectedAt"])}' if news['collectedAt'] else '') + '</p>')

def live_jp(pref=None, city=None, town=None, empty=None):
    attrs = (f' data-pref="{esc(pref)}"' if pref else '') + (f' data-city="{esc(city)}"' if city else '') + (f' data-town="{esc(town)}"' if town else '')
    where = (town or city or pref or '全国')
    empty = empty or f'いま、{where}で上がっている報告はありません。'
    return f'<div class="live" data-live{attrs} data-empty="{esc(empty)}"><p class="muted small live-loading">いまの報告を読み込んでいます…</p></div>'

def crumbs(*items):
    parts = ['<a href="index.html">トップ</a>'] + [f'<a href="{h}">{esc(t)}</a>' if h else esc(t) for t, h in items]
    return f'<nav class="crumbs" aria-label="パンくず">{" ／ ".join(parts)}</nav>'

# ---------- トップ（全国） ----------
def index_page(full=True):
    regions = ''.join(
        f'<div class="region"><h3>{esc(r)}</h3><div class="town-grid">'
        + ''.join(f'<a href="{pref_file(p)}">{esc(p)}{cnt_badge(p)}</a>' for p in ps) + '</div></div>' for r, ps in REGIONS)
    recent = news['incidents'][:12]
    body = f'''<div class="wrap">
<section class="hero hero-search">
  <span class="eyebrow">全国の火事を、町名でリアルタイムに</span>
  <h1><span class="nb">今、どこで</span><span class="nb">火事が起きている？</span></h1>
  <p class="lead">サイレンや煙に気づいたら、地名を入れてください。近所の人の目撃報告・口コミと、報道された火事を、都道府県・市区町村・町ごとにまとめています。</p>
  {national_search()}
  {ALERT_JP}
</section>
<section class="section" aria-labelledby="now">
  <div class="sec-head"><h2 id="now">いま・直近24時間の火事</h2><span class="small muted live-updated"></span></div>
  <div class="two-col">
    {live_jp(empty='いま上がっている報告はありません。サイレンや煙に気づいたら、右の欄から知らせてください。')}
    {post_panel(title='サイレン・煙・火に気づいたら', note='全国どこからでも送れます。同じ場所の近くの人の報告とまとめて「火事のページ」ができ、近所の人と共有できます。消防への通報にはなりません。')}
  </div>
</section>
<section class="section" aria-labelledby="recent">
  <h2 id="recent">最近報道された火事</h2>
  {news_list_jp(recent, empty='直近30日の火事の報道は見つかっていません。')}
  {NEWS_NOTE_JP}
</section>
<section class="section" id="regions" aria-labelledby="rg">
  <h2 id="rg">地域から探す</h2>
  <p class="small muted">数字は、このサイトに記録された火事の件数です。</p>
  <div class="regions">{regions}</div>
</section>
<section class="section" aria-labelledby="t23">
  <h2 id="t23">東京23区はもっと詳しく</h2>
  <p>東京23区は、58の消防署が公表している火災件数と、926町ごとのページがあります。</p>
  <div class="btn-row"><a class="btn" href="{pref_file("東京都")}#t23">東京23区の区から探す</a><a class="btn" href="ranking.html">区・消防署の火災件数</a><a class="btn" href="towns.html">23区の町名一覧</a></div>
</section>
<section class="section" aria-labelledby="gd">
  <h2 id="gd">火事の調べ方・備え</h2>
  <ul class="plain"><li><a href="g-kajidoko.html">近くで火事？今どこで火事か調べる方法5つ</a></li><li><a href="g-siren.html">消防車のサイレン「ウーウーカンカン」の意味</a></li>
  <li><a href="g-119.html">火事を見つけたら：119番通報の伝え方</a></li><li><a href="g-cause.html">火事の原因ランキング（消防白書）</a></li><li><a href="dial-list.html">都道府県別 火災の案内ダイヤル一覧</a></li></ul>
</section>
</div>'''
    title = f'{SITE_NAME}｜今どこで火事？全国の火事の目撃情報・速報を町名でリアルタイムに'
    desc = '今どこで火事？サイレンや煙に気づいたら地名で検索。全国の火事の目撃報告・口コミ・報道を、都道府県・市区町村・町ごとにリアルタイムでまとめています。'
    return page('index', title, desc, body, full=full)

# ---------- 都道府県 ----------
def pref_page(p):
    par = {name: wards_ for name, wards_ in PARENTS.get(p, [])}
    in_parent = {w for ws in par.values() for w in ws}
    items = []
    for c, code in AREAS_RAW['prefs'][p]:
        if c in in_parent: continue
        items.append(f'<a href="{city_file(p, c)}">{esc(c)}{cnt_badge(f"{p}|{c}")}</a>')
    groups = ''.join(f'<div class="region"><h3><a href="{city_file(p, name)}">{esc(name)}</a>{cnt_badge(f"{p}|{name}")}</h3><div class="town-grid">'
                     + ''.join(f'<a href="{city_file(p, w)}">{esc(w[len(name):])}{cnt_badge(f"{p}|{w}")}</a>' for w in ws) + '</div></div>' for name, ws in par.items())
    extra = ''
    if p == '東京都':
        tiles = []
        for w in wards:
            r, c = w['pos']
            tiles.append(f'<a class="tile hx" style="grid-row:{r};grid-column:{c}" href="{w["slug"]}.html" data-ward-tile="{esc(w["name"])}">{esc(w["name"].replace("区", ""))}<span class="small tile-n"></span></a>')
        f_day = fire_d.get('day')
        extra = f'''<section class="section" id="t23" aria-labelledby="t23h">
  <h2 id="t23h">東京23区</h2>
  <p class="small muted">23区は、消防署ごとの火災件数と町ごとのページがあります。数字はいま上がっている報告の件数です。</p>
  <div class="tilemap">{"".join(tiles)}</div>
  <p class="small">{esc(re.sub(r"^令和\d+年|計$", "", daily["label"]))}の東京消防庁管内の火災は<strong class="num">{fmt(f_day)}</strong>件（速報値）。<a href="ranking.html">区・消防署ごとの火災件数</a>　<a href="towns.html">23区の町名一覧</a></p>
</section>'''
    body = f'''<div class="wrap">
{crumbs((p, None))}
<section class="hero">
  <span class="eyebrow">{esc(p)}の火事情報</span>
  <h1>{esc(p)}の火事はどこ？いまの目撃情報・火事速報</h1>
  <p class="lead">{esc(p)}の目撃報告・口コミと、報道された火事をまとめています。市区町村を選ぶと、町ごとに見られます。</p>
  {national_search(placeholder=f'{p}の市区町村・町名で検索')}
  {ALERT_JP if p != '東京都' else ALERT}
</section>
<section class="section" aria-labelledby="now">
  <h2 id="now">いまの{esc(p)}</h2>
  <div class="two-col">{live_jp(pref=p)}{post_panel(p, title=f'{p}で気づいたことを知らせる')}</div>
</section>
<section class="section" aria-labelledby="news">
  <h2 id="news">{esc(p)}で報道された火事</h2>
  {news_list_jp(news_in(pref=p), empty=f'直近30日に、{p}の火事の報道は見つかっていません。', show_pref=False)}
</section>
{extra}
<section class="section" aria-labelledby="cities">
  <h2 id="cities">{esc(p)}の市区町村</h2>
  {groups}
  <div class="town-grid">{"".join(items)}</div>
</section>
<section class="section" aria-labelledby="sns">
  <h2 id="sns">SNS・ニュースで確かめる</h2>
  {sns_links([p.replace("北海道", "北海道").rstrip("都府県") if p != "北海道" else p])}
</section>
</div>'''
    title = f'【速報】{p}の火事どこ？今日のサイレン・火事情報｜{SITE_NAME}'
    desc = area_desc(p)
    return page(pref_file(p)[:-5], title, desc, body, og_image='og/live.png')

# ---------- 市区町村（23区以外） ----------
def city_page(p, c):
    code = CODE_OF.get((p, c))
    par = WARD_PARENT.get((p, c))
    if code is None:   # 政令市（区の一覧）
        wards_ = dict(PARENTS[p])[c]
        main = (f'<section class="section" aria-labelledby="wl"><h2 id="wl">{esc(c)}の区</h2><div class="town-grid">'
                + ''.join(f'<a href="{city_file(p, w)}">{esc(w[len(c):])}{cnt_badge(f"{p}|{w}")}</a>' for w in wards_) + '</div></section>')
        post = post_panel(p, title=f'{c}で気づいたことを知らせる')
    else:
        towns_ = TOWNS_JP.get(code, [])
        main = (f'<section class="section" aria-labelledby="tl"><h2 id="tl">{esc(c)}の町から探す（{len(towns_)}町）</h2>'
                + (f'<div class="town-grid">' + ''.join(f'<a href="{esc(town_href(p, c, t[0]))}">{esc(t[0])}{cnt_badge(f"{p}|{c}|{t[0]}")}</a>' for t in towns_) + '</div>' if towns_ else '<p class="muted">町名のデータがありません。</p>')
                + '<p class="small muted">町名：Geolonia 住所データ（CC BY 4.0）</p></section>')
        post = post_panel(p, c, title=f'{c}で気づいたことを知らせる')
    cr = [(p, pref_file(p))] + ([(par, city_file(p, par))] if par else []) + [(c[len(par):] if par else c, None)]
    body = f'''<div class="wrap">
{crumbs(*cr)}
<section class="hero">
  <span class="eyebrow">{esc(p)}{esc(c)}の火事情報</span>
  <h1>{esc(c)}の火事はどこ？いまの目撃情報・火事速報</h1>
  <p class="lead">{esc(p)}{esc(c)}の目撃報告・口コミと、報道された火事をまとめています。サイレンや煙に気づいたら、ここから近所の人と共有できます。</p>
  {ALERT_JP}
  {push_box(p, c) if code else ''}
</section>
<section class="section" aria-labelledby="now">
  <h2 id="now">いまの{esc(c)}</h2>
  <div class="two-col">{live_jp(pref=p, city=c) if code else live_jp(pref=p, empty=f'いま、{p}で上がっている報告はありません。')}{post}</div>
</section>
<section class="section" aria-labelledby="news">
  <h2 id="news">{esc(c)}で報道された火事</h2>
  {news_list_jp(news_in(pref=p, city=c), empty=f'直近30日に、{c}の火事の報道は見つかっていません。', show_pref=False)}
</section>
{dial_block(p, c)}
{city_records(p, c)}
{main}
<section class="section" aria-labelledby="sns">
  <h2 id="sns">SNS・ニュースで確かめる</h2>
  {sns_links([c])}
</section>
</div>'''
    title = f'【速報】{c}（{p}）の火事どこ？今日のサイレン・火事情報｜{SITE_NAME}'
    desc = area_desc(p, c)
    return page(city_file(p, c)[:-5], title, desc, body, og_image='og/live.png')

# ---------- 町（23区以外は1つのページで町名ごとに表示を切り替え） ----------
def town_page(pre=None):
    """pre を渡すと、記録のある町の固定ページ（m-都道府県-市区町村-町.html）"""
    pre = pre or {}
    attrs = ''.join(f' data-{k}="{esc(pre[k])}"' for k in ('c', 't') if pre.get(k))
    body = f'''<div class="wrap" data-town-page{attrs}>
<nav class="crumbs t-crumbs" aria-label="パンくず">{pre.get('crumbs_inner', '<a href="index.html">トップ</a>')}</nav>
<section class="hero">
  <span class="eyebrow t-eyebrow">{esc(pre.get('eyebrow', '町の火事情報'))}</span>
  <h1 class="t-title">{esc(pre.get('h1', '町の火事情報'))}</h1>
  <p class="lead t-lead">{esc(pre.get('lead', '読み込んでいます…'))}</p>
  {ALERT_JP}
  <div class="t-push"></div>
</section>
<section class="section t-sec" aria-labelledby="now" hidden>
  <h2 id="now" class="t-now">いまの報告</h2>
  <div class="two-col"><div class="t-live"></div><div class="t-post"></div></div>
</section>
<section class="section t-sec" aria-labelledby="board" hidden>
  <h2 id="board" class="t-board">口コミ</h2>
  <div class="t-comments"></div>
  <p class="small muted">口コミは上の欄の「口コミを書く」から投稿できます。</p>
</section>
<section class="section t-sec" aria-labelledby="news" hidden>
  <h2 id="news" class="t-newsh">報道された火事</h2>
  <div class="t-news"></div>
</section>
{pre.get('records', '')}
<section class="section t-sec" aria-labelledby="near" hidden>
  <h2 id="near">近くの町</h2>
  <div class="town-grid t-near"></div>
  <p class="small muted">町名と位置：Geolonia 住所データ（CC BY 4.0）</p>
</section>
<section class="section t-sec" aria-labelledby="sns" hidden>
  <h2 id="sns">SNS・ニュースで確かめる</h2>
  <div class="btn-row sns t-sns"></div>
</section>
</div>'''
    if pre:
        return page(pre['name'], pre['title'], pre['desc'], body, og_image='og/live.png', ld_extra=pre.get('ld'))
    return page('town', f'町の火事情報｜{SITE_NAME}', '町ごとの火事の目撃報告・口コミ・報道。', body, og_image='og/live.png')

def news_js():
    data = {news_fire_id(x): {k: x.get(k) for k in ('pref', 'city', 'ward', 'town', 'chome', 'building', 'injured', 'dead', 'sensitive', 'first', 'last', 'sources')}
            for x in news['incidents']}
    for v in data.values():
        v['pref'] = v['pref'] or '東京都'; v['city'] = v['city'] or v['ward']
    return '// 直近30日に報道された火事（場所・建物・けが人の有無・報道元）\nwindow.KAJI_NEWS = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'

# ---------- 固定ページ（検索エンジンに載せる）: 報道された火事・記録のある町 ----------
def jday(d):
    y, m, dd = d.split('-'); return f'{int(y)}年{int(m)}月{int(dd)}日'
def jmd(d):
    _, m, dd = d.split('-'); return f'{int(m)}月{int(dd)}日'
def place_of(p, c, t=''):
    return ('' if is23(p, c) else p) + c + (t or '')
def bc_ld(items):
    """パンくずの構造化データ。items = [(名前, ファイル名 or None), ...]"""
    lst = [{"@type": "ListItem", "position": i + 1, "name": n, **({"item": f'{SITE_URL}/{quote(h)}' if h != 'index.html' else f'{SITE_URL}/'} if h else {})}
           for i, (n, h) in enumerate([('トップ', 'index.html')] + items)]
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": lst}
def records_in(p, c=None, t=None):
    return [r for r in RECORDS if r['pref'] == p and (c is None or r['city'] == c or WARD_PARENT.get((p, r['city'])) == c) and (t is None or r['town'] == t)]
def rec_kind(r):
    x = r['x'] or {}; o = r.get('official') or {}
    b = x.get('building')
    if b and b != '建物不明': return b
    k = o.get('kind') or r.get('kind') or ''
    return '' if k in ('', '火災') else k
def rec_src(r):
    return '報道' if r['x'] else '消防の発表' if r.get('official') else '消防の記録'
def has_page(r): return r['fid'].startswith(('n-', 'o-'))
def record_list(rs, show_city=True):
    lis = []
    for r in rs:
        place = (r['city'] if show_city else '') + (r['town'] or ('' if show_city else '町名は不明'))
        k = rec_kind(r)
        tag = f'<span class="tag">{esc(k)}</span>' if k else ''
        name = f'<a class="place" href="{esc(fire_href(r["fid"]))}"><b>{esc(place)}</b></a>' if has_page(r) else f'<b class="place">{esc(place)}</b>'
        lis.append(f'<li class="news-item"><div class="row">{name}{tag}</div>'
                   f'<span class="small muted">{jday(r["day"])}（{rec_src(r)}）</span></li>')
    return f'<ul class="news">{"".join(lis)}</ul>'
def area_crumbs(p, c, t=None):
    par = WARD_PARENT.get((p, c))
    items = [(p, pref_file(p))] + ([(par, city_file(p, par))] if par else []) + [(c[len(par):] if par else c, city_file(p, c))]
    if t:
        tf = town_href(p, c, t)
        items.append((t, tf if not tf.startswith('town.html') else None))
    return items

def static_fire_page(r):
    p, c, t, day, x, o = r['pref'], r['city'], r['town'], r['day'], r['x'], r.get('official')
    chome = (x or {}).get('chome')
    place = place_of(p, c, t + (f'{chome}丁目' if t and chome else ''))
    k = rec_kind(r)
    hurt = ''
    if x and not x.get('sensitive'):
        hurt = '亡くなった方がいると報じられています。' if x.get('dead') else 'けが人がいると報じられています。' if x.get('injured') else ''
    off_line = ''
    if o:
        hm = jtime(o['at']).split(' ')[1] if o.get('at') else ''
        org = re.sub(r'（.*$', '', o.get('name') or '消防本部')
        off_line = f'{org}が{hm}ごろの{o.get("kind") or "火災"}の出動を発表しました' + ('（鎮火）' if o.get('status') == '鎮火' else '') + '。'
    if x:
        lead = f'{jday(day)}、{place}で{(k + "の") if k else ""}火事が報道されました。{hurt}{off_line}詳しくは報道各社の記事をご覧ください。'
        kind_label = '報道された火事'
    else:
        lead = f'{jday(day)}、{place}付近で{k or "火災"}が発生しました。{off_line}最新の状況は出典の消防本部のページでご確認ください。'
        kind_label = '消防の発表'
    lead += '近くで見た・聞いたことがあれば、下から口コミで共有できます。'
    news_html = ''
    if x:
        news_html = '<ul class="plain">' + ''.join(
            f'<li><a href="{esc(s_["link"])}" target="_blank" rel="noopener nofollow">{esc(s_["name"])} の記事</a><span class="small muted">　{jtime(s_["pub"])}</span></li>'
            for s_ in x['sources']) + '</ul>'
    off_html = ''
    if o and o.get('url'):
        off_html = (f'<section class="section" aria-labelledby="offs"><h2 id="offs">消防本部の発表（出典）</h2><ul class="plain"><li><b>{esc(jtime(o["at"]) if o.get("at") else jday(day))} {esc(o.get("kind") or "火災")}'
                    + (f'（{esc(o["status"])}）' if o.get('status') else '') + f'</b>　<a href="{esc(o["url"])}" target="_blank" rel="noopener">{esc(o.get("name") or "出典")}</a></li></ul>'
                    '<p class="small muted">各消防本部が公開している出動情報から、火災の出動だけを自動で取り出しています。</p></section>')
    cr = area_crumbs(p, c, t or None)
    crumb_html = ' ／ '.join((f'<a href="{esc(h)}">{esc(n)}</a>' if h else esc(n)) for n, h in cr) + ' ／ 火事のページ'
    rel = [q for q in records_in(p, c) if q['fid'] != r['fid']][:10]
    push_sec = (f'<section class="section" aria-labelledby="psh"><h2 id="psh">{esc(c)}の次の火事を知らせる</h2>{push_box(p, c)}</section>') if (p, c) in CODE_OF else ''
    after = off_html + push_sec + ((f'<section class="section" aria-labelledby="rel"><h2 id="rel">{esc(c)}のほかの火事</h2>{record_list(rel)}'
             f'<p class="small"><a href="{esc(city_file(p, c))}">{esc(c)}の火事情報を見る →</a>'
             + (f'　<a href="{esc(town_href(p, c, t))}">{esc(t)}の火事情報を見る →</a>' if t else '') + '</p></section>') if rel or t else '')
    title = f'{place}の火事（{jmd(day)}）{"・" + k if k else ""}｜{SITE_NAME}'
    desc = (f'{jday(day)}、{place}の火事。' + (f'種別：{k}。' if k else '') + hurt + ('報道元' if x else '消防本部の発表') + 'と、近所の人の目撃報告・口コミをまとめています。')
    ld = [bc_ld(cr + [(f'{jmd(day)}の火事', None)])]
    return fire_page({'name': fire_href(r['fid'])[:-5], 'title': title, 'desc': desc, 'kind': kind_label, 'h1': f'{place}の火事（{jmd(day)}）',
                      'lead': lead, 'news': news_html, 'crumb': crumb_html, 'after': after, 'ld': ld,
                      'id': r['fid'] if x else ('' if r['fid'].startswith('o-b-') else r['fid'][2:]), 'pref': p, 'city': c, 'town': t})   # さかのぼった分は受付サーバーに火事がない

def static_town_page(p, c, t):
    code = CODE_OF[(p, c)]
    rs = records_in(p, c, t)
    cr = area_crumbs(p, c, t)
    crumbs_inner = '<a href="index.html">トップ</a> ／ ' + ' ／ '.join((f'<a href="{esc(h)}">{esc(n)}</a>' if h else esc(n)) for n, h in cr[:-1]) + f' ／ {esc(t)}'
    last = rs[0]['day'] if rs else None
    records = (f'<section class="section" aria-labelledby="rec"><h2 id="rec">{esc(t)}の火事の記録（{len(rs)}件）</h2>'
               f'{record_list(rs, show_city=False)}<p class="small muted">当サイトが報道・消防本部の発表・自治体のオープンデータから記録した火事です（{SITE_NAME}の収録分）。</p></section>')
    # 同じ市区町村で火事の記録がある町（固定ページどうしを静的なリンクでつなぐ。検索エンジンが町のページをたどれるように）
    cnt = collections.Counter(r['town'] for r in records_in(p, c) if r['town'] and r['town'] != t and (p, c, r['town']) in STATIC_TOWNS)
    if cnt:
        sib = ''.join(f'<a href="{esc(static_town_file(p, c, tt))}">{esc(tt)}<span class="cnt">{n}</span></a>' for tt, n in sorted(cnt.items(), key=lambda x: (-x[1], x[0]))[:30])
        records += (f'<section class="section" aria-labelledby="sib"><h2 id="sib">{esc(c)}のほかの町の火事</h2><div class="town-grid">{sib}</div>'
                    f'<p class="small"><a href="{esc(city_file(p, c))}">{esc(c)}の火事情報をすべて見る</a></p></section>')
    records += dial_block(p, c)
    title = f'【速報】{t}（{c}）の火事どこ？今日のサイレン・火事情報｜{SITE_NAME}'
    desc = (f'{p}{c}{t}で火事？' + (f'最新は{jday(last)}の火事。' if last else '') + f'記録{len(rs)}件。サイレン・煙の目撃報告、近所の口コミ、報道された火事を町ごとにまとめています。')
    return town_page({'name': static_town_file(p, c, t)[:-5], 'title': title, 'desc': desc, 'c': code, 't': t,
                      'crumbs_inner': crumbs_inner, 'eyebrow': f'{p}{c}{t}の火事情報', 'h1': f'{t}（{c}）の火事はどこ？',
                      'lead': f'{place_of(p, c, t)}付近の目撃報告・口コミと、報道された火事をまとめています。サイレンや煙に気づいたら、ここから近所の人と共有できます。',
                      'records': records, 'ld': [bc_ld(cr[:-1] + [(t, None)])]})

def area_desc(p, c=None):
    """市区町村・都道府県ページの説明文。30分ごとの生成で「いつ時点・最新の火事・件数」を書き込む（検索結果で新しさが伝わるように）"""
    now = datetime.datetime.now(JST)
    rs = records_in(p, c)
    head = f'【{now.month}/{now.day} {now.hour}:{now.minute:02d}時点】'
    where = c or p
    if not rs:
        return head + f'{p}{c or ""}で火事？サイレンや煙の目撃報告・口コミ・報道を、町ごとにリアルタイムでまとめています。'
    r = rs[0]; k = rec_kind(r)
    since = (now - datetime.timedelta(days=30)).date().isoformat()
    recent = sum(1 for q in rs if q['day'] >= since)
    return (head + f'{where}の最新は{jmd(r["day"])} {(r["city"] if c is None or r["city"] != c else "") + r["town"]}の{k if k.endswith("火災") else (k + "の火事") if k else "火事"}。'
            + (f'直近30日の火事{recent}件。' if recent else '') + (f'記録{len(rs)}件。' if len(rs) > recent else '') + 'サイレン・煙の目撃報告と口コミも町ごとにリアルタイムで。')

_dp = RAW / 'dial_numbers.json'
DIAL = json.load(open(_dp, encoding='utf-8'))['dial'] if _dp.exists() else {}
def dial_block(p, c):
    """市区町村ページ: 火災・災害の案内ダイヤル（サイレンが聞こえたときの確認先）と出動情報ページ"""
    par = WARD_PARENT.get((p, c))
    d = DIAL.get(f'{p}|{c}') or (DIAL.get(f'{p}|{par}') if par else None)
    if not d: return ''
    tels = ''.join(f'<li><a class="num" href="tel:{esc(t.replace("-", ""))}">{esc(t)}</a></li>' for t in d.get('tel', []))
    webs = ''.join(f'<li><a href="{esc(u)}" target="_blank" rel="noopener">{esc(c if not par else par)}の消防の出動情報（公式）↗</a></li>' for u in d.get('web', []))
    return (f'<section class="section" aria-labelledby="dial"><h2 id="dial">{esc(c)}の火災・災害を電話で確かめる</h2>'
            f'<p class="small">サイレンが聞こえたら、消防本部の案内ダイヤルで、いま出動している火災・災害を確かめられます。<strong>確認のための119番はやめてください</strong>（緊急の通報がつながりにくくなります）。</p>'
            + (f'<ul class="plain">{tels}</ul>' if tels else '') + (f'<ul class="plain">{webs}</ul>' if webs else '')
            + '<p class="small muted">番号・ページは各消防本部の公表によるものです。変わることがあるため、つながらないときは公式サイトでご確認ください。</p>'
            + f'<p class="small"><a href="dial-{esc(p)}.html">{esc(p)}の案内ダイヤル一覧 →</a>　<a href="g-kajidoko.html">今どこで火事か調べる方法 →</a></p></section>')

def city_records(p, c):
    """市区町村ページ: これまでの火事の記録（新しい順）と、年・種別・町ごとの件数"""
    rs = records_in(p, c)
    if not rs: return ''
    years = collections.Counter(r['day'][:4] for r in rs)
    kinds = collections.Counter(rec_kind(r) for r in rs if rec_kind(r))
    towns = collections.Counter((r['city'], r['town']) for r in rs if r['town'])
    yrs = '・'.join(f'{y}年 {n}件' for y, n in sorted(years.items(), reverse=True)[:6])
    kd = '・'.join(f'{k} {n}件' for k, n in kinds.most_common(6))
    tw = ''.join(f'<a href="{esc(town_href(p, cc2, t))}">{esc((cc2[len(c):] if cc2 != c else "") + t)}<span class="cnt">{n}</span></a>'
                 for (cc2, t), n in towns.most_common(40))
    return (f'<section class="section" aria-labelledby="rec"><h2 id="rec">{esc(c)}の火事の記録（{len(rs)}件）</h2>'
            f'<p class="small">{yrs}</p>' + (f'<p class="small">{kd}</p>' if kd else '')
            + (f'<h3 style="font-size:15px">火事の記録が多い町</h3><div class="town-grid">{tw}</div>' if tw else '')
            + f'<h3 style="font-size:15px">最近の火事</h3>{record_list(rs[:20])}'
            f'<p class="small muted">当サイトが報道・消防本部の発表・自治体のオープンデータから記録した火事です（{SITE_NAME}の収録分。すべての火事ではありません）。</p></section>')

def static_pages():
    pages = {}
    for r in RECORDS:
        if has_page(r): pages[fire_href(r['fid'])] = static_fire_page(r)
    for p, c, t in sorted(STATIC_TOWNS): pages[static_town_file(p, c, t)] = static_town_page(p, c, t)
    return pages

def national_pages():
    pages = {}
    for p in PREFS: pages[pref_file(p)] = pref_page(p)
    for p, lst in AREAS_RAW['prefs'].items():
        for c, code in lst:
            if not is23(p, c): pages[city_file(p, c)] = city_page(p, c)
    for p, lst in PARENTS.items():
        for name, _ in lst: pages[city_file(p, name)] = city_page(p, name)
    pages['town.html'] = town_page()
    pages.update(static_pages())
    return pages
