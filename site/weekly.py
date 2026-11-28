# 週の火事まとめ（w-YYYY-MM-DD.html は月曜の日付。一覧は weekly.html）。backlog 8.0「今週の火事まとめ」
# build.py の名前空間で exec される（page・esc・RECORDS・rec_kind・fire_href・art_cols・art_bars・fig・NAT_MONTH などを使う）
# SEO 担当の条件（seo/decisions.md 2026-11-26）：
# - 終わった週（日本時間の月〜日）だけ作る。件数は「収録分のみ」と書き、前の週と比べて「増えた・減った」とは書かない（収録元が増え続けているため）
# - 目立った火事は、けが人・死亡の報道を選び方にだけ使い、本文には町名・日付・種別とリンクだけを出す（見出し・けが人・番地は書かない）
# - 季節の注意は消防庁の統計（NAT_MONTH）で書き、自前の月別件数は根拠にしない
WEEKLY_FIRST = datetime.date(2026, 11, 2)   # 全国版の収録がそろった最初の月曜（それより前は件数が少なく、比べられない）
WEEK_TIPS = {   # 月ごとの注意（言い切りすぎない・怖がらせない）
    1: '暖房器具の近くに、洗濯物や布団など燃えやすいものを置かないようにしましょう。',
    2: '空気が乾き、風の強い日が続きます。屋外でのたき火やごみ焼きは控えましょう。',
    3: '春の全国火災予防運動（3月1日〜7日）の時期です。野焼きや山林の近くでの火の扱いに気をつけましょう。',
    4: '山林の火事（林野火災）が起きやすい時期です。風の強い日は屋外で火を使わないようにしましょう。',
    5: '行楽で火を使う機会が増えます。バーベキューの後は、火が消えたことを水をかけて確かめましょう。',
    6: '梅雨の時期は、たこ足配線のコンセントにたまったほこりと湿気に気をつけましょう（トラッキング）。',
    7: 'スプレー缶やモバイルバッテリーを、車の中や直射日光の当たる場所に置かないようにしましょう。',
    8: '花火は水を入れたバケツを用意し、燃えかすは水につけてから捨てましょう。',
    9: '台風の後は、水につかった電気製品や配線から火が出ることがあります。使う前に点検しましょう。',
    10: '暖房器具を使い始める前に、ほこりの掃除と点検をしておきましょう。',
    11: '住宅用火災警報器が鳴るか、テストボタンで確かめてみましょう（秋の全国火災予防運動は毎年11月9日〜15日）。',   # 週が予防運動の後でも合う書き方（G8 で直した）
    12: '1年で火事が多い時期です。寝る前・出かける前に、こんろ・暖房・たばこの火を確かめましょう。',
}

def weekly_weeks(today=None):
    """作る週の月曜の一覧（古い順）。今日を含む週は、まだ終わっていないので作らない"""
    today = today or datetime.datetime.now(JST).date()
    last = today - datetime.timedelta(days=today.weekday() + 7)   # 終わった週の月曜
    out, d = [], WEEKLY_FIRST
    while d <= last: out.append(d); d += datetime.timedelta(days=7)
    return out

def _jst_day(r):
    """火事の日付（日本時間）。r['day'] は報道・発表の時刻（UTC）の先頭10文字なので、日本時間の 0〜9時の火事は前の日になる。
    週と曜日は日本時間で数えたいので、時刻があれば日本時間に直す（検証役の指摘 2026-11-27）"""
    t = (r['x'] or {}).get('first') or (r.get('official') or {}).get('at')
    if t:
        try:
            d = datetime.datetime.fromisoformat(str(t).replace('Z', '+00:00'))
            if d.tzinfo is None: d = d.replace(tzinfo=datetime.timezone.utc)
            return d.astimezone(JST).date().isoformat()
        except (TypeError, ValueError):
            pass
    return r['day']

def _week_recs(mon):
    a, b = mon.isoformat(), (mon + datetime.timedelta(days=6)).isoformat()
    return [r for r in RECORDS if a <= _jst_day(r) <= b]

def _wrange(mon):
    sun = mon + datetime.timedelta(days=6)
    return f'{mon.month}月{mon.day}日〜' + (f'{sun.month}月{sun.day}日' if sun.month != mon.month else f'{sun.day}日')

def week_file(mon): return f'w-{mon.isoformat()}.html'

