# 火事・防災クイズ（quiz.html）
# build.py の名前空間で exec される（page・esc・SITE_NAME・SITE_URL・bc_ld・photo などを使う）
# 1回5問を問題集からランダムに出し、選択肢の並びも毎回入れ替える（2択はそのまま）。結果は X・LINE で共有できる。問題を足すときは QUIZ に1行足すだけ。
# 事実は出典つきで書く（出典は QUIZ_SRC の番号）。煽る書き方・怖がらせる書き方はしない。

QUIZ_UPDATED = '2026-11-18'
QUIZ_SRC = {
    'fdma_ext': ('総務省消防庁「消火器の正しい使い方」', 'https://www.fdma.go.jp/mission/prevention/suisin/post2.html'),
    'fdma_jk': ('総務省消防庁「住宅用火災警報器」', 'https://www.fdma.go.jp/html/life/juukei.html'),
    'tfd_119': ('東京消防庁「119番通報」', 'https://www.tfd.metro.tokyo.lg.jp/lfe/119/119.html'),
    'tfd_cloth': ('東京消防庁「STOP！着衣着火」', 'https://www.tfd.metro.tokyo.lg.jp/content/000102451.pdf'),
    'tokyo_ext': ('東京都「消火器・屋内消火栓の使い方」（事業所防災リーダー向け）', 'https://www.bousai.metro.tokyo.lg.jp/_res/projects/default_project/_page_/001/023/387/r535.pdf'),
    'hakusho': ('総務省消防庁「令和7年版 消防白書」', 'https://www.fdma.go.jp/publication/hakusho/'),
    'r6': ('総務省消防庁「令和6年（1～12月）における火災の状況（確定値）」', 'https://www.fdma.go.jp/pressrelease/statistics/items/cfff9e3173795eb802e15902ab9b9a348f3259ad.pdf'),
    'niigata': ('新潟県「糸魚川市駅北大火」災害アーカイブ', 'https://www.pref.niigata.lg.jp/'),
}

