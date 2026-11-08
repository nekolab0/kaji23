# 読み物（ガイド記事）と、都道府県ごとの「火災の案内ダイヤル」一覧のページ
# build.py の名前空間で exec される（page・esc・SITE_NAME・SITE_URL・DIAL・RECORDS・bc_ld・push_box などを使う）
import datetime as _dt
import re as _re
exec((SITE / 'guide_art.py').read_text(encoding='utf-8'))   # 図・イラスト（オリジナルの SVG）

GUIDE_UPDATED = '2026-11-05'   # 一覧ページ用
# 記事ごとの公開日・更新日（記事を足しても、ほかの記事の更新日は変わらないように）
GUIDE_DATES = {'kajidoko': ('2026-11-05', '2026-11-08'), 'siren': ('2026-11-05', '2026-11-08'), '119': ('2026-11-05', '2026-11-08'), 'cause': ('2026-11-05', '2026-11-08'), 'taika-itoigawa': ('2026-11-08', '2026-11-08')}
GUIDE_OG = []   # og.js で記事ごとの OG 画像を作るための情報

# 外部のフリー素材（写真AC・イラストAC）。1200×675 に整えて site/assets/img/ に置き、dist/assets/img/ へコピーする
PHOTOS = {
    'kajidoko': ('g-kajidoko.png', '炎と煙が上がる家のイラスト', 'イラストAC'),
    'siren': ('g-siren.png', '赤い消防ポンプ自動車のイラスト', 'イラストAC'),
    '119': ('g-119.jpg', 'スマートフォンの画面に表示された「119」', '写真AC'),
    'cause': ('g-cause.png', 'こんろの鍋から火が上がるイラスト', 'イラストAC'),
    'taika-itoigawa': ('g-taika-itoigawa.jpg', '糸魚川駅の駅舎と赤れんがの建物', '写真AC'),
}

def photo(slug):
    """記事のアイキャッチ。画像ファイルがまだなければ None（オリジナルの SVG を使う）"""
    f, alt, src = PHOTOS.get(slug, (None, '', ''))
    if not f or not (SITE / 'assets' / 'img' / f).exists():
        return None
    return f'<img src="assets/img/{f}" width="1200" height="675" alt="{esc(alt)}" decoding="async"><span class="g-credit">{esc(src)}</span>'

def _src(items):
    return ('<section class="section" aria-labelledby="src"><h2 id="src">出典・参考</h2><ul class="plain">'
            + ''.join(f'<li><a href="{esc(u)}" target="_blank" rel="noopener">{esc(n)} ↗</a></li>' for n, u in items) + '</ul></section>')

def _article_ld(slug, title, desc):
    pub, mod = GUIDE_DATES.get(slug, (GUIDE_UPDATED, GUIDE_UPDATED))
    return {"@context": "https://schema.org", "@type": "Article", "headline": title, "description": desc,
            "datePublished": pub, "dateModified": mod, "inLanguage": "ja", "image": [f'{SITE_URL}/og/g-{slug}.png'],
            "author": {"@type": "Organization", "name": SITE_NAME, "url": SITE_URL + '/'},
            "publisher": {"@type": "Organization", "name": SITE_NAME}, "mainEntityOfPage": f'{SITE_URL}/g-{slug}.html'}

def _kind_stats(days=30):
    """火事速の記録（直近30日）の種別ごとの件数"""
    today = max((r['day'] for r in RECORDS), default=None)
    if not today: return [], 0
    since = (_dt.date.fromisoformat(today) - _dt.timedelta(days=days)).isoformat()
    rs = [r for r in RECORDS if r['day'] > since]
    def norm(k):
        if not k: return None
        if '車' in k: return '車両火災'
        if '林野' in k or '山林' in k: return '林野火災'
        if '枯' in k or '草' in k: return '枯草火災'
        if k in ('その他火災', 'その他', '船舶火災', '航空機火災'): return 'その他の火災'
        return '建物火災'   # 住宅・共同住宅・店舗・工場など
    c = collections.Counter(n for n in (norm(rec_kind(r)) for r in rs) if n)
    return c.most_common(8), sum(c.values())

def _plain_len(html):
    return len(_re.sub(r'<[^>]+>|\s', '', html))

