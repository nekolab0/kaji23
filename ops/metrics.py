#!/usr/bin/env python3
"""自動改善の数字をまとめる（docs/goals.md・docs/autopilot.md）。

読むもの：seo/gsc/api/（Search Console）、data/raw/（火事の記録・掲載時刻）、verify/report.json（検査）、
          ops/analytics/latest.json（Cloudflare Web Analytics。なければ回遊は「不明」）
書くもの：ops/metrics/latest.json・latest.md（今日の数字と今の段階）、ops/metrics/history.csv（1日1行）
"""
import csv, datetime, json, re, statistics
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'ops' / 'metrics'
JST = datetime.timezone(datetime.timedelta(hours=9))
today = datetime.datetime.now(JST).date()


def load(p, default=None):
    p = ROOT / p
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return default


def days_back(n, end=None):
    end = end or today - datetime.timedelta(days=1)   # 今日は途中なので含めない
    return [(end - datetime.timedelta(days=i)).isoformat() for i in range(n)]


m = {'date': today.isoformat()}

# ---- 1. インデックス（URL 検査の要約。調べ終わった URL のうち登録済みの数）
meta = load('seo/gsc/api/meta.json', {})
cov = meta.get('coverage') or {}
m['indexed'] = sum(v for k, v in cov.items() if '登録されました' in k or ('登録済み' in k and '未登録' not in k))
m['inspected'] = meta.get('inspectedUrls')
m['sitemap_urls'] = meta.get('sitemapUrls')
m['gsc_fetched_at'] = meta.get('fetchedAt')

# ---- 1b. 型ごとの登録（どの型が詰まっているかを見る。型はサイトマップの分け方と同じ）
import urllib.parse
KINDS = [('main', 'トップ・読み物・一覧'), ('dial', '案内ダイヤル'), ('pref', '都道府県'), ('city', '市区町村'), ('town', '町'), ('fire', '火事')]
def kind_of(u):
    n = urllib.parse.unquote(u.rsplit('/', 1)[-1])
    if n.startswith('f-'): return 'fire'
    if n.startswith('m-'): return 'town'
    if n.startswith('c-'): return 'city'
    if n.startswith('p-'): return 'pref'
    if n.startswith('dial-') and n != 'dial-list.html': return 'dial'
    return 'main'
def is_indexed(state):
    return '登録されました' in state or ('登録済み' in state and '未登録' not in state)
by_kind = {k: {'sitemap': (meta.get('sitemapUrlsByKind') or {}).get(k), 'inspected': 0, 'indexed': 0, 'crawled': 0, 'known': 0} for k, _ in KINDS}
p = ROOT / 'seo/gsc/api/inspection.csv'
if p.exists():
    for r in csv.DictReader(p.open(encoding='utf-8')):
        b = by_kind[kind_of(r['url'])]
        st = r.get('coverageState') or ''
        b['inspected'] += 1
        b['indexed'] += is_indexed(st)
        b['crawled'] += bool(r.get('lastCrawlTime'))           # Google が1回でも読みに来た
        b['known'] += bool(st) and '認識されていません' not in st   # 登録・検出・クロール済みなど、Google が URL を知っている
m['index_by_kind'] = by_kind
# 型ごとのサイトマップを Google が読んだか（索引の子。まだ取れていなければ None）
kids = None
for x in meta.get('submittedSitemaps') or []:
    if x.get('children') is not None:
        kids = {re.sub(r'^.*/sitemap-|\.xml$', '', c.get('path') or ''): (c.get('lastDownloaded') or '')[:10] for c in x['children']}
m['sitemap_children_downloaded'] = kids
# 索引（sitemap.xml）そのものを Google が読んだ日（子の記録が空でも、索引は読まれていることがある）
idx = [x for x in meta.get('submittedSitemaps') or [] if (x.get('path') or '').endswith('/sitemap.xml')]
m['sitemap_index_downloaded'] = ((idx[0].get('lastDownloaded') or '')[:10] or None) if idx else None
m['sitemap_index_submitted_urls'] = idx[0].get('submittedUrls') if idx else None

