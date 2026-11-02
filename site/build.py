#!/usr/bin/env python3
"""火事どこ23区 静的サイト生成
入力: data/raw/tfd_*.json（東京消防庁から収集）, pop_*.json（東京都の統計）, contacts.json
出力: dist/（そのまま公開できる静的サイト）
"""
import json, re, html, glob, os, shutil, datetime
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
        lis.append(f'''<li class="news-item" data-ward="{esc(x["ward"])}"><div class="row"><b>{place}</b>{"".join(tags)}</div>
<span class="small muted">最初の報道 {jtime(x["first"])}　報道：{srcs}</span></li>''')
    return f'<ul class="news">{"".join(lis)}</ul>'

def news_for(ward_name): return [x for x in news['incidents'] if x['ward'] == ward_name]
NEWS_NOTE = ('<p class="small muted">報道各社のニュースから、23区内の火事の場所（町名まで）・建物の種類・けが人の有無だけを自動で取り出しています。'
             '内容の詳細や原因は、リンク先の記事でご確認ください。報道されない小さな火事は載りません。' +
             (f'最終確認：{jtime(news["collectedAt"])}' if news['collectedAt'] else '') + '</p>')

def report_block(ward=None):
    """「サイレンが聞こえた」報告（区ページは区を固定、トップは区を選ぶ）"""
    if ward:
        sel = f'<input type="hidden" name="ward" value="{esc(ward["name"])}"><input class="town-in" name="town" maxlength="20" placeholder="町名（任意。例：{esc(re.sub(r'[0-9０-９～・、（].*$', '', (ward["stations"][0]["towns"] or ["　"])[0]))}）" aria-label="町名（任意）">'
    else:
        opts = ''.join(f'<option>{esc(w["name"])}</option>' for w in sorted(wards, key=lambda w: w['name']))
        sel = f'<select name="ward" aria-label="区"><option value="">区を選ぶ</option>{opts}</select><input class="town-in" name="town" maxlength="20" placeholder="町名（任意）" aria-label="町名（任意）">'
    return f'''<div class="panel report" data-reports data-api="{esc(REPORTS_API)}" {f'data-ward="{esc(ward["name"])}"' if ward else ''}>
<h3 style="font-size:15px">いま、サイレンが聞こえた？</h3>
<p class="small muted">近くの人が同じボタンを押すと、この欄に件数が出ます。消防への通報にはなりません。火や煙が見えたら119番へ。</p>
<form class="report-form">{sel}
<div class="btn-row"><button type="submit" class="btn" name="kind" value="siren">サイレンが聞こえた</button><button type="submit" class="btn" name="kind" value="smoke">煙・においがする</button><button type="submit" class="btn primary" name="kind" value="fire">火が見える</button></div>
</form>
<p class="report-status small" aria-live="polite"></p>
<div class="report-list small"></div>
</div>'''