# (問題, [選択肢], 正解の番号(0から), 解説, 出典のキー, 関連する記事の slug か None)
QUIZ = [
    ('119番に電話して、最初に伝えることは？', ['住所', '「火事です」', '自分の名前', '何が燃えているか'], 1,
     '最初に「火事です」と伝えます。消防は「火事ですか、救急ですか」から聞くので、それに答える形です。次に住所、何が燃えているかの順に聞かれます。', 'tfd_119', '119'),
    ('「どこで火事か知りたい」だけのとき、119番にかけていい？', ['かけていい', 'かけないほうがいい'], 1,
     '確かめるための119番は、本当に助けが必要な人の通報をつながりにくくします。場所を知りたいときは、消防の案内ダイヤルや火災メール、火事速の町名検索を使います。', 'tfd_119', 'kajidoko'),
    ('消火器を使うときの正しい順番は？', ['レバーを握る → ピンを抜く → ホースを向ける', 'ピンを抜く → ホースを火元に向ける → レバーを握る', 'ホースを向ける → レバーを握る → ピンを抜く'], 1,
     '「ピン・ホース・レバー」の順です。黄色い安全ピンを抜き、ホースを外して火元に向け、レバーを強く握ります。運ぶあいだはピンを抜きません。', 'fdma_ext', None),
    ('消火器で火を消せるのは、炎がどこに届くまでが目安？', ['腰の高さ', '天井', '屋根'], 1,
     '一般的に、炎が天井付近に届くまでは消火器で消せるとされています。炎が天井に届いたら消火をやめて、すぐに逃げます。', 'fdma_ext', None),
    ('消火器は、火からどれくらい離れて使うのが目安？', ['1mくらい', '7〜8mくらい', '20mくらい'], 1,
     '東京都の案内では、7〜8m手前を目安に、出入口を背にして（逃げ道を確保して）使うとしています。火の根元をねらって放射します。', 'tokyo_ext', None),
    ('天ぷら油の鍋から火が出た。やってはいけないのは？', ['火を止める', '水をかける', '消火器を使う'], 1,
     '燃えている油に水をかけると、油が飛び散って一気に燃え広がります。まず火を止め、消火器を使います。', 'fdma_ext', 'cause'),
    ('着ている服に火がついた。服が脱げず、近くに水もないときは？', ['走って火を消す', '止まって、倒れて、転がる', '手ではたくだけ'], 1,
     '「ストップ、ドロップ＆ロール（止まって、倒れて、転がって）」です。走ると風で火の勢いが強くなるおそれがあります。', 'tfd_cloth', None),
    ('東京消防庁の調べで、服に火がつく「着衣着火」の原因でいちばん多いのは？', ['ろうそく', 'こんろ', 'ストーブ', 'たばこ'], 1,
     '死傷者が出た着衣着火の約8割がこんろです。こんろの奥の物を取るときに、袖に燃え移る例が多く起きています。', 'tfd_cloth', None),
    ('住宅用火災警報器を、全国どこでも必ず付ける場所は？', ['玄関', '寝室', '浴室'], 1,
     '住宅用火災警報器は、すべての住宅で付けることが義務です。寝室は全国共通で必ず付けます（寝室が2階以上なら階段にも）。台所などは市町村の条例で決まります。', 'fdma_jk', None),
    ('住宅用火災警報器の、本体を取り替える目安は？', ['3年', '10年', '30年'], 1,
     '設置から10年が目安です。古くなると電池切れや部品の劣化で、火事でも鳴らないおそれがあります。ボタンを押すか、ひもを引くと点検できます。', 'fdma_jk', None),
    ('全国の火事は、1年に何件くらい起きている？（令和6年）', ['約3,700件', '約3万7千件', '約37万件'], 1,
     '令和6年は37,141件。1日に約100件、15分に1件ほどの計算です。', 'r6', 'stats'),
    ('全国の火事の原因で、いちばん多いのは？（令和6年）', ['こんろ', 'たき火', 'たばこ', '電気機器'], 2,
     '1位はたばこ（3,058件）、2位たき火、3位こんろでした。', 'hakusho', 'cause'),
    ('令和6年に、全国で火事がいちばん多かった月は？', ['8月', '12月', '6月'], 1,
     '12月（3,772件）がいちばん多く、1月・3月が続きます。空気が乾き、暖房を使う冬から春に多くなります。', 'r6', 'stats'),
    ('火事が多いのは、1日のうちどの時間帯？（令和6年・全国）', ['真夜中（0〜4時）', '昼間（10〜14時ごろ）', '早朝（4〜6時）'], 1,
     '昼間に多く、10時台から13時台がピークです。火を使う時間に多いと考えられます。', 'r6', 'stats'),
    ('火事の煙から逃げるときの姿勢は？', ['背すじを伸ばして急ぐ', '姿勢を低くして、口と鼻をおおう', '息を止めて走る'], 1,
     '煙は上にたまるので、姿勢を低くし、ハンカチなどで口と鼻をおおって逃げます。煙を吸わないことがいちばん大切です。', 'tfd_119', None),
    ('2016年の糸魚川大火（新潟県）の出火原因は？', ['放火', '大型こんろの消し忘れ', '落雷'], 1,
     '飲食店の大型こんろの消し忘れから出火し、強い南風と飛び火で147棟が焼けました。これをきっかけに、小さな飲食店にも消火器が義務になりました。', 'niigata', 'taika-itoigawa'),
]

