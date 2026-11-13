"""Search Console のデータを API で取り、seo/gsc/api/ に保存する。

GitHub Actions（.github/workflows/gsc.yml）から毎日動かす。
  - 検索パフォーマンス：日付ごと（取れる最大16か月）と、直近28日のクエリ・ページ・クエリ×ページ
  - URL検査：サイトマップのURLを1日あたり INSPECT_PER_DAY 件ずつ順番に調べ、インデックス状況を記録

必要な環境変数
  GSC_KEY        サービスアカウントの鍵（JSON の中身そのもの）
  GSC_SITE       任意。プロパティ（例 sc-domain:kajisoku.jp）。なければ一覧から kajisoku.jp を探す
  SITE_URL       任意。サイトマップの取得元（既定 https://kajisoku.jp）
"""
import csv, datetime as dt, json, os, re, sys, time, urllib.parse
import requests
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gsc', 'api')
SITE_URL = (os.environ.get('SITE_URL') or 'https://kajisoku.jp').rstrip('/')
INSPECT_PER_DAY = int(os.environ.get('INSPECT_PER_DAY') or 1500)   # 手動実行で 0 を渡すとURL検査を飛ばす（ただし空は1500）   # Google の上限は1日2,000件・1分600件
API = 'https://searchconsole.googleapis.com'
SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly']
JST = dt.timezone(dt.timedelta(hours=9))


def session():
    key = os.environ.get('GSC_KEY')
    if not key:
        print('::notice::GSC_KEY がまだ登録されていないので、取得を飛ばしました（GitHub の Secrets に登録してください）')
        sys.exit(0)
    creds = service_account.Credentials.from_service_account_info(json.loads(key), scopes=SCOPES)
    return AuthorizedSession(creds)


def pick_site(s):
    if os.environ.get('GSC_SITE'):
        return os.environ['GSC_SITE']
    r = s.get(f'{API}/webmasters/v3/sites'); r.raise_for_status()
    sites = [x['siteUrl'] for x in r.json().get('siteEntry', []) if x.get('permissionLevel') != 'siteUnverifiedUser']
    host = urllib.parse.urlparse(SITE_URL).hostname
    for want in (f'sc-domain:{host}', f'{SITE_URL}/'):
        if want in sites:
            return want
    sys.exit(f'Search Console のプロパティが見つかりません。サービスアカウントをユーザーに追加したか確認してください。見えているもの：{sites}')


def query(s, site, start, end, dims, limit=25000):
    """searchAnalytics を全件取る（25,000行ずつ）"""
    url = f'{API}/webmasters/v3/sites/{urllib.parse.quote(site, safe="")}/searchAnalytics/query'
    rows, start_row = [], 0
    while True:
        body = {'startDate': start, 'endDate': end, 'dimensions': dims, 'type': 'web',
                'rowLimit': limit, 'startRow': start_row, 'dataState': 'final'}
        r = s.post(url, json=body); r.raise_for_status()
        got = r.json().get('rows', [])
        rows += got
        if len(got) < limit:
            return rows
        start_row += limit


def write_rows(name, dims, rows):
    path = os.path.join(OUT, name)
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(dims + ['clicks', 'impressions', 'ctr', 'position'])
        for x in sorted(rows, key=lambda x: (-x['impressions'], x['keys'])):
            w.writerow(x['keys'] + [x['clicks'], x['impressions'], round(x['ctr'], 4), round(x['position'], 2)])
    print(f'{name}: {len(rows)}行')


def sitemaps_status(s, site):
    """Search Console に登録されたサイトマップの読み込み状況。索引（sitemap.xml）なら、子サイトマップ（型ごと）の状況も取る"""
    base = f'{API}/webmasters/v3/sites/{urllib.parse.quote(site, safe="")}/sitemaps'
    def row(x):
        sub = sum(int(c.get('submitted', 0)) for c in x.get('contents', []))
        return {'path': x.get('path'), 'lastSubmitted': x.get('lastSubmitted'), 'lastDownloaded': x.get('lastDownloaded'),
                'isPending': x.get('isPending'), 'errors': x.get('errors'), 'warnings': x.get('warnings'), 'submittedUrls': sub}
    r = s.get(base); r.raise_for_status()
    out = []
    for x in r.json().get('sitemap', []):
        o = row(x)
        if x.get('isSitemapsIndex'):
            # 子の状況が取れなくても、ほかの取得は止めない（Google が子をまだ読んでいなければ空で返る）
            try:
                c = s.get(base, params={'sitemapIndex': x.get('path')})
                o['children'] = [row(y) for y in c.json().get('sitemap', [])] if c.ok else None
                if not c.ok: print(f'子サイトマップの状況を取れませんでした {c.status_code}')
            except Exception as e:
                print(f'子サイトマップの状況を取れませんでした {e}'); o['children'] = None
        out.append(o)
    print(f'登録サイトマップ：{len(out)}件')
    return out


def sitemap_urls():
    """サイトマップ索引 → 子サイトマップ → URL"""
    urls, todo, seen = [], [f'{SITE_URL}/sitemap.xml'], set()
    while todo:
        u = todo.pop(0)
        if u in seen:
            continue
        seen.add(u)
        r = requests.get(u, timeout=60, headers={'User-Agent': 'kajisoku-seo-bot'}); r.raise_for_status()
        locs = re.findall(r'<loc>\s*([^<]+?)\s*</loc>', r.text)
        if '<sitemapindex' in r.text:
            todo += locs
        else:
            urls += locs
    return urls


