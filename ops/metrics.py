#!/usr/bin/env python3
"""自動改善の数字をまとめる（docs/goals.md・docs/autopilot.md）。

読むもの：seo/gsc/api/（Search Console）、data/raw/（火事の記録・掲載時刻）、verify/report.json（検査）、
          ops/analytics/latest.json（Cloudflare Web Analytics。なければ回遊は「不明」）
書くもの：ops/metrics/latest.json・latest.md（今日の数字と今の段階）、ops/metrics/history.csv（1日1行）
"""
import csv, datetime, json, statistics
from collections import Counter
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
mins = []
for fn, (first, src, day) in seen.items():
    if day not in week or not first or not src: continue
    a = datetime.datetime.fromisoformat(src.replace('Z', '+00:00'))
    b = datetime.datetime.fromisoformat(first.replace('Z', '+00:00'))
    d = (b - a).total_seconds() / 60
    if 0 <= d <= 24 * 60: mins.append(d)   # 1日以上あとに見つけたもの（さかのぼり取り込み）は速さに数えない
m['publish_samples_7d'] = len(mins)
m['publish_minutes_median_7d'] = round(statistics.median(mins)) if mins else None
m['publish_minutes_p90_7d'] = round(sorted(mins)[int(len(mins) * 0.9) - 1]) if len(mins) >= 10 else None
m['publish_within_30m_7d'] = round(sum(1 for x in mins if x <= 30) / len(mins), 2) if mins else None

# ---- 守る数字：掲載件数（報道＋消防の発表）
per_day = Counter()
for v in (load('data/raw/news_archive.json', {}) or {}).get('fires', {}).values(): per_day[v[3]] += 1
for v in (load('data/raw/official_archive.json', {}) or {}).get('fires', {}).values(): per_day[v[3]] += 1
m['fires_per_day_7d'] = round(sum(per_day[d] for d in days_back(7)) / 7, 1)
m['fires_per_day_prev7d'] = round(sum(per_day[d] for d in days_back(7, today - datetime.timedelta(days=8))) / 7, 1)

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
| 掲載件数（7日平均） | {m['fires_per_day_7d']}件/日（前の7日 {m['fires_per_day_prev7d']}） |
| 検査 | {'合格' if m['verify_ok'] else '不合格' if m['verify_ok'] is False else '不明'} |

守る数字の警告：{'、'.join(g) if g else 'なし'}
"""
(OUT / 'latest.md').write_text(md, encoding='utf-8')

# 1日1行（同じ日は上書き）
cols = ['date', 'stage', 'indexed', 'inspected', 'clicks_7d', 'impressions_7d', 'pageviews_7d', 'visits_7d', 'pages_per_visit_7d',
        'publish_minutes_median_7d', 'publish_within_30m_7d', 'fires_per_day_7d', 'verify_ok']
hp = OUT / 'history.csv'
hist = [r for r in csv.DictReader(hp.open(encoding='utf-8'))] if hp.exists() else []
hist = [r for r in hist if r['date'] != m['date']] + [{c: ('' if m.get(c) is None else m.get(c)) for c in cols}]
with hp.open('w', encoding='utf-8', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=cols); w.writeheader(); w.writerows(sorted(hist, key=lambda r: r['date']))
print(md)