# ---- 2. 検索流入（Search Console は2日ほど遅れる。データのある直近7日）
rows = []
p = ROOT / 'seo/gsc/api/by_date.csv'
if p.exists():
    rows = sorted(csv.DictReader(p.open(encoding='utf-8')), key=lambda r: r['date'])
last7 = rows[-7:]
m['clicks_7d'] = sum(int(r['clicks']) for r in last7)
m['impressions_7d'] = sum(int(r['impressions']) for r in last7)
m['clicks_per_day_7d'] = round(m['clicks_7d'] / 7, 1)
m['gsc_last_day'] = rows[-1]['date'] if rows else None

# ---- 3. 回遊（Cloudflare Web Analytics）
an = load('ops/analytics/latest.json')
if an and an.get('visits_7d'):
    m['pageviews_7d'] = an['pageviews_7d']
    m['visits_7d'] = an['visits_7d']
    m['pages_per_visit_7d'] = round(an['pageviews_7d'] / an['visits_7d'], 2)
else:
    m['pageviews_7d'] = m['visits_7d'] = m['pages_per_visit_7d'] = None

m['rpm'] = None   # AdSense の数字はまだ取っていない

# ---- D. 有事の速さ（情報源の時刻 → 火事のページが最初に生成されるまで）
seen = load('data/raw/fire_first_seen.json', {})
week = set(days_back(7))
not_fire = {f'f-{k}.html' for k, v in (load('data/raw/official_archive.json', {}) or {}).get('fires', {}).items() if v[2] == '過去'}
mins = []
for fn, v in seen.items():
    first, src, day = v[:3]
    if len(v) > 3: continue   # ファイル名が変わった火事の前のページ（時刻は引き継ぎ先のページで数える。site/build.py の _first_seen_inherit）
    if day not in week or not first or not src: continue
    if fn in not_fire: continue   # 火事ではない取り込み（site/nation.py の NOT_A_FIRE_TOWN）のページは数えない
    a = datetime.datetime.fromisoformat(src.replace('Z', '+00:00'))
    b = datetime.datetime.fromisoformat(first.replace('Z', '+00:00'))
    d = (b - a).total_seconds() / 60
    if 0 <= d <= 24 * 60: mins.append(d)   # 1日以上あとに見つけたもの（さかのぼり取り込み）は速さに数えない
m['publish_samples_7d'] = len(mins)
# 報道のページ（f-n-）だけの「掲載まで6時間超」の割合（2026-11-18・E008 の判定に使う。11/18 は 229件中68件＝0.30）
_nm = []
for fn, v in seen.items():
    if not fn.startswith('f-n-') or len(v) > 3 or v[2] not in week or not v[0] or not v[1]: continue
    d = (datetime.datetime.fromisoformat(v[0].replace('Z', '+00:00')) - datetime.datetime.fromisoformat(v[1].replace('Z', '+00:00'))).total_seconds() / 60
    if 0 <= d <= 24 * 60: _nm.append(d)
m['news_samples_7d'] = len(_nm)
m['news_over_6h_7d'] = round(sum(1 for x in _nm if x > 360) / len(_nm), 2) if _nm else None
m['publish_minutes_median_7d'] = round(statistics.median(mins)) if mins else None
m['publish_minutes_p90_7d'] = round(sorted(mins)[int(len(mins) * 0.9) - 1]) if len(mins) >= 10 else None
m['publish_within_30m_7d'] = round(sum(1 for x in mins if x <= 30) / len(mins), 2) if mins else None

# ---- 守る数字：掲載件数（報道＋消防の発表）
per_day = Counter()
for v in (load('data/raw/news_archive.json', {}) or {}).get('fires', {}).values(): per_day[v[3]] += 1
for v in (load('data/raw/official_archive.json', {}) or {}).get('fires', {}).values():
    if v[2] != '過去': per_day[v[3]] += 1   # 「過去」は火事ではない取り込み（site/nation.py の NOT_A_FIRE_TOWN）
m['fires_per_day_7d'] = round(sum(per_day[d] for d in days_back(7)) / 7, 1)
m['fires_per_day_prev7d'] = round(sum(per_day[d] for d in days_back(7, today - datetime.timedelta(days=8))) / 7, 1)