def guide_article(slug, title, h1, desc, lead, body, sources, related, art=None):
    """読み物のページ。art: {'hero': SVG, 'points': [要点], 'figs': {見出しの一部: 図のHTML}, 'warn': [見出しの一部], 'tip': [見出しの一部]}"""
    art = art or {}
    # 見出しに番号の id を振り、目次を作る。図は対応する見出しの直後に差し込む
    toc, n = [], [0]
    def h2(m):
        n[0] += 1; t = m.group(1); hid = f'h{n[0]}'; toc.append((hid, _re.sub('<[^>]+>', '', t)))
        extra = ''.join(f for k, f in (art.get('figs') or {}).items() if k in t)
        return f'<h2 id="{hid}">{t}</h2>{extra}'
    body2 = _re.sub(r'<h2>(.*?)</h2>', h2, body)
    for k in art.get('warn', []): body2 = _re.sub(r'<section class="section">(<h2 id="h\d+">[^<]*' + _re.escape(k) + ')', r'<section class="section g-warn">\1', body2)
    for k in art.get('tip', []): body2 = _re.sub(r'<section class="section">(<h2 id="h\d+">[^<]*' + _re.escape(k) + ')', r'<section class="section g-tip">\1', body2)
    mins = max(1, round(_plain_len(body) / 500))
    pts = ''.join(f'<li>{p_}</li>' for p_ in art.get('points', []))
    points = f'<aside class="g-points" aria-label="この記事でわかること"><p class="g-points-h">この記事でわかること</p><ul>{pts}</ul></aside>' if pts else ''
    tocs = ''.join(f'<li><a href="#{hid}">{esc(t)}</a></li>' for hid, t in toc)
    toc_html = f'<nav class="g-toc" aria-label="目次"><p class="g-toc-h">目次</p><ol>{tocs}</ol></nav>' if len(toc) >= 3 else ''
    hero = f'<figure class="g-hero">{art["hero"]}</figure>' if art.get('hero') else ''
    rel = ''.join(f'<li><a href="g-{esc(s_)}.html">{esc(t_)}</a></li>' for s_, t_ in related)
    cta = f'''<aside class="g-cta"><p class="g-cta-h">あなたの町の「いまの火事」を見る</p>
<p>都道府県・市区町村・町名で検索すると、その町の報道・消防の発表・近所の人の報告をまとめて見られます。町のページの「火事を通知で受け取る」で、次に火事があったときにスマホへ知らせることもできます。</p>
<p><a class="btn" href="index.html">町名で検索する</a></p></aside>'''
    html = f'''<section class="hero"><div class="wrap">
  <p class="crumb"><a href="index.html">トップ</a> ／ <a href="guide.html">火事の調べ方・備え</a></p>
  <h1>{esc(h1)}</h1>
  <p class="lead">{lead}</p>
  <p class="small muted">{SITE_NAME}編集部　更新：{GUIDE_DATES.get(slug, (0, GUIDE_UPDATED))[1].replace("-", "/")}　約{mins}分で読めます</p>
</div></section>
<div class="wrap article">
{hero}
{points}
{toc_html}
{body2}
{cta}
{_src(sources)}
<section class="section" aria-labelledby="more"><h2 id="more">あわせて読みたい</h2><ul class="plain">{rel}<li><a href="guide.html">火事の調べ方・備えの記事一覧</a></li></ul></section>
</div>'''
    GUIDE_OG.append({'slug': slug, 'h1': h1, 'hero': art.get('hero', '')})
    return page(f'g-{slug}', f'{title}｜{SITE_NAME}', desc, html, og_image=f'og/g-{slug}.png', ld_extra=[bc_ld([('火事の調べ方・備え', 'guide.html'), (h1, None)]), _article_ld(slug, title, desc)])