def sitemap_kind(u):
    """サイトマップの型（site/build.py の sitemap_kind と同じ分け方）"""
    n = urllib.parse.unquote(u.rsplit('/', 1)[-1])
    if n.startswith('f-'): return 'fire'
    if n.startswith('m-'): return 'town'
    if n.startswith('c-'): return 'city'
    if n.startswith('p-'): return 'pref'
    if n.startswith('dial-') and n != 'dial-list.html': return 'dial'
    return 'main'


def inspect(s, site, today):
    path = os.path.join(OUT, 'inspection.csv')
    cols = ['url', 'verdict', 'coverageState', 'indexingState', 'lastCrawlTime', 'googleCanonical', 'checkedAt']
    known = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            known = {r['url']: r for r in csv.DictReader(f)}
    urls = sitemap_urls()
    alive = set(urls)
    known = {u: r for u, r in known.items() if u in alive}          # サイトマップから消えたURLは外す
    # まだ調べていないURLを先に、そのあと古い順。トップは毎回調べる
    # ページの型（読み物 g-・地図・都道府県 p-・市区町村 c-・町 m-・火事 f-・その他）ごとに順番に1件ずつ取り、
    # どの型も毎日見本が調べられるようにする（ファイル名順だと c- だけで1日分を使い切っていた。2026-11-11）
    def kind(u):
        n = urllib.parse.unquote(u.rsplit('/', 1)[-1])
        for k in ('g-', 'p-', 'c-', 'm-', 'f-'):
            if n.startswith(k): return k
        return 'other'
    buckets = {}
    for u in sorted(urls, key=lambda u: (u in known, known.get(u, {}).get('checkedAt', ''))):
        buckets.setdefault(kind(u), []).append(u)
    order = [u for u in urls if u.rstrip('/') == SITE_URL]
    lists = [buckets[k] for k in ('other', 'g-', 'p-', 'c-', 'm-', 'f-') if k in buckets]
    for i in range(max(map(len, lists), default=0)):
        order += [l[i] for l in lists if i < len(l) and l[i].rstrip('/') != SITE_URL]
    done = 0
    for u in order[:max(INSPECT_PER_DAY, 0)]:
        r = s.post(f'{API}/v1/urlInspection/index:inspect', json={'inspectionUrl': u, 'siteUrl': site, 'languageCode': 'ja'})
        if r.status_code == 429:
            print('URL検査の上限に達したので終了'); break
        if not r.ok:
            print(f'URL検査に失敗 {r.status_code} {u}'); continue
        x = r.json().get('inspectionResult', {}).get('indexStatusResult', {})
        known[u] = {'url': u, 'verdict': x.get('verdict', ''), 'coverageState': x.get('coverageState', ''),
                    'indexingState': x.get('indexingState', ''), 'lastCrawlTime': x.get('lastCrawlTime', ''),
                    'googleCanonical': x.get('googleCanonical', ''), 'checkedAt': today}
        done += 1
        time.sleep(0.15)
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader()
        for u in sorted(known):
            w.writerow(known[u])
    # 状態ごとの件数（SEO担当がまず見る要約）
    counts = {}
    for r in known.values():
        counts[r['coverageState'] or '（不明）'] = counts.get(r['coverageState'] or '（不明）', 0) + 1
    with open(os.path.join(OUT, 'inspection_summary.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['coverageState', 'urls'])
        for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
            w.writerow([k, v])
    print(f'URL検査：今回{done}件、記録{len(known)}件 / サイトマップ{len(urls)}件')
    by_kind = {}
    for u in urls: by_kind[sitemap_kind(u)] = by_kind.get(sitemap_kind(u), 0) + 1
    return len(urls), len(known), counts, by_kind


def main():
    os.makedirs(OUT, exist_ok=True)
    s = session()
    site = pick_site(s)
    today = dt.datetime.now(JST).date()
    end = (today - dt.timedelta(days=2)).isoformat()                 # データは2〜3日遅れで確定する
    start28 = (today - dt.timedelta(days=29)).isoformat()
    start16m = (today - dt.timedelta(days=486)).isoformat()
    print(f'プロパティ {site}、期間 {start28}〜{end}')

    write_rows('by_date.csv', ['date'], query(s, site, start16m, end, ['date']))
    write_rows('queries_28d.csv', ['query'], query(s, site, start28, end, ['query']))
    write_rows('pages_28d.csv', ['page'], query(s, site, start28, end, ['page']))
    write_rows('query_page_28d.csv', ['query', 'page'], query(s, site, start28, end, ['query', 'page']))
    sm = sitemaps_status(s, site)
    total, checked, counts, by_kind = inspect(s, site, today.isoformat())

    with open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump({'fetchedAt': dt.datetime.now(JST).isoformat(timespec='minutes'), 'property': site,
                   'range28d': [start28, end], 'sitemapUrls': total, 'sitemapUrlsByKind': by_kind, 'inspectedUrls': checked,
                   'coverage': counts, 'submittedSitemaps': sm}, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