# ---------- 部品 ----------
FIRE_ICON = '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c2341c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-10z"/></svg>'
NAV = [('index', 'トップ'), ('ranking', '区・署の比較'), ('towns', '町名で探す'), ('dial', 'サイレン・119'), ('about', 'データの出典')]

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
    <p>東京消防庁と各消防署・東京都が公開している情報を、毎日自動で集めて区・消防署・町名ごとに整理している民間の非公式サイトです。東京消防庁・各区の公認や監修は受けていません。数字が食い違うときは、各ページの出典リンク先（公式発表）を優先してください。</p>
    <p style="margin-top:8px"><strong style="color:var(--ink)">火や煙が見えたら、すぐ119番。</strong>火事かどうかの確認だけで119番にかけないでください。</p>
  </div>
  <div><h3>さがす</h3><ul>
    <li><a href="index.html#wards">区から探す</a></li><li><a href="towns.html">町名で探す</a></li><li><a href="ranking.html">区・消防署の比較</a></li></ul></div>
  <div><h3>確かめる</h3><ul>
    <li><a href="dial.html">サイレンが聞こえたら</a></li><li><a href="about.html">データの出典と集め方</a></li>
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
    title = f'{name}の火事・火災件数【{THIS_YEAR}年】消防署別まとめ｜{SITE_NAME}'
    desc = (f'{name}の今年の火災は{w["ytd"]}件（{station_names}の公表値の合計）。' if w['ytd'] is not None else f'{name}の消防署（{station_names}）の情報。') + \
           f'消防署ごとの件数、前年との比較、管轄の町名、人口あたりの件数を東京消防庁の公開データからまとめています。'
    adj_links = ''.join(f'<a class="btn" href="{a["slug"]}.html">{esc(a["name"])}{f" {a["ytd"]}件" if a["ytd"] is not None else ""}</a>' for a in adj)
    body = f'''<div class="wrap">
<nav class="crumbs" aria-label="パンくず"><a href="index.html">トップ</a> ／ <a href="index.html#wards">東京23区</a> ／ {esc(name)}</nav>
<section class="hero">
  <span class="eyebrow">{esc(name)}の火事情報</span>
  <h1>{esc(name)}の火事・火災件数</h1>
  <p class="lead">{esc(name)}を管轄する{len(sts)}つの消防署（{esc(station_names)}）が公表している火災件数を、毎日集めてまとめています。数字の横に、元のページで読み取った箇所を載せています。</p>
  {ALERT}
</section>
<section class="section" aria-labelledby="sum">
  <h2 id="sum">{esc(name)}のまとめ</h2>
  {summary}
  {ward_chart}
  {share_block(share_text, w["slug"] + ".html")}
</section>
<section class="section" aria-labelledby="sts">
  <h2 id="sts">消防署ごとの火災件数</h2>
  <p class="muted small">各署のページは更新日がばらばらです。カードごとの「時点」を確認してください。</p>
  <div class="stations">{"".join(cards)}</div>
</section>
<section class="section" aria-labelledby="news">
  <h2 id="news">{esc(name)}の最近の火事（報道）</h2>
  {news_list(news_for(name), show_ward=False)}
  {NEWS_NOTE}
  {report_block(w)}
</section>
<section class="section" aria-labelledby="siren">
  <h2 id="siren">{esc(name)}でサイレンが聞こえたら</h2>
  <ol class="steps">
    <li><span><strong>火や煙が見える、焦げたにおいが強い</strong><br>すぐに119番へ通報してください。</span></li>
    <li><span><strong>どこで何が起きたか確かめたい</strong><br>東京消防庁の災害情報案内 <span class="num" style="font-size:18px">{TEL["fire_info"]["tel"]}</span> で、出動中の災害を案内しています（場所は番地を伏せて案内）。</span></li>
    <li><span><strong>救急車かもしれない</strong><br>サイレンの多くは救急出動です。東京消防庁全体では1日に{fmt(daily["rows"].get("救急件数", {}).get("day"))}件の救急出動がありました（{esc(daily["label"])}）。</span></li>
  </ol>
</section>
<section class="section" aria-labelledby="adj">
  <h2 id="adj">となりの区</h2>
  <div class="btn-row">{adj_links}</div>
</section>
</div>'''
    return page(w['slug'], title, desc, body, og_image=f'og/{w["slug"]}.png')