def guide_pages():
    pages = {}
    stats, n30 = _kind_stats()
    stat_rows = ''.join(f'<tr><td>{esc(k)}</td><td class="num">{v}件</td></tr>' for k, v in stats)
    G = [
      ('kajidoko', '近くで火事？今どこで火事か調べる方法5つ（サイレン・煙が気になったとき）', '今どこで火事？を調べる方法5つ',
       'サイレンや煙に気づいたとき、どこで火事が起きているかを調べる方法を5つ紹介します。消防の案内ダイヤル、自治体の火災メール、X・ニュース、火事速の町名検索の使い分けと、やってはいけないこと。',
       'サイレンが続けて聞こえる、煙が見える。「どこで火事？」と気になったときに、落ち着いて場所を確かめる方法をまとめました。',
       f'''<section class="section"><h2>まず：火や煙が目の前に見えたら、すぐ119番</h2>
<p>自分の家や近所で火や煙が見えているなら、調べる前に<strong>119番</strong>です。「誰かがもう通報しただろう」と思わず、見つけた人が通報してください。伝え方は<a href="g-119.html">119番通報の伝え方</a>にまとめています。</p>
<p>一方で、<strong>「どこで火事か知りたい」だけで119番にかけるのはやめてください。</strong>本当に助けが必要な人の通報がつながりにくくなります。場所を確かめたいときは、次の方法を使います。</p></section>
<section class="section"><h2>1. 消防本部の「案内ダイヤル」に電話する</h2>
<p>多くの消防本部は、いま出動している火災・災害を自動音声で案内する電話（災害案内ダイヤル・テレホンサービス）を用意しています。いちばん確実な一次情報です。全国の番号は<a href="dial-list.html">都道府県別の案内ダイヤル一覧</a>から探せます。</p></section>
<section class="section"><h2>2. 自治体・消防本部の「火災メール」やWebの出動情報を見る</h2>
<p>市町村によっては、火災が起きると町名入りでメールを配信したり、Webに出動情報を載せたりしています。住んでいる地域で登録しておくと、次から真っ先に分かります。各市区町村のページに、わかっている公式の出動情報ページを載せています。</p></section>
<section class="section"><h2>3. 火事速で町名を検索する</h2>
<p>{SITE_NAME}では、<a href="index.html">トップの検索</a>から都道府県・市区町村・町名を入れると、その町の火事の報道、消防の発表、近所の人のサイレン・煙の報告をまとめて見られます。気づいたことをボタンひとつで共有することもできます。</p>
<p>よく見る町は、ページの「火事を通知で受け取る」ボタンで登録しておくと、次に火事があったときに通知が届きます。</p></section>
<section class="section"><h2>4. X（旧Twitter）やニュースで町名＋「火事」を検索する</h2>
<p>近くの人が写真や動画を投稿していることがあります。各町のページの「Xで見る」「Yahoo!リアルタイム検索」のボタンから、町名と「火事」で検索した結果を開けます。ただし、投稿は確認された情報ではありません。古い写真の使い回しや、別の場所の火事のこともあります。</p></section>
<section class="section"><h2>5. 煙の方角と、サイレンの音で見当をつける</h2>
<p>消防車は火災出動のときに「ウーウー」に鐘の「カンカン」を合わせて鳴らすことが多く、救急車は「ピーポー」です。音の違いは<a href="g-siren.html">サイレンの見分け方</a>で説明しています。</p></section>
<section class="section"><h2>やってはいけないこと</h2>
<ul class="plain"><li>確かめるための119番・110番</li><li>現場に見に行くこと（消防活動の妨げになり、煙を吸う危険もあります）</li><li>被害にあった家の人がわかる写真や、根拠のない原因（放火など）を投稿・拡散すること</li></ul></section>''',
       [('総務省消防庁「119番通報について」', 'https://www.fdma.go.jp/'), ('東京消防庁「119番通報」', 'https://www.tfd.metro.tokyo.lg.jp/lfe/119/119.html')],
       [('siren', 'サイレンの見分け方'), ('119', '119番通報の伝え方'), ('cause', '火事の原因ランキング')]),
      ('siren', '消防車のサイレン「ウーウーカンカン」の意味は？救急車・パトカーとの違い', 'サイレンの見分け方（消防車・救急車）',
       '消防車の「ウーウー」と鐘の「カンカン」はどう使い分けられているのか。火災出動・救助出動・救急車の音の違いと、近くでサイレンが鳴ったときに火事かどうかを確かめる方法。',
       'サイレンが聞こえたとき、それが火事なのか救急なのかは、音である程度見分けられます。ただし使い分けは消防本部ごとに違うので、目安として読んでください。',
       '''<section class="section"><h2>消防車：「ウーウー」と鐘の「カンカン」</h2>
<p>消防車は、サイレンの「ウーウー」と、鐘（警鐘）の「カンカン」を組み合わせて鳴らします。多くの消防本部では、<strong>火災に出動するときはサイレンと鐘をいっしょに</strong>鳴らし、救助や警戒など火災以外の出動ではサイレンだけにする、といった使い分けをしています。</p>
<p>たとえば秋田市消防本部は、火災出動は「ウーウーカンカン」、救助出動など火災以外は「ウーウー」と、音で災害の種類が分かるように運用を変えたと案内しています。鐘だけを鳴らして走るのは、火災予防の巡回や、現場から引き上げるときなどに使われることがあります。</p></section>
<section class="section"><h2>救急車：「ピーポー」</h2>
<p>救急車は「ピーポー」というサイレンです。救急車の近くで消防車の音が混ざるときは、救急に消防隊が一緒に向かう出動（はしご車で救助するときなど）の場合もあります。</p></section>
<section class="section"><h2>パトカー：「ウー」の連続音</h2>
<p>パトカーは「ウー」という連続音で、消防車の鐘の音はありません。</p></section>
<section class="section"><h2>「カンカン」が聞こえたら、火事かどうかを確かめるには</h2>
<p>鐘が混ざる音が続くときは、近くで火災出動がある可能性があります。場所を確かめるには、<a href="dial-list.html">消防本部の案内ダイヤル</a>や、<a href="index.html">火事速の町名検索</a>を使ってください。確かめるための119番は使わないでください。くわしくは<a href="g-kajidoko.html">今どこで火事か調べる方法</a>にまとめています。</p></section>''',
       [('秋田市「消防車両のサイレン吹鳴方法を変更します」', 'https://www.city.akita.lg.jp/shobo/oshirase/1012634.html'), ('乗りものニュース「消防車『カンカン』の意味」', 'https://trafficnews.jp/post/75896')],
       [('kajidoko', '今どこで火事か調べる方法'), ('119', '119番通報の伝え方')]),
      ('119', '火事を見つけたら：119番通報の伝え方（聞かれる順番と答え方）', '119番通報の伝え方（火事のとき）',
       '火事を見つけたときの119番通報で聞かれることと答え方。「火事です」→住所→燃えているもの→通報者の名前。携帯電話からの注意点、住所がわからないときの伝え方。',
       '119番では、聞かれる順番が決まっています。順番どおりに答えれば、あわてていても必要なことが伝わります。',
       '''<section class="section"><h2>聞かれる順番</h2>
<ol class="plain"><li><strong>「火事ですか、救急ですか」</strong> → 「火事です」</li>
<li><strong>「住所はどこですか」</strong> → 市区町村から、町・丁目・番地、建物名・部屋番号まで</li>
<li><strong>「何が燃えていますか」</strong> → 「2階の部屋が燃えています」「車が燃えています」など</li>
<li><strong>逃げ遅れた人・けが人がいるか</strong>、通報している人の名前と電話番号</li></ol>
<p>聞き間違いを防ぐために、住所などを2回聞かれることがあります。</p></section>
<section class="section"><h2>住所がわからないとき</h2>
<p>外出先などで住所がわからないときは、近くの<strong>交差点の名前、目立つ建物・お店、電柱の番号</strong>などを伝えます。同じ町名が別の市にあることもあるので、最初に市区町村名を伝えてください。</p></section>
<section class="section"><h2>携帯電話からかけるとき</h2>
<p>通報のあと、消防から確認の電話がかかってくることがあります。消防車が着くまで電源を切らず、つながる状態にしておいてください。</p></section>
<section class="section"><h2>通報のあと</h2>
<p>自分の安全を最優先に、煙を吸わないよう低い姿勢で離れます。消火器で消せるのは、火が天井に届く前までが目安です。</p></section>''',
       [('東京消防庁「119番通報」', 'https://www.tfd.metro.tokyo.lg.jp/lfe/119/119.html'), ('千葉県「119番のかけ方」', 'https://www.pref.chiba.lg.jp/bousaik/jibun/koudou/119kakekata.html')],
       [('kajidoko', '今どこで火事か調べる方法'), ('cause', '火事の原因ランキング')]),
      ('cause', '火事の原因ランキング：1位はたばこ（令和6年・消防白書）と、身近な火事の傾向', '火事の原因ランキング（消防白書）',
       '令和6年に全国で起きた火事は37,141件、1日当たり約102件。原因の1位はたばこ、2位たき火、3位こんろ（令和7年版消防白書）。火事速の記録から見た直近の火事の種類も紹介します。',
       '全国では、1日に100件ほどの火事が起きています。どんな原因が多いのかを知ると、家でできる備えが見えてきます。',
       f'''<section class="section"><h2>全国の火事は1年で37,141件</h2>
<p>令和7年版消防白書によると、令和6年（2024年）中に全国で起きた火事は<strong>37,141件</strong>でした。1日当たり約102件、およそ14分に1件の割合です。</p></section>
<section class="section"><h2>原因の上位3つ</h2>
<details class="g-data"><summary>数字で見る</summary><table class="tbl"><thead><tr><th>順位</th><th>原因</th><th>件数（令和6年）</th></tr></thead><tbody>
<tr><td>1</td><td>たばこ</td><td class="num">3,058件</td></tr><tr><td>2</td><td>たき火</td><td class="num">2,781件</td></tr><tr><td>3</td><td>こんろ</td><td class="num">2,718件</td></tr></tbody></table></details></section>
<section class="section"><h2>家でできる備え</h2>
<ul class="plain"><li><strong>たばこ</strong>：寝たばこをしない。灰皿に水を入れ、吸い殻をためない</li>
<li><strong>たき火</strong>：風の強い日・乾燥した日はしない。その場を離れない。消火用の水を用意する</li>
<li><strong>こんろ</strong>：火をつけたまま離れない。鍋の油が少ない揚げ物に注意。こんろの周りに燃えやすいものを置かない</li>
<li><strong>住宅用火災警報器</strong>：設置から10年たったものは交換の目安です</li></ul></section>
<section class="section"><h2>火事速の記録から（直近30日・種類がわかった{n30}件）</h2>
<p>{SITE_NAME}が報道・消防本部の発表から記録した、直近30日の火事の種類です（収録分のみで、すべての火事ではありません）。</p>
<details class="g-data"><summary>数字で見る</summary><table class="tbl"><thead><tr><th>種類</th><th>件数</th></tr></thead><tbody>{stat_rows}</tbody></table></details>
<p class="small muted">毎日自動で更新しています。</p></section>''',
       [('総務省消防庁「令和7年版 消防白書」火災の現状', 'https://www.fdma.go.jp/publication/hakusho/r7/chapter1/section1/para1/69229.html')],
       [('kajidoko', '今どこで火事か調べる方法'), ('119', '119番通報の伝え方'), ('siren', 'サイレンの見分け方')]),
      ('taika-itoigawa', '糸魚川大火とは？原因・被害とその後、10年で変わったこと（2016年）', '糸魚川大火とは？原因・被害とその後、10年で変わったこと（2016年）',
       '2016年12月22日の糸魚川市駅北大火。こんろの消し忘れから、強い南風と飛び火で約4万㎡・147棟が焼けました。燃え広がった理由と消防の活動、その後に変わった決まり・まちづくり、家やお店でできる備えを公的な報告書からまとめます。',
       '2016年12月22日、新潟県糸魚川市の駅の北側で起きた火事は、約30時間燃え続け、147棟が焼けました。地震によらない市街地の大火としては、1976年の酒田大火以来40年ぶりです。2026年12月で10年。何が起き、何が変わったのかを、国・県の報告書をもとにまとめます。',
       '''<section class="section"><h2>糸魚川大火の概要と被害</h2>
<p>2016年12月22日の午前10時20分ごろ、糸魚川駅の北側（大町1丁目）の飲食店で、<strong>大型こんろの火の消し忘れ</strong>から火が出ました。当日は強い南風が吹いていて、火は風下の北側（海の方向）へ燃え広がりました。</p>
<div class="tbl-wrap"><table class="tbl"><tbody>
<tr><th>出火</th><td>2016年12月22日 午前10時20分ごろ</td></tr>
<tr><th>場所</th><td>新潟県糸魚川市大町1丁目（飲食店）</td></tr>
<tr><th>原因</th><td>大型こんろの消し忘れ</td></tr>
<tr><th>風</th><td>南風。最大瞬間風速27.2m/s（午前11時40分）</td></tr>
<tr><th>焼けた範囲</th><td>約40,000㎡（全焼120棟・半焼5棟・部分焼22棟、計147棟）</td></tr>
<tr><th>けが人</th><td>17人（消防団員15人・一般2人）。亡くなった方はいません</td></tr>
<tr><th>被災</th><td>145世帯・260人・56事業所</td></tr>
<tr><th>消えるまで</th><td>出火から約11時間後に鎮圧、約30時間後に鎮火</td></tr>
</tbody></table></div></section>
<section class="section"><h2>原因と、燃え広がった理由</h2>
<ul>
<li><strong>強い南風</strong>：最大瞬間風速は27.2m/s。風下へ火の粉が飛びました。</li>
<li><strong>飛び火</strong>：火の粉が離れた建物の屋根などに燃え移り、<strong>10か所で同時に</strong>燃え広がりました。消防が1か所を抑えても、別の場所から火が出る状態でした。</li>
<li><strong>古い木造の建物が密集</strong>：火元の一帯は、昔ながらの木造の建物が多く、火に弱い区画でした。</li>
<li><strong>水が足りない</strong>：消火栓や防火水槽の水だけでは足りず、地元の建設会社のコンクリートミキサー車などで水を運びました。</li>
</ul>
<p>国の検討会は「糸魚川市が特に強風の多い地域というわけではない」としています。つまり、<strong>強い風の日に古い木造の家が集まる地域なら、どこでも起こりうる</strong>火事でした。</p></section>
<section class="section"><h2>消防の活動</h2>
<p>糸魚川市の消防だけでは足りず、新潟県内17、長野県1、富山県1の<strong>計19の消防本部</strong>が応援に駆けつけました。強風の中の活動で、消防団員11人が目に異物が入り、2人が釘を踏み抜いてけがをしています。放水に使った消防団の小型ポンプの約3割に不具合が出たこと、携帯無線が足りず指示が届きにくかったことも、課題として報告されました。</p></section>
<section class="section"><h2>その後の10年で変わったこと</h2>
<p>この火事を受けて、国（総務省消防庁）は2017年5月に報告書をまとめ、全国の消防に次のような対策を求めました。</p>
<ul>
<li><strong>燃え広がりやすい地域の計画</strong>：危ない地域を確かめ、その地域での消火の計画をつくる</li>
<li><strong>応援の出し方</strong>：大きな火事では、はじめから持てる力を出して同時に応援を頼む。隣の消防本部は頼まれるのを待たずに出動する</li>
<li><strong>水の確保</strong>：建設業の団体などと、水を運ぶ協定を結ぶ。遠くから大量に水を送る車両（スーパーポンパー）を整える</li>
<li><strong>小さな飲食店にも消火器</strong>：これまで義務がなかった<strong>延べ面積150㎡未満の飲食店</strong>でも、こんろなど火を使う設備があれば消火器を置くことが義務になりました（2019年10月1日から）</li>
</ul>
<p>糸魚川のまちも変わりました。焼けた地区には、2020年4月に駅北広場「キターレ」ができ、その地下には国内最大級の耐震性防火水槽がつくられました。周りには、火に強い木（シラカシ・ケヤキ）を植えた小さな公園が8か所整えられています。</p></section>
<section class="section"><h2>家やお店でできること</h2>
<ul>
<li><strong>こんろから離れるときは、必ず火を消す</strong>。糸魚川大火は、この1つから始まりました</li>
<li>飲食店は、厨房の換気扇・排気ダクトの油汚れを定期的に掃除する</li>
<li>家に<strong>消火器</strong>と<strong>住宅用火災警報器</strong>を。1か所で鳴ると家中で鳴る「連動型」なら、離れた部屋の火事にも気づけます</li>
<li><strong>風の強い日</strong>は、たき火や屋外での火の使用をやめる。近くで火事があれば、飛んでくる火の粉に気をつけ、家のまわりの燃えやすいものを片づける</li>
<li>高齢の家族や近所の人の避難を、ふだんから話し合っておく</li>
</ul>
<p>原因で多いものは<a href="g-cause.html">火事の原因ランキング</a>にまとめています。</p></section>
<section class="section"><h2>糸魚川市の、いまの火事情報</h2>
<p>糸魚川市で最近あった火事や、近所の人の報告は<a href="c-新潟県-糸魚川市.html">糸魚川市の火事情報</a>で見られます。サイレンが聞こえたときは<a href="g-kajidoko.html">今どこで火事か調べる方法</a>もどうぞ。</p></section>''',
       [('新潟県 災害アーカイブ「糸魚川市駅北大火」', 'https://www.pref.niigata.lg.jp/site/saigai-archive/itoigawa-daikibokasai.html'),
        ('総務省消防庁「糸魚川市大規模火災を踏まえた今後の消防のあり方に関する検討会」報告書（2017年5月19日）', 'https://www.fdma.go.jp/pressrelease/houdou/assets/290519_houdou_1.pdf'),
        ('宮城県「小規模飲食店等における消火器具の設置義務化について」', 'https://www.pref.miyagi.jp/soshiki/syoubou/syoukiboinsyokuten.html')],
       [('cause', '火事の原因ランキング'), ('kajidoko', '今どこで火事か調べる方法'), ('119', '119番通報の伝え方')]),
    ]
    ART = {
      'kajidoko': {'hero': photo('kajidoko') or art_kajidoko_hero(),
        'points': ['火や煙が目の前に見えたら、調べる前に<strong>119番</strong>', '場所を知りたいだけなら、<strong>案内ダイヤル・火災メール・火事速</strong>で確かめる', 'X の投稿は未確認の情報。<strong>確かめるための119番や現場見物はしない</strong>'],
        'figs': {'まず：': fig(art_kajidoko_flow(), '見えているか・知りたいだけかで、やることが変わります')}, 'warn': ['やってはいけないこと']},
      'siren': {'hero': photo('siren') or art_siren_hero(),
        'points': ['消防車は火災出動のとき「<strong>ウーウー＋カンカン</strong>」が多い', '救急車は「<strong>ピーポー</strong>」、パトカーは「<strong>ウー</strong>」', '使い分けは消防本部ごとに違う。場所は<strong>案内ダイヤルや火事速</strong>で確かめる'],
        'figs': {'消防車：': fig(art_siren_waves(), '3つのサイレンの音の動きのイメージ')}, 'tip': ['確かめるには']},
      '119': {'hero': photo('119') or art_119_hero(),
        'points': ['最初に「<strong>火事です</strong>」', '次に<strong>住所</strong>（市区町村から）と、<strong>何が燃えているか</strong>', '住所がわからなければ<strong>交差点・目立つ建物・電柱の番号</strong>'],
        'figs': {'聞かれる順番': fig(art_119_steps(), '119番で聞かれる順番と、答え方の例')}, 'tip': ['住所がわからないとき']},
      'cause': {'hero': photo('cause') or art_cause_hero(),
        'points': ['全国の火事は1年で<strong>37,141件</strong>（1日に約102件）', '原因の1位は<strong>たばこ</strong>、2位たき火、3位こんろ', '火事速の記録では、直近30日は<strong>建物火災</strong>がいちばん多い'],
        'figs': {'原因の上位3つ': fig(art_bars([('たばこ', 3058), ('たき火', 2781), ('こんろ', 2718)], '火事の原因 上位3つ（令和6年・全国）'), '出典：総務省消防庁「令和7年版 消防白書」'),
                 '火事速の記録から': fig(art_bars(stats, f'火事速の記録 直近30日の種類（{n30}件）', color='#2f6fb3'), '火事速が報道・消防本部の発表から記録したもの（毎日自動で更新）')},
        'tip': ['家でできる備え']},
      'taika-itoigawa': {'hero': photo('taika-itoigawa'),
        'points': ['原因は<strong>大型こんろの消し忘れ</strong>。強い南風と<strong>飛び火</strong>で10か所に同時に燃え広がった', '約4万㎡・<strong>147棟</strong>が焼け、17人がけが。亡くなった方はいない', 'その後、<strong>小さな飲食店にも消火器</strong>が義務に。まちには耐震性の防火水槽ができた'],
        'figs': {'概要と被害': fig(art_timeline([('10:20ごろ', '飲食店から出火', 'こんろの消し忘れ'), ('11:40', '最大瞬間風速27.2m/s', '飛び火で10か所に'), ('約11時間後', '鎮圧', '19の消防本部が応援'), ('約30時間後', '鎮火', '147棟が焼けた')], '糸魚川大火の時間の流れ（2016年12月22〜23日）'), '出典：新潟県 災害アーカイブ')},
        'warn': ['原因と、燃え広がった理由'], 'tip': ['家やお店でできること']},
    }
    for slug, title, h1, desc, lead, body, sources, related in G:
        pages[f'g-{slug}.html'] = guide_article(slug, title, h1, desc, lead, body, sources, related, ART.get(slug))
    items = ''.join(f'<li><a class="g-card" href="g-{esc(s_)}.html"><span class="g-thumb">{ART[s_]["hero"] or ""}</span><b>{esc(h1)}</b><span class="small muted">{esc(d_[:70])}…</span></a></li>' for s_, _t, h1, d_, *_ in G)
    pages['guide.html'] = page('guide', f'火事の調べ方・備え（ガイド）｜{SITE_NAME}', '近くで火事かどうかの調べ方、サイレンの見分け方、119番通報の伝え方、火事の原因と備えなど、火事にまつわる知識をまとめています。',
        f'''<section class="hero"><div class="wrap"><p class="crumb"><a href="index.html">トップ</a> ／ 火事の調べ方・備え</p><h1>火事の調べ方・備え</h1>
<p class="lead">サイレンや煙に気づいたときの調べ方と、火事に備えるための知識をまとめています。</p></div></section>
<div class="wrap"><section class="section"><ul class="g-cards">{items}</ul>
<p><a href="dial-list.html"><b>都道府県別 火災・災害の案内ダイヤル一覧</b></a><br><span class="small muted">出動中の火災を自動音声で案内する消防本部の電話番号</span></p></section></div>''',
        ld_extra=[bc_ld([('火事の調べ方・備え', None)])])
    pages.update(dial_pages())
    return pages