# ---- 守る数字：読み誤りの疑い（2026-11-14 の茨城の件を、次からは数字で気づけるようにした）
# 同じ市区町村・同じ町名・同じ時刻（分まで）の発表が、直近14日のうち3日以上あるのは、
# 火事ではなくページの決まった文言（「過去の火災・事故発生情報」など）を毎日読んでいる疑いが強い
_rep = defaultdict(set)
_d14 = set(days_back(14))
for v in (load('data/raw/official_archive.json', {}) or {}).get('fires', {}).values():
    if v[2] in ('過去',) or v[3] not in _d14 or not v[5]: continue   # 「過去」は対処済み（site/nation.py の NOT_A_FIRE_TOWN）
    _rep[(v[0], v[1], v[2] or '', v[5][11:16])].add(v[3])
m['misread_suspects'] = sorted(f"{k[0]}{k[1]} {k[2] or '（町名なし）'} 毎日{k[3]}UTC（{len(d)}日）" for k, d in _rep.items() if len(d) >= 3)

# ---- 守る数字：同じ記事が別の日の火事になっている（2026-11-18 に直した型。collector/news_jp.js の pinKnownPubDates）
# Google ニュースの RSS は、更新された記事の公開時刻を新しくして返すことがあり、数日前の火事が「今日の火事」として二重に載っていた。
# 直した日（11/19）より後の日付の火事で、同じ記事（link）が別の日の火事にも使われていたら警告に出す
_by_link = defaultdict(set)
for x in (load('data/raw/news.json', {}) or {}).get('incidents', []):
    for s_ in x.get('sources', []): _by_link[s_['link']].add(x['id'])
m['news_reused_articles'] = sorted({max(ids) for ids in _by_link.values()
    if len({i[-10:] for i in ids}) > 1 and max(i[-10:] for i in ids) >= '2026-11-19'})

# ---- 収集元の読み取り状況（verify/sources_status.json。collector/official_run.mjs が毎回の生成で記録）
_ss = load('verify/sources_status.json', {}) or {}
_src = _ss.get('sources', [])
m['sources_status_at'] = _ss.get('at')
m['sources_total'] = len(_src) or None
m['sources_failing'] = sorted(f"{x['id']}（{x['status']}・{x['fails']}回続けて）" for x in _src if x.get('status') and x['status'] != 'ok') if _src else None
m['fire_mail_senders'] = len(_ss.get('mails', [])) if _ss else None

# ---- 守る数字：検査
rep = load('verify/report.json', {})
bad = [c['name'] for c in rep.get('checks', []) if c.get('level') == 'error' and not c.get('ok')]
m['verify_ok'] = not bad if rep else None
m['verify_failed'] = bad

# ---- 今の段階（合格ラインを越えていない最初の段階）
goals = load('ops/goals.json')
stage = None
for s in goals['stages']:
    v = m.get(s['metric'])
    if s['gate'] is None or v is None or v < s['gate']:
        stage = s; break
m['stage'] = stage['id']
m['stage_name'] = stage['name']
m['stage_metric'] = stage['metric']
m['stage_value'] = m.get(stage['metric'])
m['stage_gate'] = stage['gate']

g = []
if m['verify_ok'] is False: g.append('検査に不合格：' + '・'.join(bad))
if m['fires_per_day_prev7d'] and m['fires_per_day_7d'] < m['fires_per_day_prev7d'] * 0.8:
    g.append(f"掲載件数が減った（{m['fires_per_day_prev7d']}→{m['fires_per_day_7d']}件/日）")
if m['gsc_fetched_at'] and m['gsc_fetched_at'][:10] < (today - datetime.timedelta(days=2)).isoformat():
    g.append(f"Search Console の取得が止まっている可能性（最終 {m['gsc_fetched_at']}）")
if m['misread_suspects']:
    g.append(f"読み誤りの疑い {len(m['misread_suspects'])}件（同じ町・同じ時刻の発表が毎日続く）：" + '・'.join(m['misread_suspects'][:3]))
