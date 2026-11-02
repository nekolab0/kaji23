#!/usr/bin/env python3
"""火事どこ23区 静的サイト生成
入力: data/raw/tfd_*.json（東京消防庁から収集）, pop_*.json（東京都の統計）, contacts.json
出力: dist/（そのまま公開できる静的サイト）
"""
import json, re, html, glob, os, shutil, datetime
from urllib.parse import quote
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data' / 'raw'
DIST = ROOT / 'dist'
SITE = ROOT / 'site'
SITE_NAME = '火事どこ23区'
SITE_URL = os.environ.get('SITE_URL', '')  # 例: https://kaji23.example.jp （独自ドメイン取得後に設定）
TFD = 'https://www.tfd.metro.tokyo.lg.jp'
THIS_YEAR = 2026

def latest(pattern):
    files = sorted(glob.glob(str(RAW / pattern)))
    return json.load(open(files[-1], encoding='utf-8')), Path(files[-1]).name

tfd, tfd_file = latest('tfd_*.json')
pop, pop_file = latest('pop_*.json')
contacts = json.load(open(RAW / 'contacts.json', encoding='utf-8'))
TEL = {c['key']: c for c in contacts['items']}
_np = RAW / 'news.json'
news = json.load(open(_np, encoding='utf-8')) if _np.exists() else {'collectedAt': None, 'incidents': []}
_wu = ROOT / 'worker' / 'url.txt'  # worker.yml が公開後に書く
REPORTS_API = os.environ.get('REPORTS_API') or (_wu.read_text().strip() if _wu.exists() else '')

# ---------- 区のマスタ（URL用のローマ字、全国地方公共団体コード、隣接区、タイル位置） ----------
WARD_META = {
  # tfd_slug: (url_slug, code, (row, col))
  'nerima': ('nerima', '13120', (1, 1)), 'itabashi': ('itabashi', '13119', (1, 2)), 'kita': ('kita', '13117', (1, 3)),
  'adati': ('adachi', '13121', (1, 4)), 'katusika': ('katsushika', '13122', (1, 5)),
  'suginami': ('suginami', '13115', (2, 1)), 'nakano': ('nakano', '13114', (2, 2)), 'toshima': ('toshima', '13116', (2, 3)),
  'arakawa': ('arakawa', '13118', (2, 5)), 'edogawa': ('edogawa', '13123', (2, 6)),
  'setagaya': ('setagaya', '13112', (3, 1)), 'shibuya': ('shibuya', '13113', (3, 2)), 'shinjuku': ('shinjuku', '13104', (3, 3)),
  'bunkyo': ('bunkyo', '13105', (3, 4)), 'taito': ('taito', '13106', (3, 5)), 'sumida': ('sumida', '13107', (3, 6)),
  'meguro': ('meguro', '13110', (4, 2)), 'minato': ('minato', '13103', (4, 3)), 'chiyoda': ('chiyoda', '13101', (4, 4)),
  'chuo': ('chuo', '13102', (4, 5)), 'koto': ('koto', '13108', (4, 6)),
  'ota': ('ota', '13111', (5, 2)), 'shinagawa': ('shinagawa', '13109', (5, 3)),
}
ADJ = {
  'chiyoda': ['chuo', 'minato', 'shinjuku', 'bunkyo', 'taito'], 'chuo': ['chiyoda', 'minato', 'koto', 'taito', 'sumida'],
  'minato': ['chiyoda', 'chuo', 'shinjuku', 'shibuya', 'shinagawa'], 'shinjuku': ['chiyoda', 'minato', 'shibuya', 'nakano', 'toshima', 'bunkyo'],
  'bunkyo': ['chiyoda', 'shinjuku', 'toshima', 'kita', 'arakawa', 'taito'], 'taito': ['chiyoda', 'chuo', 'bunkyo', 'arakawa', 'sumida'],
  'sumida': ['taito', 'koto', 'arakawa', 'adati', 'katusika', 'edogawa'], 'koto': ['chuo', 'sumida', 'edogawa'],
  'shinagawa': ['minato', 'shibuya', 'meguro', 'ota'], 'meguro': ['shibuya', 'shinagawa', 'ota', 'setagaya'],
  'ota': ['shinagawa', 'meguro', 'setagaya'], 'setagaya': ['shibuya', 'meguro', 'ota', 'suginami'],
  'shibuya': ['minato', 'shinjuku', 'nakano', 'suginami', 'setagaya', 'meguro', 'shinagawa'],
  'nakano': ['shinjuku', 'shibuya', 'suginami', 'nerima', 'toshima'], 'suginami': ['nakano', 'shibuya', 'setagaya', 'nerima'],
  'toshima': ['shinjuku', 'bunkyo', 'kita', 'itabashi', 'nerima', 'nakano'], 'kita': ['toshima', 'bunkyo', 'arakawa', 'adati', 'itabashi'],
  'arakawa': ['bunkyo', 'taito', 'sumida', 'adati', 'kita'], 'itabashi': ['kita', 'toshima', 'nerima'],
  'nerima': ['itabashi', 'toshima', 'nakano', 'suginami'], 'adati': ['kita', 'arakawa', 'sumida', 'katusika'],
  'katusika': ['adati', 'sumida', 'edogawa'], 'edogawa': ['katusika', 'sumida', 'koto'],
}

esc = lambda s: html.escape(str(s), quote=True)
fmt = lambda n: f'{n:,}' if isinstance(n, int) else ('—' if n is None else str(n))

def fix_town(t):
    # 「大井大井3～7丁目」のような見出しの重複を除く
    return re.sub(r'^(.{2,6}?)\1', r'\1', t)

def jdate(s):
    """'2026-10-31' → '10月31日'、'2026-08-末' → '8月末'"""
    if not s: return None
    m = re.match(r'(\d{4})-(\d{2})-(\d{2}|末)', s)
    if not m: return s
    y, mo, d = m.groups()
    lab = f'{int(mo)}月{d if d == "末" else int(d)}' + ('' if d == '末' else '日')
    return lab if int(y) == THIS_YEAR else f'{y}年{lab}'

# ---------- 集計 ----------
stations = {}
for slug, s in tfd['stations'].items():
    st = dict(slug=slug, name=s['n'], url=TFD + s['u'], status=s['s'], ytd=s['y'], prev=s['p'],
              annual={int(k): v for k, v in (s.get('a') or {}).items()}, asof=s.get('as'), updated=s.get('up'),
              src=s.get('src') or {}, warn=s.get('w') or [])
    st['when'] = st['asof'] or st['updated']
    stations[slug] = st

wards = []
for w in tfd['wards']:
    url_slug, code, pos = WARD_META[w['slug']]
    p = pop['wards'][code]
    sts = []
    for st_slug, towns in w['st'].items():
        st = stations[st_slug]
        st['ward'] = w['slug']; st['ward_name'] = w['name']; st['ward_url'] = url_slug
        st['towns'] = [fix_town(t) for t in towns]
        sts.append(st)
    ok = [s for s in sts if s['status'] == 'ok']
    complete = len(ok) == len(sts)
    ytd = sum(s['ytd'] for s in ok) if ok else None
    prev = sum(s['prev'] for s in ok) if ok and all(s['prev'] is not None for s in ok) else None
    years = sorted({y for s in sts for y in s['annual']})
    ward_annual = {y: sum(s['annual'][y] for s in sts) for y in years if all(y in s['annual'] for s in sts)}
    whens = sorted(s['when'] for s in ok if s['when'])
    wards.append(dict(
        tfd=w['slug'], slug=url_slug, name=w['name'], code=code, pos=pos, stations=sts, complete=complete,
        n_ok=len(ok), ytd=ytd, prev=prev, ward_annual=ward_annual, pop=p['pop'], households=p['households'],
        density=p['density'], area=round(p['pop'] / p['density'], 2),
        per100k=round(ytd / p['pop'] * 100000, 1) if complete and ytd is not None else None,
        when_min=whens[0] if whens else None, when_max=whens[-1] if whens else None,
        whole_ward=any(t.endswith('の区域') for s in sts for t in s['towns']),
    ))