# ---------- トップ ----------
def index_page(full=True):
    tiles = []
    for w in wards:
        r, c = w['pos']
        lab = f'<span class="num">{w["per100k"]}</span>' if w['per100k'] is not None else '<span class="small">一部未掲載</span>'
        tiles.append(f'<a class="tile {heat(w["per100k"])}" style="grid-row:{r};grid-column:{c}" href="{w["slug"]}.html" aria-label="{esc(w["name"])}：{"人口10万人あたり" + str(w["per100k"]) + "件" if w["per100k"] is not None else "一部の署が件数未掲載"}">{esc(w["name"].replace("区", ""))}{lab}</a>')
    top5 = ranked[:5]
    rising = sorted([s for s in stations.values() if s['status'] == 'ok' and s['prev']], key=lambda s: -(s['ytd'] - s['prev']))[:5]
    top_rows = ''.join(f'<tr><td><a href="{w["slug"]}.html">{esc(w["name"])}</a></td><td class="n">{w["per100k"]}</td><td class="n">{w["ytd"]}</td></tr>' for w in top5)
    rise_rows = ''.join(f'<tr><td><a href="{s["ward_url"]}.html#st-{s["slug"]}">{esc(s["name"])}</a><br><span class="small muted">{esc(s["ward_name"])}</span></td><td class="n">{s["ytd"]}</td><td class="n">{s["prev"]}</td><td class="n">+{s["ytd"] - s["prev"]}</td></tr>' for s in rising)
    total_ytd = sum(w['ytd'] for w in wards if w['ytd'] is not None)
    body = f'''<div class="wrap">
<section class="hero">
  <span class="eyebrow">東京消防庁の公開データを毎日集計</span>
  <h1><span class="nb">東京23区の火事、</span><span class="nb">どこで何件？</span></h1>
  <p class="lead">23区を管轄する58の消防署と東京消防庁が公開している火災件数を、区・消防署・町名ごとに整理しています。どの数字も、元のページのどこを読んだかまで確かめられます。</p>
  <div class="btn-row"><a class="btn primary" href="#wards">区から探す</a><a class="btn" href="towns.html">町名で探す</a><a class="btn" href="dial.html">サイレンが聞こえたら</a></div>
  {ALERT}
</section>
<section class="section" aria-labelledby="daily">
  <h2 id="daily">東京消防庁管内の火災（23区と多摩地区）</h2>
  <div class="stats">
    <div class="stat hot"><span class="k">{esc(re.sub(r"^令和\d+年|計$", "", daily["label"]))}の火災</span><span class="v">{fmt(fire_d.get("day"))}<small>件</small></span><span class="d">日次の速報値</span></div>
    <div class="stat"><span class="k">今年の火災（累計）</span><span class="v">{fmt(fire_d.get("ytd"))}<small>件</small></span><span class="d">前年より {"+" if (fire_d.get("diff") or 0) > 0 else ""}{fmt(fire_d.get("diff"))}件</span></div>
    <div class="stat"><span class="k">今年の火災による死者</span><span class="v">{fmt(daily["rows"].get("火災による死者", {}).get("ytd"))}<small>人</small></span><span class="d">負傷者 {fmt(daily["rows"].get("火災による傷者", {}).get("ytd"))}人</span></div>
    <div class="stat"><span class="k">{esc(re.sub(r"^令和\d+年|計$", "", daily["label"]))}の救急出動</span><span class="v">{fmt(daily["rows"].get("救急件数", {}).get("day"))}<small>件</small></span><span class="d">サイレンの多くは救急です</span></div>
  </div>
  <p class="small muted">出典：<a href="{esc(daily["url"])}" target="_blank" rel="noopener">東京消防庁「災害・救急情報」</a>（{jdate(daily["up"])}更新の速報値）。23区だけでなく多摩地区（稲城市を除く）を含みます。</p>
</section>
<section class="section" aria-labelledby="recent">
  <h2 id="recent">最近の23区の火事（報道）</h2>
  <div class="two">
    <div style="display:grid;gap:8px;min-width:0">{news_list(news['incidents'][:8], empty='直近30日に、23区の火事の報道は見つかっていません。')}{NEWS_NOTE}</div>
    {report_block()}
  </div>
</section>
<section class="section" id="wards" aria-labelledby="wh">
  <div class="two">
    <div style="display:grid;gap:12px;min-width:0">
      <h2 id="wh">区から探す</h2>
      <p class="muted small">数字は今年の火災件数を人口10万人あたりにしたもの。色が濃いほど多い区です。斜線は、区内に今年の件数を掲載していない消防署がある区です。</p>
      <div class="tilemap">{"".join(tiles)}</div>
      <div class="legend"><span>少</span><i style="background:var(--heat-1)"></i><i style="background:var(--heat-2)"></i><i style="background:var(--heat-3)"></i><i style="background:var(--heat-4)"></i><span>多</span><i style="background:repeating-linear-gradient(45deg,#f1f2f4,#f1f2f4 3px,#e3e5e9 3px,#e3e5e9 6px)"></i><span>一部未掲載</span></div>
    </div>
    <div style="display:grid;gap:16px;min-width:0">
      <div style="display:grid;gap:8px"><h3>人口あたりで多い区</h3>
        <div class="table-box"><table><thead><tr><th>区</th><th class="n">10万人あたり</th><th class="n">今年</th></tr></thead><tbody>{top_rows}</tbody></table></div></div>
      <div style="display:grid;gap:8px"><h3>前年より増えている消防署</h3>
        <div class="table-box"><table><thead><tr><th>消防署</th><th class="n">今年</th><th class="n">前年同時期</th><th class="n">増減</th></tr></thead><tbody>{rise_rows}</tbody></table></div>
        <a href="ranking.html">すべての区・消防署を比べる →</a></div>
    </div>
  </div>
</section>
<section class="section" aria-labelledby="how">
  <h2 id="how">このサイトの数字について</h2>
  <div class="stats">
    <div class="stat"><span class="k">今年の件数を集計できた署</span><span class="v">{N_OK}<small>/ 58署</small></span><span class="d">年ごとのみ{N_ANNUAL}署・未掲載{N_UNPUB}署</span></div>
    <div class="stat"><span class="k">町名から管轄署を引ける地区</span><span class="v">{fmt(TOTAL_TOWNS)}<small>地区</small></span><span class="d">東京消防庁の管轄区域表から</span></div>
    <div class="stat"><span class="k">掲載署の今年の合計</span><span class="v">{fmt(total_ytd)}<small>件</small></span><span class="d">署ごとに集計時点が違います</span></div>
    <div class="stat"><span class="k">データを取得した日時</span><span class="v">{FETCHED.month}/{FETCHED.day}<small>{FETCHED.hour}:{FETCHED.minute:02d}</small></span><span class="d">毎日自動で取り直します</span></div>
  </div>
  <p class="muted">各消防署のサイトは書式がばらばらです。表の見出し（「本年累計」「前年同時期」「令和7年中」など）を読み分けて件数を取り出し、取り出した箇所をそのまま各カードに載せています。<a href="about.html">データの出典と集め方</a></p>
</section>
</div>'''
    title = f'{SITE_NAME}｜東京23区の火事・火災件数を区と消防署ごとに'
    desc = f'東京23区の火事はどこで何件？23区を管轄する58消防署の火災件数を、区・消防署・町名ごとにまとめています。データは東京消防庁の公開情報から毎日集計。'
    return page('index', title, desc, body, full=full)

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
    data = []
    for s in stations.values():
        for t in s['towns']:
            data.append({'t': t, 'w': s['ward_url'], 'wn': s['ward_name'], 's': s['slug'], 'sn': s['name'],
                         'y': s['ytd'], 'as': jdate(s['when']) if s['ytd'] is not None else None})
    blob = json.dumps(data, ensure_ascii=False).replace('</', '<\\/')
    body = f'''<div class="wrap">
<nav class="crumbs" aria-label="パンくず"><a href="index.html">トップ</a> ／ 町名で探す</nav>
<section class="hero"><span class="eyebrow">{fmt(len(data))}地区に対応</span><h1>町名から管轄の消防署を探す</h1>
<p class="lead">住所の町名を入れると、その地区を受け持つ消防署と、その署の今年の火災件数が出ます。町名と消防署の対応は、東京消防庁の「住所から管轄消防署を探す」の表から作っています。</p></section>
<section class="section"><div class="search"><label for="town-q">町名（例：赤羽、西新宿、豊洲）</label>
<input id="town-q" type="search" inputmode="search" autocomplete="off" placeholder="町名を入力" aria-describedby="town-count">
<p id="town-count" class="small muted" aria-live="polite"></p></div>
<div id="town-results" class="results"></div></section>
</div>
<script type="application/json" id="towns-data">{blob}</script>'''
    return page('towns', f'町名から管轄の消防署と火災件数を探す（東京23区）｜{SITE_NAME}', f'東京23区の{len(data)}地区について、町名から管轄の消防署とその署の火災件数を調べられます。', body)

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
<li><span><strong>近所の消防署の火災件数を見る</strong><br><a href="towns.html">町名で探す</a>か、<a href="index.html#wards">区から探す</a>でどうぞ。</span></li>
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
             'dial.html': dial_page(), 'about.html': about_page(report)}
    for w in wards: pages[w['slug'] + '.html'] = ward_page(w)
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
                                                            'stations': stations, 'daily': daily, 'n_ranked': n_ranked, 'news': news}, ensure_ascii=False, default=str), encoding='utf-8')
    return sorted(pages)

if __name__ == '__main__':
    rp = DIST.parent / 'verify' / 'report.json'
    report = json.load(open(rp, encoding='utf-8')) if rp.exists() else None
    files = build(report)
    print(f'built {len(files)} pages →', DIST)