if m['news_reused_articles']:
    g.append(f"同じ記事が別の日の火事になっている {len(m['news_reused_articles'])}件（更新された古い記事を新しい火事として取り込んだ疑い）：" + '・'.join(m['news_reused_articles'][:3]))
m['guard_alerts'] = g

OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'latest.json').write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding='utf-8')

def f(v, unit=''):
    return '不明' if v is None else f'{v}{unit}'

md = f"""# 今日の数字（{m['date']}）

**今の段階：{m['stage']}. {m['stage_name']}**（{m['stage_metric']} = {f(m['stage_value'])} ／ 合格ライン {f(m['stage_gate'])}）

| 数字 | 値 |
|---|---|
| インデックス登録 | {f(m['indexed'])}（調べた {f(m['inspected'])}／サイトマップ {f(m['sitemap_urls'])}） |
| 検索クリック（直近7日） | {m['clicks_7d']}（1日 {m['clicks_per_day_7d']}、表示 {m['impressions_7d']}、最終日 {f(m['gsc_last_day'])}） |
| PV・訪問（直近7日） | {f(m['pageviews_7d'])}・{f(m['visits_7d'])}（1訪問 {f(m['pages_per_visit_7d'])} ページ） |
| 掲載までの分数（中央値・90%） | {f(m['publish_minutes_median_7d'], '分')}・{f(m['publish_minutes_p90_7d'], '分')}（30分以内 {f(m['publish_within_30m_7d'])}、{m['publish_samples_7d']}件） |
| 報道のページの掲載まで6時間超（7日） | {f(m['news_over_6h_7d'])}（{m['news_samples_7d']}件） |
| 掲載件数（7日平均） | {m['fires_per_day_7d']}件/日（前の7日 {m['fires_per_day_prev7d']}） |
| 検査 | {'合格' if m['verify_ok'] else '不合格' if m['verify_ok'] is False else '不明'} |
| 出動情報ページの読み取り | {f'{m["sources_total"] - len(m["sources_failing"])}/{m["sources_total"]} ページが読めている（{m["sources_status_at"]}）' if m['sources_total'] else '不明（verify/sources_status.json がまだない）'} |

守る数字の警告：{'、'.join(g) if g else 'なし'}
{('' if not m['sources_failing'] else chr(10) + '読めていない出動情報ページ：' + '、'.join(m['sources_failing'][:15]) + chr(10))}

## 型ごとの登録（URL 検査）
「知っている」は、登録・検出・クロール済みなど、Google が URL を知っている数。「読みに来た」は、クロールの日付がある数。

| 型 | サイトマップ | 調べた | 知っている | 読みに来た | 登録 | サイトマップを Google が読んだ日 |
|---|---|---|---|---|---|---|
""" + ''.join(f"| {name} | {f(b['sitemap'])} | {b['inspected']} | {b['known']} | {b['crawled']} | {b['indexed']} | {'不明' if kids is None else (kids.get(k) or 'まだ')} |\n"
              for k, name in KINDS for b in [by_kind[k]])
md += f"\n索引（sitemap.xml）を Google が読んだ日：{m['sitemap_index_downloaded'] or 'まだ'}（Google が数えた URL：{f(m['sitemap_index_submitted_urls'])}。いまのサイトマップは {f(m['sitemap_urls'])}件）\n"
(OUT / 'latest.md').write_text(md, encoding='utf-8')

# 1日1行（同じ日は上書き）
cols = ['date', 'stage', 'indexed', 'inspected', 'clicks_7d', 'impressions_7d', 'pageviews_7d', 'visits_7d', 'pages_per_visit_7d',
        'publish_minutes_median_7d', 'publish_within_30m_7d', 'fires_per_day_7d', 'verify_ok', 'news_over_6h_7d']
hp = OUT / 'history.csv'
hist = [r for r in csv.DictReader(hp.open(encoding='utf-8'))] if hp.exists() else []
hist = [r for r in hist if r['date'] != m['date']] + [{c: ('' if m.get(c) is None else m.get(c)) for c in cols}]
with hp.open('w', encoding='utf-8', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=cols); w.writeheader(); w.writerows(sorted(hist, key=lambda r: r['date']))
print(md)