def _notable(rs, n=10):
    """目立った火事：亡くなった方の報道4点・けが人2点・報道の数（3まで）。4点以上を点数の高い順。自殺などに関わる記事は出さない"""
    cand = []
    for r in rs:
        x = r['x'] or {}
        if not x or x.get('sensitive') or not has_page(r): continue
        s = 4 * bool(x.get('dead')) + 2 * bool(x.get('injured')) + min(len(x.get('sources', [])), 3)
        if s >= 4: cand.append((s, x.get('first', ''), r))
    cand.sort(key=lambda c: (c[0], c[1]), reverse=True)
    out, seen = [], set()
    for _, _, r in cand:   # 同じ町（町名がなければ同じ市区町村）は1件だけ（続報が別の日の記録になっている場合に、同じ場所が並ばないように）
        k = (r['pref'], r['city'], r['town'])
        if k in seen: continue
        seen.add(k); out.append(r)
        if len(out) >= n: break
    return out

def weekly_summary(mon):
    rs = _week_recs(mon)
    prefs = collections.Counter(r['pref'] for r in rs)
    days = [0] * 7
    for r in rs: days[datetime.date.fromisoformat(_jst_day(r)).weekday()] += 1
    kinds = collections.Counter((rec_kind(r) or '').removesuffix('火災') or '種類不明' for r in rs)   # 「車両火災」と「車両」を1つに数える
    return {'n': len(rs), 'prefs': prefs, 'days': days, 'kinds': kinds, 'notable': _notable(rs), 'n_town': sum(1 for r in rs if r['town'])}

def week_page(mon, prev_mon, next_mon):
    s = weekly_summary(mon)
    rng = f'{mon.year}年{_wrange(mon)}'
    top_p, top_n = (s['prefs'].most_common(1) or [('', 0)])[0]
    title = f'{rng}の全国の火事まとめ（{s["n"]:,}件）｜{SITE_NAME}'
    desc = (f'{_wrange(mon)}に{SITE_NAME}が記録した全国の火事{s["n"]:,}件を、曜日・都道府県・建物の種類ごとにまとめました。'
            + (f'件数が最も多かった都道府県は{top_p}（{top_n:,}件）。' if top_p else ''))
    prev = weekly_summary(prev_mon) if prev_mon else None
    wd = ['月', '火', '水', '木', '金', '土', '日']
    dmax = max(range(7), key=lambda i: s['days'][i])
    m = mon.month
    rank = sorted(range(12), key=lambda i: -NAT_MONTH[i]).index(m - 1) + 1
    pts = [f'この週に記録した火事は<strong>{s["n"]:,}件</strong>（うち町名まで分かったもの {s["n_town"]:,}件）',
           f'件数が最も多かった都道府県は<strong>{esc(top_p)}（{top_n:,}件）</strong>' if top_p else '',
           f'曜日では{wd[dmax]}曜日が最も多い{s["days"][dmax]:,}件']
    toc = [('wk-day', '曜日ごとの件数'), ('wk-pref', '都道府県ごとの件数'), ('wk-kind', '建物の種類'), ('wk-ntb', '目立った火事'), ('wk-season', 'この時期に気をつけたいこと')]
    pref_rows = [(p, v) for p, v in s['prefs'].most_common(10)]
    pref_links = ''.join(f'<a href="{esc(pref_file(p))}">{esc(p)}<span class="cnt">{v}</span></a>' for p, v in s['prefs'].most_common())
    kd = '・'.join(f'{esc(k)} {v:,}件' for k, v in sorted(s['kinds'].most_common(8), key=lambda kv: kv[0] == '種類不明'))   # 不明は最後に
    ntb = ''.join(f'<li class="news-item"><div class="row"><a class="place" href="{esc(fire_href(r["fid"]))}"><b>{esc(place_of(r["pref"], r["city"], r["town"]))}</b></a>'
                  + (f'<span class="tag">{esc(rec_kind(r))}</span>' if rec_kind(r) else '') + f'</div><span class="small muted">{jday(_jst_day(r))}</span></li>'
                  for r in s['notable'])
    cmp_ = (f'<p class="small muted">前の週（{_wrange(prev_mon)}）は{prev["n"]:,}件でした。収録している情報源が増え続けているため、週ごとの件数は単純には比べられません。</p>' if prev else '')
    nav = ''.join([f'<a class="btn" href="{esc(week_file(prev_mon))}">← 前の週（{_wrange(prev_mon)}）</a>' if prev_mon else '',
                   f'<a class="btn" href="{esc(week_file(next_mon))}">次の週（{_wrange(next_mon)}）→</a>' if next_mon else '',
                   '<a class="btn" href="weekly.html">週のまとめの一覧</a>'])
    body = f'''<section class="hero"><div class="wrap">
  <p class="crumb"><a href="index.html">トップ</a> ／ <a href="weekly.html">週の火事まとめ</a> ／ {esc(_wrange(mon))}</p>
  <h1>{esc(rng)}の全国の火事まとめ</h1>
  <p class="lead">{SITE_NAME}が報道・消防本部の発表から記録した、この週の全国の火事を数字でまとめました。</p>
</div></section>
<div class="wrap article">
<aside class="g-points" aria-label="この記事でわかること"><p class="g-points-h">この記事でわかること</p><ul>{"".join(f"<li>{p}</li>" for p in pts if p)}</ul></aside>
<nav class="g-toc" aria-label="目次"><p class="g-toc-h">目次</p><ol>{"".join(f'<li><a href="#{i}">{t}</a></li>' for i, t in toc)}</ol></nav>
<section class="section" aria-labelledby="wk-day"><h2 id="wk-day">曜日ごとの件数</h2>
{fig(art_cols([(wd[i], s["days"][i]) for i in range(7)], f"{_wrange(mon)}の曜日ごとの火事（{s['n']:,}件）", 1), f"{SITE_NAME}の記録（収録分のみ）")}
{cmp_}</section>
<section class="section" aria-labelledby="wk-pref"><h2 id="wk-pref">都道府県ごとの件数</h2>
{fig(art_bars(pref_rows, "件数の多い都道府県（上位10）"), f"{SITE_NAME}の記録（収録分のみ）")}
<p class="small">都道府県のページで、市区町村・町ごとの火事の記録を見られます。</p><div class="town-grid">{pref_links}</div></section>
<section class="section" aria-labelledby="wk-kind"><h2 id="wk-kind">建物の種類</h2><p class="small">{kd}</p></section>
<section class="section" aria-labelledby="wk-ntb"><h2 id="wk-ntb">目立った火事</h2>
{f'<p class="small">複数の報道があった火事などを、最大10件まで並べています。くわしくは各ページをご覧ください。</p><ul class="news">{ntb}</ul>' if ntb else '<p class="small muted">この週は、ここに並べる火事はありませんでした。</p>'}</section>
<section class="section g-tip" aria-labelledby="wk-season"><h2 id="wk-season">この時期に気をつけたいこと</h2>
<p>{m}月は、全国で{NAT_MONTH[m - 1]:,}件の火事が起きた月です（2024年。1年のうち{rank}番目に多い月）。{esc(WEEK_TIPS[m])}</p>
<p class="small"><a href="g-stats.html">火事が多い月・時間帯・曜日は？</a>　<a href="g-cause.html">火事の原因ランキング</a></p></section>
<aside class="g-cta"><p class="g-cta-h">あなたの町の「いまの火事」を見る</p>
<p>都道府県・市区町村・町名で検索すると、その町の報道・消防の発表・近所の人の報告をまとめて見られます。</p>
<p><a class="btn" href="index.html">町名で検索する</a></p></aside>
<div class="btn-row">{nav}</div>
{share_block(f"{rng}の全国の火事まとめ（{s['n']:,}件） #火事速", week_file(mon))}
<section class="section" aria-labelledby="wk-src"><h2 id="wk-src">出典・数え方</h2>
<p class="small muted">件数は、{SITE_NAME}が報道（場所と日付だけを使い、見出しは保存していません）・消防本部の出動情報・自治体の公開データから記録した火事のうち、この週の日付のものです（収録分のみで、すべての火事ではありません）。同じ日・同じ町の報道と消防の発表は1件にまとめています。月ごとの全国の件数は<a href="{esc(NAT_SRC[1])}" target="_blank" rel="noopener">{esc(NAT_SRC[0])}</a>によります。</p></section>
</div>'''
    return page(week_file(mon)[:-5], title, desc, body, ld_extra=[bc_ld([('週の火事まとめ', 'weekly.html'), (_wrange(mon), None)])])

