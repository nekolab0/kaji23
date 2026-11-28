#!/usr/bin/env python3
"""ops/social/queue.json が投稿の文のきまり（docs/growth.md 2章）を守っているかを確かめる。
build.py のあとに動かす（run_all.sh）。守っていなければ終了コード 1。"""
import json, re, sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
LIMITS = {'bsky': 300, 'misskey': 3000, 'mastodon': 500, 'threads': 500, 'instagram': 2200, 'facebook': 5000}
NG = ('けが', '負傷', '死亡', '亡くな', '死者', '重体', '心肺停止', '大炎上', 'ヤバ', 'やば')

def main():
    q = json.loads((ROOT / 'ops' / 'social' / 'queue.json').read_text(encoding='utf-8'))
    errs = []
    ids = set()
    for it in q['items']:
        iid = it['id']
        if iid in ids: errs.append(f'{iid}: 同じ火事が2回入っている')
        ids.add(iid)
        if it['expires'] <= it['first']: errs.append(f'{iid}: 期限が発生より前')
        page = unquote(urlparse(it['page']).path.lstrip('/'))
        if not (ROOT / 'dist' / page).exists(): errs.append(f'{iid}: リンク先のページがない（{page}）')
        if set(it['posts']) != set(q['dests']): errs.append(f'{iid}: 配信先がそろっていない')
        thr = it['posts'].get('threads', {}).get('text', '')
        if thr.count('#') > 1: errs.append(f'{iid}: Threads のハッシュタグが2つ以上')
        for d, p in it['posts'].items():
            t = p['text']
            if len(t) > LIMITS[d]: errs.append(f'{iid}/{d}: {len(t)}字（上限 {LIMITS[d]}）')
            for w in NG:
                if w in t: errs.append(f'{iid}/{d}: 書かない言葉「{w}」')
            for u in [p.get('url')] + [w for w in t.split() if w.startswith('http')]:
                if u and f'utm_source={d}&utm_medium=social&utm_campaign=' not in u: errs.append(f'{iid}/{d}: utm がない・違う（{u[:60]}…）')
        if not it['posts']['instagram'].get('image'): errs.append(f'{iid}/instagram: 画像がない')
    wk = ROOT / 'ops' / 'social' / 'weekly'   # 週のまとめの SNS 用素材（G8）
    for md in sorted(wk.glob('*/post.md')) if wk.exists() else []:
        t, w = md.read_text(encoding='utf-8'), md.parent.name
        for ng in NG:
            if ng in t: errs.append(f'weekly/{w}: 書かない言葉「{ng}」')
        for u in re.findall(r'https?://\S+', t):
            if '/w-' in u and not re.search(r'utm_source=(youtube|note|hatena)&utm_medium=social&utm_campaign=weekly', u): errs.append(f'weekly/{w}: utm がない・違う（{u[:60]}…）')
        n = len(list(md.parent.glob('slide-*.png')))
        if n and not 5 <= n <= 8: errs.append(f'weekly/{w}: 画像が{n}枚（5〜8枚にする）')
    print(f'投稿キュー：{len(q["items"])}件・問題 {len(errs)}件')
    for e in errs: print('  ' + e)
    return 1 if errs else 0

if __name__ == '__main__':
    sys.exit(main())
