#!/usr/bin/env python3
"""Cloudflare Web Analytics（Cookie を使わない無料のアクセス解析）の直近7日を ops/analytics/latest.json に保存する。

必要（GitHub の Secrets and variables → Actions）：
  Secret   CF_ANALYTICS_TOKEN … Cloudflare の API トークン（権限は「Account Analytics: Read」だけ）
  Variable CF_ACCOUNT_ID      … Cloudflare のアカウント ID
  Variable CF_SITE_TAG        … Web Analytics のサイトタグ（kajisoku.jp のもの）
どれかが無ければ何もしない（回遊の数字は「不明」のまま）。
"""
import datetime, json, os, sys
from pathlib import Path
import requests

tok, acc, site = (os.environ.get(k, '').strip() for k in ('CF_ANALYTICS_TOKEN', 'CF_ACCOUNT_ID', 'CF_SITE_TAG'))
if not (tok and acc and site):
    print('Cloudflare Web Analytics の設定がないので飛ばします'); sys.exit(0)

now = datetime.datetime.now(datetime.timezone.utc).replace(minute=0, second=0, microsecond=0)
until = now.replace(hour=0)
since = until - datetime.timedelta(days=7)
Q = '''query($acc: String!, $f: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!) {
  viewer { accounts(filter: {accountTag: $acc}) {
    daily: rumPageloadEventsAdaptiveGroups(limit: 10, filter: $f, orderBy: [date_ASC]) { count sum { visits } dimensions { date } }
    paths: rumPageloadEventsAdaptiveGroups(limit: 30, filter: $f, orderBy: [count_DESC]) { count sum { visits } dimensions { requestPath } }
    refs: rumPageloadEventsAdaptiveGroups(limit: 15, filter: $f, orderBy: [count_DESC]) { count dimensions { refererHost } }
  } } }'''
flt = {'siteTag': site, 'datetime_geq': since.isoformat().replace('+00:00', 'Z'), 'datetime_lt': until.isoformat().replace('+00:00', 'Z'), 'bot': 0}
r = requests.post('https://api.cloudflare.com/client/v4/graphql', timeout=60,
                  headers={'Authorization': f'Bearer {tok}'}, json={'query': Q, 'variables': {'acc': acc, 'f': flt}})
d = r.json()
if d.get('errors') or not d.get('data'):
    print('取得に失敗：', json.dumps(d.get('errors'), ensure_ascii=False)[:500]); sys.exit(1)
a = d['data']['viewer']['accounts'][0]
out = {
    'fetchedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='minutes'),
    'range': [since.date().isoformat(), (until - datetime.timedelta(days=1)).date().isoformat()],
    'pageviews_7d': sum(x['count'] for x in a['daily']),
    'visits_7d': sum(x['sum']['visits'] for x in a['daily']),
    'daily': [{'date': x['dimensions']['date'], 'pageviews': x['count'], 'visits': x['sum']['visits']} for x in a['daily']],
    'top_paths': [{'path': x['dimensions']['requestPath'], 'pageviews': x['count'], 'visits': x['sum']['visits']} for x in a['paths']],
    'top_referers': [{'host': x['dimensions']['refererHost'], 'pageviews': x['count']} for x in a['refs']],
}
p = Path(__file__).resolve().parent / 'analytics' / 'latest.json'
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
print(f"PV {out['pageviews_7d']}・訪問 {out['visits_7d']}")