def weekly_pages(today=None):
    ws = weekly_weeks(today)
    pages = {}
    for i, mon in enumerate(ws):
        pages[week_file(mon)] = week_page(mon, ws[i - 1] if i else None, ws[i + 1] if i + 1 < len(ws) else None)
    lis = ''.join(f'<li class="news-item"><div class="row"><a class="place" href="{esc(week_file(mon))}"><b>{mon.year}年{esc(_wrange(mon))}</b></a></div>'
                  f'<span class="small muted">{weekly_summary(mon)["n"]:,}件</span></li>' for mon in reversed(ws))
    pages['weekly.html'] = page('weekly', f'週の火事まとめ（全国）｜{SITE_NAME}',
        f'{SITE_NAME}が記録した全国の火事を、1週間（月曜〜日曜）ごとに、曜日・都道府県・建物の種類でまとめています。毎週月曜に前の週の分を追加します。',
        f'''<section class="hero"><div class="wrap"><p class="crumb"><a href="index.html">トップ</a> ／ 週の火事まとめ</p><h1>週の火事まとめ（全国）</h1>
<p class="lead">1週間（月曜〜日曜）に記録した全国の火事を、数字でふり返ります。毎週月曜に前の週の分を追加します。</p></div></section>
<div class="wrap"><section class="section">{f'<ul class="news">{lis}</ul>' if lis else '<p class="small muted">まだまとめはありません。</p>'}
<p class="small"><a href="index.html">いまの火事を町名で探す →</a>　<a href="guide.html">火事の調べ方・備え →</a></p></section></div>''',
        ld_extra=[bc_ld([('週の火事まとめ', None)])])
    return pages

