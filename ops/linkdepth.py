#!/usr/bin/env python3
"""トップから各ページまでのクリック数を、サイトマップの型ごとに数える（自動改善 E004）。
使い方：cd site && python3 build.py のあとで、リポジトリ直下から python3 ops/linkdepth.py
「届かない」は、サイトマップに載っているのに、トップからリンクをたどっても着かないページ。"""
import collections, glob, os, re, sys, urllib.parse

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist')
SITE = 'https://kajisoku.jp/'
HREF = re.compile(r'<a\s[^>]*?href="([^"#?]+)(?:[#?][^"]*)?"')
KIND = {'main': 'トップ・読み物・一覧', 'dial': '案内ダイヤル', 'pref': '都道府県', 'city': '市区町村', 'town': '町', 'fire': '火事'}

def links(fn):
    try: s = open(os.path.join(D, fn), encoding='utf-8').read()
    except OSError: return set()
    out = set()
    for h in HREF.findall(s):
        if h.startswith(SITE): h = h[len(SITE):] or 'index.html'
        elif h.startswith(('http', 'mailto', 'tel', '//')): continue
        h = urllib.parse.unquote(h.lstrip('./'))
        if h == '' or h.endswith('/'): h += 'index.html'
        if h.endswith('.html'): out.add(h)
    return out

def main():
    if not os.path.exists(os.path.join(D, 'index.html')): sys.exit('dist/ がありません。先に cd site && python3 build.py を動かしてください')
    depth = {'index.html': 0}; q = collections.deque(['index.html'])
    while q:
        fn = q.popleft()
        for h in links(fn):
            if h not in depth and os.path.exists(os.path.join(D, h)):
                depth[h] = depth[fn] + 1; q.append(h)
    tab = collections.defaultdict(collections.Counter); lost = []
    for sm in sorted(glob.glob(os.path.join(D, 'sitemap-*.xml'))):
        k = re.sub(r'-\d+$', '', os.path.basename(sm)[8:-4])
        for u in re.findall(r'<loc>([^<]+)</loc>', open(sm, encoding='utf-8').read()):
            p = urllib.parse.unquote(u.split('/', 3)[3]) or 'index.html'
            d = depth.get(p)
            tab[k][d if d is not None and d <= 4 else ('5以上' if d else '届かない')] += 1
            if d is None: lost.append(p)
    cols = [0, 1, 2, 3, 4, '5以上', '届かない']
    print('| 型 | ' + ' | '.join(f'{c}クリック' if isinstance(c, int) else c for c in cols) + ' |')
    print('|---|' + '---|' * len(cols))
    for k in KIND:
        if k in tab: print(f'| {KIND[k]} | ' + ' | '.join(str(tab[k].get(c, 0)) for c in cols) + ' |')
    for p in lost[:20]: print('届かない：', p)
    return 1 if lost else 0

if __name__ == '__main__':
    sys.exit(main())