by_tfd = {w['tfd']: w for w in wards}
by_name = {w['name']: w for w in wards}

# ---------- 町（丁目を除いた町名）ごとのまとまり ----------
towns_extra = json.load(open(RAW / 'towns_extra.json', encoding='utf-8'))
def base_of(t):
    t = re.sub(r'（.*$', '', t)
    return re.sub(r'[0-9０-９].*$', '', t).strip()
TOWNS = {}
for w in wards:
    for st in w['stations']:
        for t in st['towns']:
            if t.endswith('の区域'): continue
            for part in t.split('、'):
                b = base_of(part)
                if not b or re.search(r'[（）番]', b): continue
                d = TOWNS.setdefault((w['name'], b), dict(ward=w['name'], wslug=w['slug'], base=b, parts=[], stations=[]))
                if part not in d['parts']: d['parts'].append(part)
                if st['slug'] not in d['stations']: d['stations'].append(st['slug'])
for wn, e in towns_extra['wards'].items():
    w = by_name[wn]
    for b in e['towns']:
        TOWNS.setdefault((wn, b), dict(ward=wn, wslug=w['slug'], base=b, parts=[b], stations=[e['station']]))
for t in TOWNS.values(): t['file'] = f'm-{t["wslug"]}-{t["base"]}.html'
TOWN_LIST = sorted(TOWNS.values(), key=lambda t: (t['ward'], t['base']))
def towns_of(ward_name): return [t for t in TOWN_LIST if t['ward'] == ward_name]

# 人口あたりの色分け（全署が公表している区だけ）
vals = sorted(w['per100k'] for w in wards if w['per100k'] is not None)
def heat(v):
    if v is None: return 'hx'
    q = [vals[int(len(vals) * f)] for f in (0.25, 0.5, 0.75)]
    return 'h1' if v < q[0] else 'h2' if v < q[1] else 'h3' if v < q[2] else 'h4'
ranked = sorted([w for w in wards if w['per100k'] is not None], key=lambda w: -w['per100k'])
for i, w in enumerate(ranked): w['rank'] = i + 1
n_ranked = len(ranked)