# ---------- 都道府県ごとの案内ダイヤル一覧 ----------
def dial_file(p): return f'dial-{p}.html'
def dial_pages():
    pages = {}
    by_pref = collections.defaultdict(list)
    for key, d in DIAL.items():
        p, c = key.split('|', 1)
        if d.get('tel') or d.get('web'): by_pref[p].append((c, d))
    order = [p for p in PREFS if p in by_pref]
    for p in order:
        rows = ''.join(
            f'<tr><td><a href="{esc(city_file(p, c))}">{esc(c)}</a></td><td>'
            + '<br>'.join(f'<a class="num" href="tel:{esc(t.replace("-", ""))}">{esc(t)}</a>' for t in d.get('tel', [])) + '</td><td>'
            + ' '.join(f'<a href="{esc(u)}" target="_blank" rel="noopener">公式ページ↗</a>' for u in d.get('web', [])[:2]) + '</td></tr>'
            for c, d in sorted(by_pref[p], key=lambda x: [n for n, _ in AREAS_RAW['prefs'][p]].index(x[0]) if x[0] in [n for n, _ in AREAS_RAW['prefs'][p]] else 999))
        n = len(by_pref[p])
        title = f'【一覧】{p}の火災・災害の案内ダイヤル（テレホンサービス）{n}市区町村｜{SITE_NAME}'
        desc = f'{p}の市区町村ごとの、消防本部の火災・災害の案内ダイヤル（いま出動している火災を自動音声で案内する電話番号）と、公式の出動情報ページの一覧（{n}市区町村）。'
        html = f'''<section class="hero"><div class="wrap"><p class="crumb"><a href="index.html">トップ</a> ／ <a href="guide.html">火事の調べ方・備え</a> ／ <a href="dial-list.html">案内ダイヤル一覧</a> ／ {esc(p)}</p>
<h1>{esc(p)}の火災・災害の案内ダイヤル</h1>
<p class="lead">サイレンが聞こえたとき、いまどこで火災が起きているかを自動音声で案内する、消防本部の電話番号です。<strong>確かめるための119番はやめてください。</strong></p></div></section>
<div class="wrap"><section class="section"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>市区町村</th><th>案内ダイヤル</th><th>出動情報</th></tr></thead><tbody>{rows}</tbody></table></div>
<p class="small muted">番号・ページは各消防本部の公表をもとに集めたものです。変わることがあるため、つながらないときは各消防本部の公式サイトでご確認ください。</p>
<p class="small"><a href="{esc(pref_file(p))}">{esc(p)}の火事情報を見る →</a>　<a href="g-kajidoko.html">今どこで火事か調べる方法 →</a></p></section></div>'''
        pages[dial_file(p)] = page(dial_file(p)[:-5], title, desc, html, ld_extra=[bc_ld([('火事の調べ方・備え', 'guide.html'), ('案内ダイヤル一覧', 'dial-list.html'), (p, None)])])
    links = ''.join(f'<a href="{esc(dial_file(p))}">{esc(p)}<span class="cnt">{len(by_pref[p])}</span></a>' for p in order)
    pages['dial-list.html'] = page('dial-list', f'【都道府県別】火災・災害の案内ダイヤル（テレホンサービス）一覧｜{SITE_NAME}',
        f'全国{sum(len(v) for v in by_pref.values())}市区町村の、消防本部の火災・災害の案内ダイヤル（出動中の火災を自動音声で案内する電話番号）を都道府県別にまとめています。',
        f'''<section class="hero"><div class="wrap"><p class="crumb"><a href="index.html">トップ</a> ／ <a href="guide.html">火事の調べ方・備え</a> ／ 案内ダイヤル一覧</p>
<h1>火災・災害の案内ダイヤル一覧</h1><p class="lead">都道府県を選ぶと、市区町村ごとの番号が見られます。東京23区は東京消防庁の災害情報案内（<a href="dial.html">サイレンが聞こえたら</a>）をご覧ください。</p></div></section>
<div class="wrap"><section class="section"><div class="town-grid">{links}</div></section></div>''', ld_extra=[bc_ld([('火事の調べ方・備え', 'guide.html'), ('案内ダイヤル一覧', None)])])
    return pages