def quiz_pages():
    import json as _json
    data = [{'q': q, 'c': c, 'a': a, 'e': e, 's': QUIZ_SRC[s][0], 'g': g} for q, c, a, e, s, g in QUIZ]
    hero = photo('stats') or ''
    # 答えの一覧（閉じた状態）。検索エンジンにも中身が伝わり、あとで見返せる
    allq = ''.join(
        f'<li><details><summary>{esc(q)}</summary><p><b>答え：{esc(c[a])}</b></p><p>{esc(e)}</p>'
        + (f'<p class="small"><a href="g-{esc(g)}.html">関連の記事を読む</a></p>' if g else '') + '</details></li>'
        for q, c, a, e, s, g in QUIZ)
    used = sorted({s for *_, s, _g in QUIZ})
    srcs = [QUIZ_SRC[k] for k in used]
    desc = f'119番の伝え方、消火器の使い方、火事が多い月や原因など、火事と防災の知識をクイズで確かめられます。1回5問、全{len(QUIZ)}問から毎回ちがう問題が出ます。結果は X・LINE でシェアできます。'
    html = f'''<section class="hero"><div class="wrap">
  <p class="crumb"><a href="index.html">トップ</a> ／ <a href="guide.html">火事の調べ方・備え</a> ／ 火事・防災クイズ</p>
  <h1>火事・防災クイズ</h1>
  <p class="lead">いざというとき、正しく動けますか？ 1回5問。全{len(QUIZ)}問から毎回ちがう問題が出ます。</p>
  <p class="small muted">{SITE_NAME}編集部　更新：{QUIZ_UPDATED.replace("-", "/")}</p>
</div></section>
<div class="wrap article">
<figure class="g-hero">{hero}</figure>
<section class="section qz" id="qz" aria-live="polite">
  <noscript><p>クイズは JavaScript を有効にすると遊べます。下の「すべての問題と答え」からも確認できます。</p></noscript>
  <div id="qz-box"><p><button class="btn" type="button" id="qz-start">クイズをはじめる（5問）</button></p></div>
</section>
<aside class="g-cta"><p class="g-cta-h">あなたの町の「いまの火事」を見る</p>
<p>都道府県・市区町村・町名で検索すると、その町の報道・消防の発表・近所の人の報告をまとめて見られます。</p>
<p><a class="btn" href="index.html">町名で検索する</a></p></aside>
<section class="section" aria-labelledby="allq"><h2 id="allq">すべての問題と答え（{len(QUIZ)}問）</h2>
<p class="small muted">答えを先に見たくない人は、クイズのあとで開いてください。</p>
<ol class="qz-all">{allq}</ol></section>
{_src(srcs)}
<section class="section" aria-labelledby="more"><h2 id="more">あわせて読みたい</h2><ul class="plain">
<li><a href="g-119.html">119番通報の伝え方</a></li><li><a href="g-cause.html">火事の原因ランキング</a></li><li><a href="g-stats.html">火事が多い月・曜日・時間帯</a></li><li><a href="guide.html">火事の調べ方・備えの記事一覧</a></li></ul></section>
</div>
<style>
.qz-card{{border:1px solid #ddd;border-radius:12px;padding:16px;margin:8px 0;scroll-margin-top:96px}}
.qz-n{{color:#b3261e;font-weight:700;margin:0 0 4px}}
.qz-q{{font-size:1.15em;font-weight:700;margin:0 0 12px}}
.qz-c{{display:block;width:100%;text-align:left;margin:8px 0;padding:12px 14px;border:1px solid #ccc;border-radius:10px;background:#fff;font-size:1em;cursor:pointer}}
.qz-c:disabled{{cursor:default;color:#222;opacity:1}}
.qz-c.ok{{border-color:#1e7d32;background:#e8f5e9}}
.qz-c.ng{{border-color:#b3261e;background:#fdecea}}
.qz-r{{margin:12px 0 0;padding:12px;border-radius:10px;background:#f6f6f6}}
.qz-score{{font-size:2em;font-weight:800;margin:4px 0}}
.qz-share{{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}}
.qz-all li{{margin:6px 0}}
</style>
<script>
(function(){{
  var Q = {_json.dumps(data, ensure_ascii=False)};
  var URL_ = {_json.dumps(SITE_URL + '/quiz.html')};
  var box = document.getElementById('qz-box'), set = [], i = 0, score = 0;
  function e(s){{return String(s).replace(/[&<>"]/g,function(c){{return {{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}}[c];}});}}
  function shuf(a){{ for (var k = a.length - 1; k > 0; k--) {{ var j = Math.floor(Math.random() * (k + 1)); var t = a[k]; a[k] = a[j]; a[j] = t; }} return a; }}
  function pick(){{ return shuf(Q.map(function(_, k){{return k;}})).slice(0, 5); }}
  function start(){{ set = pick(); i = 0; score = 0; show(); }}
  function show(){{
    var q = Q[set[i]];
    box.innerHTML = '<div class="qz-card"><p class="qz-n">第' + (i + 1) + '問 ／ 5問</p><p class="qz-q">' + e(q.q) + '</p>' +
      (q.c.length === 2 ? [0, 1] : shuf(q.c.map(function(_, k){{return k;}}))).map(function(k){{return '<button type="button" class="qz-c" data-k="' + k + '">' + e(q.c[k]) + '</button>';}}).join('') + '<div id="qz-res"></div></div>';
    Array.prototype.forEach.call(box.querySelectorAll('.qz-c'), function(b){{ b.addEventListener('click', function(){{ answer(+b.getAttribute('data-k')); }}); }});
    var cd = box.querySelector('.qz-card'); if (i > 0 && cd) cd.scrollIntoView({{block: 'start'}});
  }}
  function answer(k){{
    var q = Q[set[i]], ok = k === q.a; if (ok) score++;
    Array.prototype.forEach.call(box.querySelectorAll('.qz-c'), function(b){{ var n = +b.getAttribute('data-k'); b.disabled = true; if (n === q.a) b.classList.add('ok'); else if (n === k) b.classList.add('ng'); }});
    document.getElementById('qz-res').innerHTML = '<div class="qz-r"><p><b>' + (ok ? '正解！' : '残念…正解は「' + e(q.c[q.a]) + '」') + '</b></p><p>' + e(q.e) + '</p>' +
      '<p class="small muted">出典：' + e(q.s) + (q.g ? '　<a class="qz-rel">関連の記事</a>' : '') + '</p>' +
      '<p><button type="button" class="btn" id="qz-next">' + (i < 4 ? '次の問題へ' : '結果を見る') + '</button></p></div>';
    var rl = box.querySelector('.qz-rel'); if (rl) rl.href = 'g-' + q.g + '.html';   // リンク検査が JS の文字列を拾わないよう、href はあとから入れる
    document.getElementById('qz-next').addEventListener('click', function(){{ i++; if (i < 5) show(); else done(); }});
  }}
  function done(){{
    var msg = score === 5 ? '満点！ 防災マスターです。' : score >= 3 ? 'よく知っています。あと少し！' : 'この機会に、いざというときの動き方を確かめておきましょう。';
    var text = '火事・防災クイズで5問中' + score + '問正解でした！ あなたは何問わかる？ #火事速';
    var su = URL_ + '?r=' + score;   // 共有用（canonical は quiz.html のまま）
    var x = 'https://x.com/intent/post?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(su);
    var line = 'https://social-plugins.line.me/lineit/share?url=' + encodeURIComponent(su);
    box.innerHTML = '<div class="qz-card"><p class="qz-n">結果</p><p class="qz-score">5問中 ' + score + '問 正解</p><p>' + msg + '</p>' +
      '<div class="qz-share"><a class="btn" id="qz-x" target="_blank" rel="noopener">X で結果をシェア</a><a class="btn" id="qz-line" target="_blank" rel="noopener">LINE で送る</a></div>' +
      '<p><button type="button" class="btn" id="qz-again">別の5問で もう一度</button></p></div>';
    document.getElementById('qz-x').href = x; document.getElementById('qz-line').href = line;
    document.getElementById('qz-again').addEventListener('click', start);
  }}
  document.getElementById('qz-start').addEventListener('click', start);
}})();
</script>'''
    return {'quiz.html': page('quiz', f'火事・防災クイズ（全{len(QUIZ)}問・1回5問）｜{SITE_NAME}', desc, html,
                              ld_extra=[bc_ld([('火事の調べ方・備え', 'guide.html'), ('火事・防災クイズ', None)])])}