daily = tfd['daily']
daily.setdefault('url', TFD + '/learning/elib/nikkan.html')
fire_d = daily['rows'].get('火災件数', {})
TOTAL_TOWNS = sum(len(s['towns']) for s in stations.values())
N_OK = sum(1 for s in stations.values() if s['status'] == 'ok')
N_ANNUAL = sum(1 for s in stations.values() if s['status'] == 'annual-only')
N_UNPUB = sum(1 for s in stations.values() if s['status'] == 'unpublished')
FETCHED = datetime.datetime.fromisoformat(tfd['fetchedAt'].replace('Z', '+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=9)))
FETCHED_LABEL = f'{FETCHED.month}月{FETCHED.day}日 {FETCHED.hour}:{FETCHED.minute:02d}'

def chg(cur, prev):
    if cur is None or prev is None: return ''
    d = cur - prev
    cls = 'up' if d > 0 else 'down' if d < 0 else 'flat'
    sign = '+' if d > 0 else ''
    return f'<span class="chg {cls}">前年同時期 {prev}件 → {sign}{d}</span>'

JST = datetime.timezone(datetime.timedelta(hours=9))
def jtime(iso):
    t = datetime.datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(JST)
    return f'{t.month}月{t.day}日 {t.hour}:{t.minute:02d}'

def news_fire_id(x): return 'n-' + x['id']
def town_link(ward, town):
    """町名から町ページへのリンク先（なければ区ページ）"""
    if town:
        t = TOWNS.get((ward, base_of(town)))
        if t: return t['file']
    w = by_name.get(ward)
    return f'{w["slug"]}.html' if w else 'index.html'

def news_list(items, show_ward=True, empty='直近30日に、この区の火事の報道は見つかっていません。'):
    """報道された火事の一覧。見出しの文章は載せず、場所・建物・けが人の有無だけを示して元記事へリンクする"""
    if not items: return f'<p class="muted small news-empty">{empty}</p>'
    lis = []
    for x in items:
        place = (esc(x['ward']) + ' ' if show_ward else '') + (esc(x['town']) + (f'{x["chome"]}丁目' if x.get('chome') else '') if x['town'] else '町名は報道で不明')
        tags = [f'<span class="tag">{esc(x["building"])}</span>'] if x['building'] != '建物不明' else []
        if not x.get('sensitive'):
            if x['dead']: tags.append('<span class="tag dark">亡くなった方あり</span>')
            elif x['injured']: tags.append('<span class="tag warn">けが人あり</span>')
        srcs = '・'.join(f'<a href="{esc(s["link"])}" target="_blank" rel="noopener nofollow">{esc(s["name"])}</a>' for s in x['sources'])
        lis.append(f'<li class="news-item" data-ward="{esc(x["ward"])}"><div class="row"><a class="place" href="fire.html?id={esc(quote(news_fire_id(x)))}"><b>{place}</b></a>{"".join(tags)}</div>'
                   f'<span class="small muted">最初の報道 {jtime(x["first"])}　報道：{srcs}</span></li>')
    return f'<ul class="news">{"".join(lis)}</ul>'

def news_for(ward_name, base=None):
    return [x for x in news['incidents'] if x['ward'] == ward_name and (base is None or (x['town'] and base_of(x['town']) == base))]
NEWS_NOTE = ('<p class="small muted">報道各社のニュースから、23区内の火事の場所（町名まで）・建物の種類・けが人の有無だけを自動で取り出しています。'
             '詳しい内容はリンク先の記事でご確認ください。報道されない小さな火事は載りません。' +
             (f'最終確認：{jtime(news["collectedAt"])}' if news['collectedAt'] else '') + '</p>')

def report_block(ward=None, town=None, title='見た・聞いたを報告する'):
    """目撃報告ボタン。区ページ・町ページは区（と町）を固定、トップは区を選ぶ"""
    if ward:
        dl = f'dl-{ward["slug"]}'
        opts = ''.join(f'<option value="{esc(t["base"])}">' for t in towns_of(ward['name']))
        ex = town or (towns_of(ward['name']) or [{'base': ''}])[0]['base']
        sel = (f'<input type="hidden" name="ward" value="{esc(ward["name"])}">'
               f'<label class="small" for="town-{dl}">町名（丁目まで。任意）</label>'
               f'<input id="town-{dl}" class="town-in" name="town" maxlength="20" list="{dl}" value="{esc(town or "")}" placeholder="例：{esc(ex)}2丁目" autocomplete="off">'
               f'<datalist id="{dl}">{opts}</datalist>')
    else:
        opts = ''.join(f'<option>{esc(w["name"])}</option>' for w in sorted(wards, key=lambda w: w['name']))
        sel = (f'<label class="small" for="rep-ward">区</label><select id="rep-ward" name="ward"><option value="">区を選ぶ</option>{opts}</select>'
               f'<label class="small" for="rep-town">町名（丁目まで。任意）</label><input id="rep-town" class="town-in" name="town" maxlength="20" placeholder="例：赤羽西2丁目" autocomplete="off">')
    wattr = f' data-ward="{esc(ward["name"])}"' if ward else ''
    return (f'<div class="panel report" data-reports{wattr}>'
            f'<h3>{esc(title)}</h3>'
            '<p class="small muted">押すと、同じ町の近くの人の報告とまとめて「火事のページ」ができます。消防への通報にはなりません。<strong>火や煙が見えたら119番へ。</strong></p>'
            f'<form class="report-form">{sel}'
            '<button type="button" class="btn ghost geo-fill" hidden>現在地の町名を入れる</button>'
            '<div class="btn-row kinds"><button type="submit" class="btn" name="kind" value="siren">サイレンが聞こえた</button>'
            '<button type="submit" class="btn" name="kind" value="smoke">煙・においがする</button>'
            '<button type="submit" class="btn primary" name="kind" value="fire">火が見える</button></div>'
            '</form><p class="report-status small" aria-live="polite"></p></div>')

def comment_block(ward, town=None, inc=None, title='口コミを書く'):
    """口コミの一覧と投稿欄（電話帳ナビのように、町・火事ごとに書き込める）"""
    attrs = f'data-ward="{esc(ward)}"' + (f' data-town="{esc(town)}"' if town else '') + (f' data-inc="{esc(inc)}"' if inc else '')
    fid = 'com-' + re.sub(r'[^0-9a-zA-Z]', '', quote(f'{ward}{town or ""}{inc or ""}'))[:40]
    return (f'<div class="comments" data-comments {attrs}>'
            '<ul class="com-list" aria-live="polite"><li class="muted small">口コミを読み込んでいます…</li></ul>'
            '<form class="com-form panel">'
            f'<label for="{fid}"><strong>{esc(title)}</strong> <span class="small muted">（200文字まで・匿名）</span></label>'
            f'<textarea id="{fid}" name="body" maxlength="200" rows="3" placeholder="例：黒い煙が北の方に見えます。消防車が5台ほど来ています。"></textarea>'
            '<p class="small muted">見えたこと・聞こえたことを書いてください。番地や人の名前、原因や被害者についての憶測は書かないでください。<a href="rules.html">投稿のルール</a></p>'
            '<div class="row"><button class="btn primary" type="submit">投稿する</button><span class="com-status small" aria-live="polite"></span></div>'
            '</form></div>')

def sns_links(words):
    """X・Yahoo!リアルタイム検索・Googleニュースで、その場所の火事を探すリンク"""
    q = ' '.join(words) + ' 火事'
    return ('<div class="btn-row sns">'
            f'<a class="btn" href="https://x.com/search?q={quote(q)}&amp;f=live" target="_blank" rel="noopener">Xで「{esc(q)}」を見る</a>'
            f'<a class="btn" href="https://search.yahoo.co.jp/realtime/search?p={quote(q)}" target="_blank" rel="noopener">Yahoo!リアルタイム検索</a>'
            f'<a class="btn" href="https://news.google.com/search?q={quote(q)}&amp;hl=ja&amp;gl=JP&amp;ceid=JP:ja" target="_blank" rel="noopener">ニュースを探す</a>'
            '</div>')

def live_block(ward=None, town=None, empty=None):
    """いま報告が上がっている火事（受付サーバーから読み込み）"""
    attrs = (f' data-ward="{esc(ward)}"' if ward else '') + (f' data-town="{esc(town)}"' if town else '')
    empty = empty or ('この町から、いま上がっている報告はありません。' if town else f'{ward}から、いま上がっている報告はありません。' if ward else 'いま、23区内で上がっている報告はありません。')
    return f'<div class="live" data-live{attrs} data-empty="{esc(empty)}"><p class="muted small live-loading">いまの報告を読み込んでいます…</p></div>'

TOWN_INDEX_JSON = json.dumps([{'w': t['ward'], 't': t['base'], 'f': t['file'], 'p': ' '.join(t['parts'])[:80]} for t in TOWN_LIST], ensure_ascii=False).replace('</', '<\\/')

def search_block(autofocus=False):
    """町名検索（トップ・町名で探す）と現在地から探す"""
    return (f'<div class="search big-search" data-search><label for="q" class="sr">町名・区名で探す</label>'
            f'<div class="search-row"><input id="q" type="search" inputmode="search" autocomplete="off" placeholder="町名を入力（例：赤羽、豊洲、三軒茶屋）"{" autofocus" if autofocus else ""} aria-describedby="q-count">'
            '<button type="button" class="btn geo-go">現在地</button></div>'
            '<p id="q-count" class="small muted" aria-live="polite"></p><div class="results q-results"></div></div>'
            f'<script type="application/json" id="town-index">{TOWN_INDEX_JSON}</script>')

# ---------- 部品 ----------
FIRE_ICON = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c2341c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-10z"/></svg>'
NAV = [('index', 'いまの火事'), ('towns', '町名で探す'), ('dial', 'サイレン・119'), ('ranking', '火災件数の統計'), ('rules', '投稿のルール'), ('about', '出典')]

def page(name, title, desc, body, og_image='og/index.png', full=True):
    nav = ''.join(f'<a href="{k}.html"{" aria-current=\"page\"" if k == name else ""}>{esc(v)}</a>' for k, v in NAV)
    canon = f'{SITE_URL}/{name}.html' if SITE_URL else f'{name}.html'
    ogimg = f'{SITE_URL}/{og_image}' if SITE_URL else og_image
    head = f'''<title>{esc(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="{esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{SITE_NAME}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:image" content="{esc(ogimg)}">
<meta property="og:url" content="{esc(canon)}">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#c2341c">
<meta name="kaji23-api" content="{esc(REPORTS_API)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Barlow+Condensed:wght@500;600&family=Zen+Kaku+Gothic+New:wght@700;900&display=swap">
<link rel="stylesheet" href="assets/site.css">'''
    ld = {"@context": "https://schema.org", "@type": "WebPage", "name": title, "description": desc, "inLanguage": "ja",
          "isPartOf": {"@type": "WebSite", "name": SITE_NAME}}
    head += f'\n<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>'
    header = f'''<header class="site-head"><div class="wrap">
  <div class="head-row">
    <a class="logo" href="index.html">{FIRE_ICON}<span>火事どこ<b>23区</b></span></a>
    <div class="tel-chip">火事の確認は<br><strong>{TEL["fire_info"]["tel"]}</strong></div>
  </div>
  <nav class="nav" aria-label="サイト内">{nav}</nav>
</div></header>'''
    footer = f'''<footer class="site-foot"><div class="wrap foot-grid">
  <div>
    <h3>{SITE_NAME}について</h3>
    <p>「近くで火事？」を町名で確かめられる、民間の非公式サイトです。利用者の目撃報告・口コミ、報道、東京消防庁などの公開情報をまとめています。報告や口コミは利用者の投稿で、内容を確認したものではありません。東京消防庁・各区の公認や監修は受けていません。</p>
    <p style="margin-top:8px"><strong style="color:var(--ink)">火や煙が見えたら、すぐ119番。</strong>火事かどうかの確認だけで119番にかけないでください。</p>
  </div>
  <div><h3>さがす</h3><ul>
    <li><a href="index.html">いまの火事</a></li><li><a href="towns.html">町名で探す</a></li><li><a href="index.html#wards">区から探す</a></li><li><a href="ranking.html">火災件数の統計</a></li></ul></div>
  <div><h3>確かめる</h3><ul>
    <li><a href="dial.html">サイレンが聞こえたら</a></li><li><a href="rules.html">投稿のルール・削除依頼</a></li><li><a href="about.html">データの出典と集め方</a></li>
    <li><a href="{TFD}/" rel="noopener" target="_blank">東京消防庁 ↗</a></li><li><a href="https://disaportal.gsi.go.jp/" rel="noopener" target="_blank">ハザードマップポータル ↗</a></li></ul></div>
</div><div class="wrap small muted" style="padding-block:0 20px">データ取得：{FETCHED_LABEL}（東京消防庁 各消防署ページ）／人口：{jdate(pop["asof"])}現在（東京都の統計）　© {THIS_YEAR} {SITE_NAME}</div></footer>
<script src="assets/site.js" defer></script>'''
    inner = f'{head}\n{header}\n<main>\n{body}\n</main>\n{footer}'
    if full:
        return f'<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n{inner.replace(header, "</head><body>" + header, 1)}\n</body>\n</html>\n'
    return inner + '\n'

ALERT = f'''<div class="alert" role="note"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9e2914" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
<p><strong>火や煙が見えたらすぐ119番。</strong>出動中の火事を確かめたいときは、東京消防庁の災害情報案内 <strong class="num">{TEL["fire_info"]["tel"]}</strong> へ（119番は使わないでください）。</p></div>'''

def share_block(text, path):
    url = f'{SITE_URL}/{path}' if SITE_URL else ''
    from urllib.parse import quote
    x = f'https://twitter.com/intent/tweet?text={quote(text)}' + (f'&url={quote(url)}' if url else '')
    line = f'https://social-plugins.line.me/lineit/share?url={quote(url)}' if url else f'https://line.me/R/msg/text/?{quote(text)}'
    return f'''<div class="share" aria-label="シェア">
  <a class="btn" href="{esc(x)}" target="_blank" rel="noopener">Xでシェア</a>
  <a class="btn" href="{esc(line)}" target="_blank" rel="noopener">LINEで送る</a>
  <button class="btn" type="button" data-copy="{esc(text + (' ' + url if url else ''))}">文章をコピー</button>
</div>'''

def bar_chart(series, cur_value=None, label='火災件数（年間）'):
    """series: {year: count}。今年の途中値は朱色で最後に置く。"""
    items = [(str(y), v, False) for y, v in sorted(series.items())][-6:]
    if cur_value is not None: items.append((f'{THIS_YEAR}*', cur_value, True))
    if not items: return ''
    W, H, top, bottom = 320, 132, 18, 22
    vmax = max(v for _, v, _ in items) or 1
    bw = min(36, (W - 10) / len(items) - 10)
    gap = (W - bw * len(items)) / (len(items) + 1)
    out = [f'<svg class="chart" viewBox="0 0 {W} {H}" role="img" aria-label="{esc(label)}">']
    out.append(f'<line class="base" x1="0" x2="{W}" y1="{H-bottom}" y2="{H-bottom}"/>')
    for i, (lab, v, cur) in enumerate(items):
        x = gap + i * (bw + gap)
        h = (H - top - bottom) * v / vmax
        y = H - bottom - h
        out.append(f'<rect class="bar{" cur" if cur else ""}" x="{x:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{h:.1f}" rx="3"/>')
        out.append(f'<text class="v" x="{x+bw/2:.1f}" y="{y-4:.1f}" text-anchor="middle">{v}</text>')
        out.append(f'<text x="{x+bw/2:.1f}" y="{H-6}" text-anchor="middle">{lab}</text>')
    out.append('</svg>')
    return ''.join(out)

SRC_LABEL = {'ytd': '今年の件数', 'prevSame': '前年同時期'}

def prov_block(st):
    lines = []
    for key in ('ytd', 'prevSame'):
        if key in st['src']:
            lines.append(f'<span>{SRC_LABEL[key]}：<code>{esc(st["src"][key])}</code></span>')
    for y in sorted([k for k in st['src'] if re.fullmatch(r'y\d{4}', k)], reverse=True)[:1]:
        lines.append(f'<span>{y[1:]}年：<code>{esc(st["src"][y])}</code></span>')
    when = f'（{jdate(st["when"])}時点の掲載）' if st['when'] else ''
    warn = ''.join(f'<span>※{esc(w)}</span>' for w in st['warn'])
    return f'''<div class="prov"><span><strong>出典</strong>：<a href="{esc(st["url"])}" target="_blank" rel="noopener">{esc(st["name"])}「災害情報」ページ ↗</a>{when}</span>
{"".join(lines)}{warn}</div>'''

# ---------- 区ページ ----------
def ward_page(w):
    sts = w['stations']
    name = w['name']
    adj = [by_tfd[a] for a in ADJ[w['tfd']]]
    cards = []
    for st in sts:
        towns = st['towns']
        town_html = '、'.join(esc(t) for t in towns)
        if st['status'] == 'ok':
            top = f'''<div class="row"><span class="big">{st["ytd"]}<small>件</small></span><span class="muted small">{THIS_YEAR}年の火災（{jdate(st["when"]) + "時点" if st["when"] else "集計日の記載なし"}）</span></div>
<div class="row">{chg(st["ytd"], st["prev"])}{f'<span class="small muted">{THIS_YEAR-1}年は年間 {st["annual"][THIS_YEAR-1]}件</span>' if THIS_YEAR-1 in st["annual"] else ''}</div>'''
            chart = bar_chart(st['annual'], st['ytd'], f'{st["name"]}の火災件数の推移')
        elif st['status'] == 'annual-only':
            last = max(st['annual'])
            top = f'''<div class="row"><span class="big" style="color:var(--ink)">{st["annual"][last]}<small>件</small></span><span class="muted small">{last}年の年間火災件数</span></div>
<p class="small muted">この署は今年の件数をまだ掲載していません（年ごとの件数のみ）。</p>'''
            chart = bar_chart(st['annual'], None, f'{st["name"]}の火災件数の推移')
        else:
            top = '<p class="big">火災件数は未掲載</p><p class="small muted">この消防署のサイトには、火災件数のページがありません。件数は災害情報案内か、東京消防庁の年報で確認できます。</p>'
            chart = ''
        cls = ' none' if st['status'] == 'unpublished' else ''
        cards.append(f'''<article class="st-card{cls}" id="st-{st["slug"]}">
<header><h3>{esc(st["name"])}</h3><span class="small muted">管轄 {len(towns)}地区</span></header>
{top}
{chart}
{prov_block(st) if st['status'] != 'unpublished' else f'<div class="prov"><span><strong>確認先</strong>：<a href="{esc(st["url"])}" target="_blank" rel="noopener">{esc(st["name"])} ↗</a></span></div>'}
<details class="towns"><summary>{esc(st["name"])}が管轄する町名</summary><p>{town_html}</p></details>
</article>''')

    # 区のまとめ
    if w['ytd'] is not None:
        part = '' if w['complete'] else f'<p class="small muted">※区内{len(sts)}署のうち{w["n_ok"]}署の合計です（{len(sts) - w["n_ok"]}署は今年の件数を掲載していません）。</p>'
        when = f'{jdate(w["when_min"])}〜{jdate(w["when_max"])}' if w['when_min'] != w['when_max'] else jdate(w['when_min'])
        summary = f'''<div class="stats">
  <div class="stat hot"><span class="k">{THIS_YEAR}年の火災（{"区内全署" if w["complete"] else "掲載署の合計"}）</span><span class="v">{w["ytd"]}<small>件</small></span><span class="d">各署の集計時点：{when}</span></div>
  <div class="stat"><span class="k">前年同時期</span><span class="v">{fmt(w["prev"]) if w["prev"] is not None else "—"}<small>{"件" if w["prev"] is not None else ""}</small></span><span class="d">{chg(w["ytd"], w["prev"]) if w["prev"] is not None else "比較できる署がそろっていません"}</span></div>
  <div class="stat"><span class="k">人口10万人あたり</span><span class="v">{w["per100k"] if w["per100k"] is not None else "—"}<small>{"件" if w["per100k"] is not None else ""}</small></span><span class="d">{f'23区で{w["rank"]}番目に多い（{n_ranked}区中）' if w.get("rank") else "全署の件数がそろわないため算出していません"}</span></div>
  <div class="stat"><span class="k">人口・人口密度</span><span class="v">{w["pop"]//10000}<small>万人</small></span><span class="d">{fmt(w["density"])}人/km²（{jdate(pop["asof"])}）</span></div>
</div>{part}'''
    else:
        summary = '<p>この区の消防署は、今年の火災件数を掲載していません。</p>'

    ward_chart = ''
    if len(w['ward_annual']) >= 2:
        ward_chart = f'<div class="panel"><h3 style="font-size:15px">区全体の火災件数の推移（区内全署の合計）</h3>{bar_chart(w["ward_annual"], w["ytd"] if w["complete"] else None, name + "の火災件数の推移")}<p class="small muted">* は{THIS_YEAR}年の途中までの件数です。</p></div>'

    station_names = '・'.join(s['name'] for s in sts)
    share_text = (f'【{name}の火災】{THIS_YEAR}年はこれまでに{w["ytd"]}件' + (f'（前年同時期{w["prev"]}件）' if w['prev'] is not None else '') +
                  f'。消防署別の件数と管轄の町名まとめ（出典：東京消防庁） #{name} #火事') if w['ytd'] is not None else f'{name}の火事・消防署情報まとめ #{name}'
    title = f'{name}で火事？いまの目撃情報・口コミ・火災件数【町名別】｜{SITE_NAME}'
    desc = f'{name}で火事？サイレンや煙の目撃報告・口コミ・報道を、{len(towns_of(name))}の町ごとにリアルタイムでまとめています。消防署（{station_names}）ごとの火災件数も。'
    adj_links = ''.join(f'<a class="btn" href="{a["slug"]}.html">{esc(a["name"])}{f" {a["ytd"]}件" if a["ytd"] is not None else ""}</a>' for a in adj)
    body = f'''<div class="wrap">
<nav class="crumbs" aria-label="パンくず"><a href="index.html">トップ</a> ／ <a href="index.html#wards">東京23区</a> ／ {esc(name)}</nav>
<section class="hero">
  <span class="eyebrow">{esc(name)}の火事情報</span>
  <h1>{esc(name)}で火事？</h1>
  <p class="lead">{esc(name)}の目撃報告・口コミ・報道を、町ごとにリアルタイムでまとめています。町名を選ぶと、その町のページが開きます。</p>
  {ALERT}
</section>
<section class="section" aria-labelledby="now">
  <h2 id="now">いまの{esc(name)}</h2>
  {live_block(ward=name)}
  {report_block(w, title=f'{name}で気づいたことを報告')}
</section>
<section class="section" aria-labelledby="machi">
  <h2 id="machi">{esc(name)}の町から探す（{len(towns_of(name))}町）</h2>
  <div class="town-grid">{"".join(f'<a href="{t["file"]}">{esc(t["base"])}</a>' for t in towns_of(name))}</div>
</section>
<section class="section" aria-labelledby="news">
  <h2 id="news">{esc(name)}で報道された火事</h2>
  {news_list(news_for(name), show_ward=False)}
  {NEWS_NOTE}
</section>
<section class="section" aria-labelledby="sns">
  <h2 id="sns">SNS・ニュースで確かめる</h2>
  {sns_links([name])}
</section>
<section class="section" aria-labelledby="sum">
  <h2 id="sum">{esc(name)}の火災件数（統計）</h2>
  <p class="small muted">ここからは、東京消防庁の各消防署が公表している火災件数の統計です。</p>
  {summary}
  {ward_chart}
</section>
<section class="section" aria-labelledby="sts">
  <h2 id="sts">消防署ごとの火災件数</h2>
  <p class="muted small">各署のページは更新日がばらばらです。カードごとの「時点」を確認してください。</p>
  <div class="stations">{"".join(cards)}</div>
</section>
<section class="section" aria-labelledby="adj">
  <h2 id="adj">となりの区</h2>
  <div class="btn-row">{adj_links}</div>
</section>
</div>'''
    return page(w['slug'], title, desc, body, og_image=f'og/{w["slug"]}.png')

# ---------- トップ（いまの火事） ----------
def index_page(full=True):
    tiles = []
    for w in wards:
        r, c = w['pos']
        tiles.append(f'<a class="tile hx" style="grid-row:{r};grid-column:{c}" href="{w["slug"]}.html" data-ward-tile="{esc(w["name"])}">'
                     f'{esc(w["name"].replace("区", ""))}<span class="small tile-n"></span></a>')
    recent = [x for x in news['incidents']][:6]
    f_day = fire_d.get('day')
    body = f'''<div class="wrap">
<section class="hero">
  <span class="eyebrow">東京23区・町名ごとにリアルタイム</span>
  <h1><span class="nb">近くで火事？</span><span class="nb">町名で、いまの状況を。</span></h1>
  <p class="lead">サイレンや煙に気づいたら、町名を入れてください。近所の人の目撃報告・口コミと、報道された火事をその町のページにまとめています。</p>
  {search_block()}
  {ALERT}
</section>
<section class="section" aria-labelledby="now">
  <div class="sec-head"><h2 id="now">いま報告が上がっている場所</h2><span class="small muted live-updated"></span></div>
  {live_block(empty='いま、23区内で上がっている報告はありません。サイレンや煙に気づいたら、下のボタンで知らせてください。')}
</section>
<section class="section" aria-labelledby="rep">
  <h2 id="rep" class="sr">報告する</h2>
  {report_block(title='サイレン・煙・火に気づいたら')}
</section>
<section class="section" aria-labelledby="recent">
  <h2 id="recent">最近報道された23区の火事</h2>
  {news_list(recent, empty='直近30日に、23区の火事の報道は見つかっていません。')}
  {NEWS_NOTE}
</section>
<section class="section" id="wards" aria-labelledby="wh">
  <h2 id="wh">区から探す</h2>
  <p class="muted small">区を選ぶと、その区の町名一覧と、いまの報告が見られます。数字はいま上がっている報告の件数です。</p>
  <div class="tilemap">{"".join(tiles)}</div>
</section>
<section class="section" aria-labelledby="tfd">
  <h2 id="tfd">東京消防庁の発表（参考）</h2>
  <p>{esc(re.sub(r"^令和\\d+年|計$", "", daily["label"]))}の火災は<strong class="num">{fmt(f_day)}</strong>件、救急出動は<strong class="num">{fmt(daily["rows"].get("救急件数", {}).get("day"))}</strong>件でした（東京消防庁管内・速報値）。サイレンの多くは救急車です。<a href="ranking.html">区・消防署ごとの火災件数の統計</a></p>
</section>
</div>'''
    title = f'{SITE_NAME}｜近くで火事？東京23区の火事の目撃情報を町名でリアルタイムに'
    desc = '近くで火事？サイレンや煙に気づいたら町名で検索。東京23区の火事の目撃報告・口コミ・報道を、町ごとにリアルタイムでまとめています。'
    return page('index', title, desc, body, full=full)

# ---------- 町ページ ----------
def machi_page(t):
    w = by_name[t['ward']]
    base, ward = t['base'], t['ward']
    sts = [stations[s] for s in t['stations'] if s in stations]
    st_html = ''.join(
        f'<li><a href="{w["slug"]}.html#st-{s["slug"]}">{esc(s["name"])}</a>'
        + (f'<span class="small muted">　今年の火災 {s["ytd"]}件（{jdate(s["when"])}時点、署の管轄全体）</span>' if s['status'] == 'ok' else '')
        + '</li>' for s in sts)
    neighbors = [x for x in TOWN_LIST if x is not t and x['ward'] == ward and set(x['stations']) & set(t['stations'])][:40]
    nb_html = ''.join(f'<a href="{x["file"]}">{esc(x["base"])}</a>' for x in neighbors)
    parts = '、'.join(esc(p) for p in t['parts'])
    body = f'''<div class="wrap">
<nav class="crumbs" aria-label="パンくず"><a href="index.html">トップ</a> ／ <a href="{w["slug"]}.html">{esc(ward)}</a> ／ {esc(base)}</nav>
<section class="hero">
  <span class="eyebrow">{esc(ward)}{esc(base)}の火事情報</span>
  <h1>{esc(base)}（{esc(ward)}）で火事？</h1>
  <p class="lead">{esc(base)}付近の目撃報告と口コミを、リアルタイムで表示しています。サイレンや煙に気づいたら、報告ボタンで近所の人と共有できます。</p>
  {ALERT}
</section>
<section class="section" aria-labelledby="now">
  <h2 id="now">いまの{esc(base)}</h2>
  {live_block(ward=ward, town=base)}
  {report_block(w, town=base, title=f'{base}で気づいたことを報告')}
</section>
<section class="section" aria-labelledby="board">
  <h2 id="board">{esc(base)}の口コミ</h2>
  <p class="small muted">火事やサイレン、消防車について、{esc(base)}の人が書き込んだ口コミです。いま起きている火事の口コミは、上の「火事のページ」にあります。</p>
  {comment_block(ward, town=base, title=f'{base}の口コミを書く')}
</section>
<section class="section" aria-labelledby="sns">
  <h2 id="sns">SNS・ニュースで確かめる</h2>
  {sns_links([base])}
  <p class="small muted">外部サイトの検索結果です。投稿の内容は確かめられていないものも含みます。</p>
</section>
<section class="section" aria-labelledby="news">
  <h2 id="news">{esc(base)}で報道された火事</h2>
  {news_list(news_for(ward, base), show_ward=False, empty=f'直近30日に、{base}の火事の報道は見つかっていません。')}
</section>
<section class="section" aria-labelledby="st">
  <h2 id="st">{esc(base)}を受け持つ消防署</h2>
  <ul class="plain">{st_html}</ul>
  <p class="small muted">対象の地区：{parts}（東京消防庁の管轄区域表より）</p>
  {f'<h3 style="font-size:15px">同じ消防署が受け持つ近くの町</h3><div class="town-grid">{nb_html}</div>' if nb_html else ''}
</section>
</div>'''
    title = f'{base}（{ward}）の火事情報｜いまの目撃情報・口コミ｜{SITE_NAME}'
    desc = f'{ward}{base}で火事？サイレンや煙の目撃情報、近所の人の口コミ、報道された火事を町ごとにリアルタイムでまとめています。管轄は{"・".join(s["name"] for s in sts) or "東京消防庁"}。'
    return page(t['file'][:-5], title, desc, body, og_image='og/live.png')

# ---------- 火事のページ ----------
def fire_page():
    blob = json.dumps({news_fire_id(x): {k: x[k] for k in ('ward', 'town', 'chome', 'building', 'injured', 'dead', 'sensitive', 'first', 'last', 'sources')}
                       for x in news['incidents']}, ensure_ascii=False).replace('</', '<\\/')
    towns_blob = json.dumps({f'{t["ward"]}|{t["base"]}': t['file'] for t in TOWN_LIST}, ensure_ascii=False).replace('</', '<\\/')
    wards_blob = json.dumps({w['name']: w['slug'] for w in wards}, ensure_ascii=False)
    body = f'''<div class="wrap">
<nav class="crumbs" aria-label="パンくず"><a href="index.html">トップ</a> ／ <span class="f-crumb">火事のページ</span></nav>
<div data-fire>
<section class="hero">
  <span class="eyebrow f-kind">火事の目撃情報</span>
  <h1 class="f-title">火事のページ</h1>
  <p class="lead f-lead">読み込んでいます…</p>
  <div class="f-stats stats"></div>
  {ALERT}
</section>
<section class="section f-share-sec" aria-labelledby="share" hidden>
  <h2 id="share">近所の人に知らせる</h2>
  <p class="small muted">このページを共有すると、見た人も報告や口コミを追加できます。<strong>現場には近づかないでください。</strong></p>
  <div class="share f-share"></div>
</section>
<section class="section f-rep-sec" aria-labelledby="rep" hidden>
  <h2 id="rep">あなたも見た・聞いた？</h2>
  <div class="f-report"></div>
</section>
<section class="section" aria-labelledby="com">
  <h2 id="com">現場の口コミ</h2>
  <div class="f-comments"></div>
</section>
<section class="section f-news-sec" aria-labelledby="src" hidden>
  <h2 id="src">報道</h2>
  <div class="f-news"></div>
</section>
<section class="section" aria-labelledby="sns">
  <h2 id="sns">SNS・ニュースで確かめる</h2>
  <div class="f-sns"></div>
</section>
</div>
</div>
<script type="application/json" id="news-fires">{blob}</script>
<script type="application/json" id="town-files">{towns_blob}</script>
<script type="application/json" id="ward-files">{wards_blob}</script>'''
    title = f'火事の目撃情報｜{SITE_NAME}'
    desc = '近所の人から寄せられたサイレン・煙・火の目撃報告と、現場の口コミ。東京23区の火事を町名ごとにリアルタイムで。'
    return page('fire', title, desc, body, og_image='og/live.png')

# ---------- 投稿のルール ----------
def rules_page():
    body = f'''<div class="wrap">
<nav class="crumbs" aria-label="パンくず"><a href="index.html">トップ</a> ／ 投稿のルール</nav>
<section class="hero"><span class="eyebrow">報告・口コミを書く前に</span><h1>投稿のルールと削除依頼</h1>
<p class="lead">このサイトの報告と口コミは、近所の人どうしで「いま何が起きているか」を確かめるためのものです。火事にあった人や近所の人が傷つかないよう、次のルールを守ってください。</p></section>
<section class="section"><h2>書いてよいこと</h2>
<ul class="plain checks"><li>見えたこと・聞こえたこと（煙の色や方向、サイレン、消防車の台数、通行止めなど）</li><li>町名・丁目までの場所、目印になる大きな建物や交差点</li><li>火が消えた、消防車が引き上げたなどの様子</li></ul></section>
<section class="section"><h2>書かないでください</h2>
<ul class="plain ngs"><li>番地・部屋番号・表札など、家や人が特定できる情報</li><li>人の名前、顔や家の写真の場所、けがをした人についての憶測</li><li>原因や「放火」などの推測、誰かを責める書き込み、誹謗中傷</li><li>URL・電話番号・メールアドレス、宣伝</li></ul>
<p class="small muted">番地・電話番号・URLなどは、自動で投稿できないようにしています。</p></section>
<section class="section"><h2>不適切な口コミを見つけたら</h2>
<p>各口コミの「通報」を押してください。<strong>3人から通報があると自動で非表示</strong>になります。運営者も確認し、ルールに反するものは削除します。</p>
<p>ご自身や家族に関する書き込みの削除を急ぐ場合も、まず「通報」を押してください。そのうえで、下の欄から削除の依頼を送れます。</p>
<form class="panel contact-form"><label for="ct-body"><strong>削除の依頼・お問い合わせ</strong></label>
<textarea id="ct-body" name="body" rows="4" maxlength="1000" placeholder="対象のページ（町名や火事のページ）と、口コミの内容・投稿日時、削除してほしい理由を書いてください。"></textarea>
<div class="row"><button class="btn primary" type="submit">送信する</button><span class="ct-status small" aria-live="polite"></span></div>
<p class="small muted">返信が必要な場合のご連絡先は書かないでください（このフォームは返信できません）。内容は運営者だけが読みます。</p></form></section>
<section class="section"><h2>報告と口コミのしくみ</h2>
<ul class="plain"><li>報告と口コミは匿名です。会員登録はありません。</li>
<li>連投を防ぐため、送信元の情報を元に戻せない形（日ごとに変わるハッシュ）で一時的に使います。IPアドレスそのものは保存しません。</li>
<li>同じ町で2時間以内にあった報告は、同じ「火事のページ」にまとめます。</li>
<li>報告の明細は30日で削除します。</li>
<li>報告・口コミは利用者の投稿で、運営者が内容を確認したものではありません。消防への通報にもなりません。</li></ul></section>
</div>'''
    return page('rules', f'投稿のルールと削除依頼｜{SITE_NAME}', '火事どこ23区の目撃報告・口コミの投稿ルール、不適切な投稿の通報と削除依頼について。', body)

# ---------- 比較 ----------
def ranking_page():
    wrows = []
    for w in sorted(wards, key=lambda w: (w['per100k'] is None, -(w['per100k'] or 0))):
        note = '' if w['complete'] else f'<br><span class="small muted">{len(w["stations"]) - w["n_ok"]}署が今年分未掲載</span>'
        d = (w['ytd'] - w['prev']) if (w['ytd'] is not None and w['prev'] is not None) else None
        wrows.append(f'''<tr><td data-v="{esc(w["name"])}"><a href="{w["slug"]}.html">{esc(w["name"])}</a>{note}</td>
<td class="n" data-v="{w["per100k"] if w["per100k"] is not None else ""}">{w["per100k"] if w["per100k"] is not None else "—"}</td>
<td class="n" data-v="{w["ytd"] if w["ytd"] is not None else ""}">{fmt(w["ytd"])}</td>
<td class="n" data-v="{d if d is not None else ""}">{("+" if d and d > 0 else "") + str(d) if d is not None else "—"}</td>
<td class="n" data-v="{w["pop"]}">{fmt(w["pop"])}</td>
<td class="n" data-v="{w["density"]}">{fmt(w["density"])}</td></tr>''')
    srows = []
    for s in sorted(stations.values(), key=lambda s: (s['ytd'] is None, -(s['ytd'] or 0))):
        d = (s['ytd'] - s['prev']) if (s['ytd'] is not None and s['prev'] is not None) else None
        last = s['annual'].get(THIS_YEAR - 1)
        stat = {'ok': '', 'annual-only': '年ごとのみ', 'unpublished': '未掲載'}[s['status']]
        srows.append(f'''<tr><td data-v="{esc(s["name"])}"><a href="{s["ward_url"]}.html#st-{s["slug"]}">{esc(s["name"])}</a>{f'<br><span class="small muted">{stat}</span>' if stat else ''}</td>
<td data-v="{esc(s["ward_name"])}">{esc(s["ward_name"])}</td>
<td class="n" data-v="{s["ytd"] if s["ytd"] is not None else ""}">{fmt(s["ytd"])}</td>
<td class="n" data-v="{s["prev"] if s["prev"] is not None else ""}">{fmt(s["prev"])}</td>
<td class="n" data-v="{d if d is not None else ""}">{("+" if d and d > 0 else "") + str(d) if d is not None else "—"}</td>
<td class="n" data-v="{last if last is not None else ""}">{fmt(last)}</td>
<td data-v="{s["when"] or ""}">{esc(jdate(s["when"]) or "—")}</td>
<td><a href="{esc(s["url"])}" target="_blank" rel="noopener">公式 ↗</a></td></tr>''')
    body = f'''<div class="wrap">
<nav class="crumbs" aria-label="パンくず"><a href="index.html">トップ</a> ／ 区・消防署の比較</nav>
<section class="hero"><span class="eyebrow">{THIS_YEAR}年の火災件数</span><h1>23区と58消防署の火災件数を比べる</h1>
<p class="lead">区の件数は、区内の消防署が公表している件数の合計です。人口10万人あたりの件数は、区内の全署が今年の件数を掲載している区だけ計算しています。見出しを押すと並べ替えられます。</p></section>
<section class="section" aria-labelledby="w"><h2 id="w">区の比較</h2>
<div class="table-box"><table data-sortable><thead><tr>
<th data-sort="text"><button type="button">区</button></th><th class="n" data-sort="num" aria-sort="descending"><button type="button">10万人あたり</button></th>
<th class="n" data-sort="num"><button type="button">今年の件数</button></th><th class="n" data-sort="num"><button type="button">前年同時期比</button></th>
<th class="n" data-sort="num"><button type="button">人口</button></th><th class="n" data-sort="num"><button type="button">人口密度</button></th></tr></thead>
<tbody>{"".join(wrows)}</tbody></table></div>
<p class="small muted">人口・人口密度：東京都の統計「住民基本台帳による東京都の世帯と人口」{jdate(pop["asof"])}現在。前年同時期比は、区内全署が前年同時期の値を掲載している場合だけ表示しています。</p></section>
<section class="section" aria-labelledby="s"><h2 id="s">消防署の一覧</h2>
<div class="table-box"><table data-sortable><thead><tr>
<th data-sort="text"><button type="button">消防署</button></th><th data-sort="text"><button type="button">区</button></th>
<th class="n" data-sort="num" aria-sort="descending"><button type="button">今年</button></th><th class="n" data-sort="num"><button type="button">前年同時期</button></th>
<th class="n" data-sort="num"><button type="button">増減</button></th><th class="n" data-sort="num"><button type="button">{THIS_YEAR-1}年</button></th>
<th data-sort="text"><button type="button">時点</button></th><th>出典</th></tr></thead>
<tbody>{"".join(srows)}</tbody></table></div></section>
</div>'''
    return page('ranking', f'23区・消防署別の火災件数ランキング【{THIS_YEAR}年】｜{SITE_NAME}', f'東京23区の区別・消防署別の火災件数（{THIS_YEAR}年）と人口10万人あたりの件数、前年同時期との比較。東京消防庁の公開データから集計。', body)

# ---------- 町名検索 ----------
def towns_page():
    groups = ''.join(f'<details class="towns"><summary>{esc(w["name"])}（{len(towns_of(w["name"]))}町）</summary><div class="town-grid">'
                     + ''.join(f'<a href="{t["file"]}">{esc(t["base"])}</a>' for t in towns_of(w["name"])) + '</div></details>'
                     for w in sorted(wards, key=lambda w: w['name']))
    body = f'''<div class="wrap">
<nav class="crumbs" aria-label="パンくず"><a href="index.html">トップ</a> ／ 町名で探す</nav>
<section class="hero"><span class="eyebrow">東京23区の{len(TOWN_LIST)}町</span><h1>町名で探す</h1>
<p class="lead">町名を入れると、その町のページが開きます。町のページでは、いまの目撃報告・口コミ・報道された火事・受け持つ消防署が見られます。</p>
{search_block(autofocus=True)}</section>
<section class="section"><h2>区ごとの町名一覧</h2>{groups}</section>
</div>'''
    return page('towns', f'町名で探す：東京23区の火事の目撃情報・口コミ（{len(TOWN_LIST)}町）｜{SITE_NAME}', f'東京23区の{len(TOWN_LIST)}町について、町名からいまの火事の目撃情報・口コミ・報道を調べられます。', body)

# ---------- サイレン ----------
def dial_page():
    fi, ems = TEL['fire_info'], TEL['ems_consult']
    body = f'''<div class="wrap">
<nav class="crumbs" aria-label="パンくず"><a href="index.html">トップ</a> ／ サイレンが聞こえたら</nav>
<section class="hero"><span class="eyebrow">119番の前に知っておきたいこと</span><h1>サイレンが聞こえたら</h1>
<p class="lead">「今のサイレンは火事？」と気になっても、確認のために119番へかけるのはやめましょう。本当の通報がつながりにくくなります。迷ったときは次の順で。</p></section>
<section class="section"><ol class="steps">
<li><span><strong>火や煙が見える・焦げたにおいが強い</strong><br>すぐに119番。住所と目印を落ち着いて伝えます。</span></li>
<li><span><strong>出動中の火事を確かめたい</strong><br>東京消防庁の{esc(fi["name"])}へ。{esc(fi["note"])}<br><span class="tel-big">{esc(fi["tel"])}</span><span class="small muted">（{esc(fi["area"])}）</span></span></li>
<li><span><strong>具合が悪い人がいて、救急車を呼ぶか迷う</strong><br>{esc(ems["name"])}へ。{esc(ems["note"])}<br><span class="tel-big">{esc(ems["tel"])}</span><span class="small muted">（つながらない場合 {esc(ems["alt"])}）</span></span></li>
<li><span><strong>近所で何が起きているか知りたい</strong><br><a href="towns.html">町名で探す</a>と、近所の人の目撃報告と口コミが見られます。気づいたことを報告することもできます。</span></li>
</ol>
<p class="small muted">電話番号の出典：<a href="{esc(contacts["url"])}" target="_blank" rel="noopener">{esc(contacts["source"])}</a>（{jdate(contacts["checked"])}確認）。電話番号の表示は、タップしても発信できない場合があります。</p></section>
<section class="section"><h2>火事に気づいたら</h2>
<div class="stats">
<div class="stat"><span class="k">知らせる</span><span class="d" style="color:var(--ink);font-size:15px">大声で周りに知らせ、119番。</span></div>
<div class="stat"><span class="k">消す</span><span class="d" style="color:var(--ink);font-size:15px">初期消火は火が天井に届くまで。無理だと思ったらすぐ離れる。</span></div>
<div class="stat"><span class="k">逃げる</span><span class="d" style="color:var(--ink);font-size:15px">煙を吸わないよう姿勢を低く。取りに戻らない。</span></div>
</div>
<p><a href="{TFD}/" target="_blank" rel="noopener">東京消防庁のサイトで詳しく見る ↗</a>　<a href="https://disaportal.gsi.go.jp/" target="_blank" rel="noopener">ハザードマップポータル ↗</a></p></section>
</div>'''
    return page('dial', f'サイレンが聞こえたら：119番と災害情報案内の使い分け（東京23区）｜{SITE_NAME}', '火事かどうかの確認に119番は使わないで。東京消防庁の災害情報案内（03-3212-2119）と救急相談センター（#7119）の使い分け。', body)

# ---------- 出典 ----------
def about_page(report):
    unpub = '、'.join(f'{s["name"]}（{s["ward_name"]}）' for s in stations.values() if s['status'] == 'unpublished')
    annual = '、'.join(f'{s["name"]}（{s["ward_name"]}）' for s in stations.values() if s['status'] == 'annual-only')
    rep = ''
    if report:
        rows = ''.join(f'<tr><td>{esc(c["name"])}</td><td>{"合格" if c["ok"] else "要確認"}</td><td class="small">{esc(c["detail"])}</td></tr>' for c in report['checks'])
        rep = f'''<section class="section" aria-labelledby="ver"><h2 id="ver">自動チェックの結果</h2>
<p class="muted">サイトを作るたびに、データと表示を自動で検査しています。最終実行：{esc(report["ran_at"])}</p>
<div class="table-box"><table><thead><tr><th>項目</th><th>結果</th><th>内容</th></tr></thead><tbody>{rows}</tbody></table></div></section>'''
    body = f'''<div class="wrap">
<nav class="crumbs" aria-label="パンくず"><a href="index.html">トップ</a> ／ データの出典</nav>
<section class="hero"><span class="eyebrow">出典と集め方</span><h1>データの出典と集め方</h1>
<p class="lead">{SITE_NAME}の数字は、すべて東京消防庁と東京都が公開しているページから、プログラムで毎日読み取っています。人の手で数字を打ち込むことはしていません。</p></section>
<section class="section" aria-labelledby="src"><h2 id="src">使っているデータ</h2>
<div class="table-box"><table><thead><tr><th>データ</th><th>出典</th><th>使い方</th></tr></thead><tbody>
<tr><td>消防署ごとの火災件数</td><td><a href="{TFD}/fs/index.html" target="_blank" rel="noopener">東京消防庁 各消防署「災害情報」ページ</a></td><td>今年の累計・前年同時期・過去の年間件数</td></tr>
<tr><td>町名と管轄消防署の対応</td><td><a href="{TFD}/fs/index.html" target="_blank" rel="noopener">東京消防庁「住所から管轄消防署を探す」</a></td><td>{fmt(TOTAL_TOWNS)}地区を58署に対応づけ</td></tr>
<tr><td>東京消防庁全体の日次件数</td><td><a href="{esc(daily["url"])}" target="_blank" rel="noopener">東京消防庁「災害・救急情報」</a></td><td>前日の火災・救急件数と今年の累計</td></tr>
<tr><td>人口・世帯数・人口密度</td><td><a href="{esc(pop["url"])}" target="_blank" rel="noopener">東京都の統計「住民基本台帳による東京都の世帯と人口」</a></td><td>人口10万人あたりの件数（{jdate(pop["asof"])}現在）</td></tr>
<tr><td>電話番号</td><td><a href="{esc(contacts["url"])}" target="_blank" rel="noopener">{esc(contacts["source"])}</a></td><td>災害情報案内・救急相談センター</td></tr>
</tbody></table></div></section>
<section class="section" aria-labelledby="how"><h2 id="how">集め方</h2>
<ol class="steps">
<li><span>23区それぞれの「住所から管轄消防署を探す」表を読み、町名と消防署の対応を作ります。</span></li>
<li><span>58署それぞれのトップページから「災害情報」「災害状況」などのページを自動で見つけます。</span></li>
<li><span>署ごとに書式が違う表を読み分けます。「本年累計」「今年」は今年の件数、「前年同期」「昨年同日」は前年同時期、「令和7年中」「昨年総件数」は前年の年間件数として扱い、「増減」「前年比」の列は使いません。東京消防庁全体の数字が並ぶ列も除きます。</span></li>
<li><span>読み取った値ごとに、表のどの行・どの見出しから取ったかを記録し、区ページの各カードに表示します。</span></li>
<li><span>前年同時期の値が今年の3倍を大きく超えるなど、明らかに不自然な値は採用せず、その旨を表示します。</span></li>
</ol></section>
<section class="section" aria-labelledby="cov"><h2 id="cov">集計できていない消防署</h2>
<p><strong>今年の件数を掲載していない署（年ごとの件数のみ）</strong>：{esc(annual) or "なし"}</p>
<p><strong>火災件数のページがない署</strong>：{esc(unpub) or "なし"}</p>
<p class="muted small">これらの署がある区では、区の合計は「掲載署の合計」となり、人口あたりの比較から外しています。</p></section>
{rep}
<section class="section" aria-labelledby="note"><h2 id="note">ご利用にあたって</h2>
<p>このサイトは民間が独自に運営する非公式サイトです。東京消防庁・東京都・各区の公認や監修は受けていません。各消防署のページは更新日がばらばらで、集計時点がそろっていません。数字が食い違う場合は公式発表を優先してください。現在発生中の火事を知らせるサービスではありません。火や煙を見たら119番へ通報してください。</p>
<p class="muted small">運営者・お問い合わせ：[運営者名・連絡先を記入]</p></section>
</div>'''
    return page('about', f'データの出典と集め方｜{SITE_NAME}', f'{SITE_NAME}の火災件数・管轄区域・人口データの出典と、各消防署ページからの読み取り方法、自動チェックの結果。', body)

def build(report=None):
    # og/（OGP画像）は og.js が作るので残す
    if DIST.exists():
        for p in DIST.iterdir():
            if p.name == 'og': continue
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    (DIST / 'assets').mkdir(parents=True, exist_ok=True)
    (DIST / 'data').mkdir(exist_ok=True)
    for f in ('site.css', 'site.js'):
        shutil.copy(SITE / 'assets' / f, DIST / 'assets' / f)
    pages = {'index.html': index_page(), 'ranking.html': ranking_page(), 'towns.html': towns_page(),
             'dial.html': dial_page(), 'about.html': about_page(report), 'fire.html': fire_page(), 'rules.html': rules_page()}
    for w in wards: pages[w['slug'] + '.html'] = ward_page(w)
    for t in TOWN_LIST: pages[t['file']] = machi_page(t)
    for fn, h in pages.items(): (DIST / fn).write_text(h, encoding='utf-8')
    # 公開データ（誰でも検証できるように）
    public = {'fetchedAt': tfd['fetchedAt'], 'source': tfd_file, 'population_source': pop['url'], 'daily': daily,
              'news': {'collectedAt': news['collectedAt'], 'incidents': [{k: x[k] for k in ('id', 'ward', 'town', 'chome', 'building', 'injured', 'dead', 'first', 'sources')} for x in news['incidents']]},
              'wards': [{k: w[k] for k in ('slug', 'name', 'code', 'ytd', 'prev', 'complete', 'per100k', 'pop', 'households', 'density')}
                        | {'stations': [s['slug'] for s in w['stations']]} for w in wards],
              'stations': [{k: s[k] for k in ('slug', 'name', 'ward', 'url', 'status', 'ytd', 'prev', 'annual', 'when', 'src', 'warn')}
                           | {'towns': s['towns']} for s in stations.values()]}
    (DIST / 'data' / 'kaji23.json').write_text(json.dumps(public, ensure_ascii=False, indent=1), encoding='utf-8')
    # 内部用（OG画像・検査で使う）
    (DIST / 'data' / '_model.json').write_text(json.dumps({'wards': [{k: v for k, v in w.items() if k != 'stations'} | {'stations': [s['slug'] for s in w['stations']]} for w in wards],
                                                            'stations': stations, 'daily': daily, 'n_ranked': n_ranked, 'news': news,
                                                            'towns': [{k: t[k] for k in ('ward', 'base', 'file', 'stations')} for t in TOWN_LIST]}, ensure_ascii=False, default=str), encoding='utf-8')
    return sorted(pages)

if __name__ == '__main__':
    rp = DIST.parent / 'verify' / 'report.json'
    report = json.load(open(rp, encoding='utf-8')) if rp.exists() else None
    files = build(report)
    print(f'built {len(files)} pages →', DIST)