# ── 週のまとめの SNS 用素材（backlog G8・docs/growth.md の C6）──────────────────────────
# 終わった週のうち一番新しい週について、ops/social/weekly/<月曜>/ に data.json（画像の材料）と post.md（文面）を書く。
# 画像（1080×1350 のスライド）は weekly_social.js が data.json から作る。Muse が TikTok・YouTube ショート・note・はてなブログに手で使う。
# 遅れて入る報道があるので、週が終わってから2日目（火曜）以降に1回だけ作り、できたら書き換えない（毎回の保存で画像が変わらないように）。
# 文のきまり（docs/growth.md 2章）：煽らない・けが人や番地を書かない・町名まで分かった火事だけ。check_social.py が確かめる。
WEEKLY_SOCIAL_DESTS = ('tiktok', 'youtube', 'note', 'hatena')

def weekly_social_data(today=None):
    today = today or datetime.datetime.now(JST).date()
    ws = weekly_weeks(today)
    if not ws: return None
    mon = ws[-1]
    if today < mon + datetime.timedelta(days=8): return None   # 火曜より前は作らない（遅れて入る記録を待つ）
    s = weekly_summary(mon)
    wd = ['月', '火', '水', '木', '金', '土', '日']
    m = mon.month
    nb = [{'place': place_of(r['pref'], r['city'], r['town']), 'day': jday(_jst_day(r)), 'kind': rec_kind(r) or ''}
          for r in s['notable'] if r['town']][:5]
    return {'mon': mon.isoformat(), 'range': f'{mon.year}年{_wrange(mon)}', 'short': _wrange(mon),
            'url': f'{SITE_URL}/{week_file(mon)}', 'n': s['n'], 'n_town': s['n_town'],
            'days': [[wd[i], s['days'][i]] for i in range(7)], 'prefs': s['prefs'].most_common(5),
            'kinds': [kv for kv in s['kinds'].most_common(5) if kv[0] != '種類不明'][:4], 'notable': nb,
            'month': m, 'nat_month': NAT_MONTH[m - 1], 'tip': WEEK_TIPS[m]}

def weekly_social_md(d):
    u = lambda dest: social_utm(d['url'], dest, 'weekly')
    top = '・'.join(f'{p} {v:,}件' for p, v in d['prefs'][:3])
    nb = '\n'.join(f'- {x["day"]} {x["place"]}' + (f'（{x["kind"]}）' if x['kind'] else '') for x in d['notable'])
    tags = '#火事 #防災 #火事速'
    return f'''# 週の火事まとめ {d["range"]}（SNS 用の素材）

自動で作った素材です（`site/weekly.py` の `weekly_social_data`）。画像は同じフォルダの `slide-1.png`〜。投稿は Muse が手で行う。
件数は火事速が記録した分だけです（すべての火事ではありません）。前の週と比べて「増えた・減った」とは書かないでください（収録元が増え続けているため）。

## TikTok（写真の投稿・画像をすべて選ぶ）
{d["short"]}に火事速が記録した全国の火事は{d["n"]:,}件。多かったのは{top}。
{d["tip"]}
くわしくはプロフィールのリンクから。{tags}

## YouTube ショート
タイトル：{d["short"]}の全国の火事まとめ（{d["n"]:,}件）{tags.split()[0]}
説明：{d["range"]}に火事速が記録した全国の火事を、曜日・都道府県ごとにまとめました。{d["tip"]}
{u("youtube")}

## note・はてなブログ（本文）
{d["range"]}に、火事速（kajisoku.jp）が報道と消防本部の発表から記録した全国の火事は{d["n"]:,}件でした（うち町名まで分かったもの {d["n_town"]:,}件）。

件数の多かった都道府県：{top}

{"町名まで分かった主な火事：" + chr(10) + nb + chr(10) if nb else ""}
{d["month"]}月は、全国で{d["nat_month"]:,}件の火事が起きた月です（消防庁、2024年）。{d["tip"]}

週のまとめの全体（曜日・都道府県・建物の種類）：
- note 用：{u("note")}
- はてなブログ用：{u("hatena")}
'''

def write_weekly_social(root, today=None):
    """ops/social/weekly/<月曜>/ に data.json と post.md を書く（まだないときだけ）。書いたフォルダを返す"""
    d = weekly_social_data(today)
    if not d: return None
    out = root / 'ops' / 'social' / 'weekly' / d['mon']
    if (out / 'data.json').exists(): return None
    out.mkdir(parents=True, exist_ok=True)
    (out / 'data.json').write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    (out / 'post.md').write_text(weekly_social_md(d), encoding='utf-8')
    return out
