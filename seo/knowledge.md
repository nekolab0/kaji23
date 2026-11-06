# SEO担当の参照知識（2026-11-06 時点）

外部の一次情報（主に Google Search Central）から、火事速に関係するものだけを集めた。
**確認日を書いてあるので、3か月以上たった項目は出典を開き直してから使う。** 新しく確かめたことは日付つきで追記する。

---

## 1. 火事速にとって最大のリスク：大量の町ページとスパムポリシー
確認日 2026-11-06｜出典：[Spam policies for Google Web Search](https://developers.google.com/search/docs/essentials/spam-policies)

- **ドアウェイ**：似た検索語で上位に出すためだけに作られたページ。例として「特定の地域や都市を狙ったページを多数作り、1か所に誘導する」ことが挙げられている。分かりやすい階層ではなく、検索結果に近い似たページを大量に作ることも該当
- **大量生成コンテンツ（scaled content abuse）**：検索順位を操作する目的で多数のページを作ること。**作り方（人手・AI・自動）は問わない**。フィードやデータを変換して、利用者にとって価値の薄いページを大量に作ることも例に入っている
- **キーワードの詰め込み**：狙っている都市名・地域名を並べただけの文章ブロックも例に入っている

**火事速での読み替え**
- 町ページは「その町の火事の記録・報告・口コミ」という固有の中身があるから成り立つ。中身のない町は固定ページにしない（今の `STATIC_TOWNS` の方針）を守る
- 「近くの町」「同じ市のほかの町」のリンク集は、閲覧の導線として妥当な量（今は最大30件）にとどめ、町名を並べるだけの文章は書かない
- 都道府県 → 市区町村 → 町 の階層がはっきりしていることは、ドアウェイと区別される条件そのもの。パンくずと階層リンクを崩さない

## 2. 生成AI検索（AI Overviews・AI Mode）への対応
確認日 2026-11-06｜出典：[Google's Guide to Optimizing for Generative AI Features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)（2026-07-10 更新）

- Google の立場は「AI向けの特別なSEOはない。通常のSEOと同じ」。AI Overviews・AI Mode も通常の順位付け・品質の仕組みを使う
- やること：独自の一次情報、見出しで整理された構成、インデックスされてスニペット表示が可能な状態、重複を減らす
- **やらなくてよいこと**：llms.txt などのAI専用ファイル（Google検索は使わない）、AI向けに文章を細切れにする、AI向けの書き直し、構造化データへの過度な期待
- AIの回答を操作する目的でページを量産するのは、大量生成コンテンツのポリシー違反になると明記されている

**クリックへの影響（日本）**
出典：[Web担当者Forum（Ahrefs調査）](https://webtan.impress.co.jp/n/2026/07/29/53036)
- 情報を調べる系のキーワードで、日本の検索1位のクリック率は、AI Overviews がなかった場合の予測 24.1% に対して実測 9.0%（2026年6月）
- **火事速への示唆**：「火事 調べ方」のような調べ方型はAIの回答で完結されやすい。一方「○○町 火事 今日」のような、いまの事実を確かめる検索は、リアルタイムの一次情報を持つページに分がある。投資の優先度は「いま型」＞「調べ方型」

**Search Console の生成AIレポート**
出典：[PPC Land](https://ppc.land/google-finally-gives-search-console-its-own-generative-ai-visibility-reports/)、[Google Search Central Blog 2026-06](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports)
- 2026-06-03 発表。AI機能内での表示回数をページ・国・デバイス・日付で見られる。クリック数は含まれない
- 一部のサイトから順次提供。火事速の Search Console に表示されているか、データを受け取るたびに確認する

## 3. 速報性（freshness）
確認日 2026-11-06｜出典：[A guide to Google Search ranking systems](https://developers.google.com/search/docs/appearance/ranking-systems-guide)

- Google には「新しさが求められる検索」で新しい情報を優先する仕組みがあり、例として地震直後のニュースが挙げられている。「○○ 火事」は典型的にこれに当たる
- 災害時には公的機関の情報を出す「SOS アラート」の仕組みもある（大規模な災害が対象）
- **原本を優先する仕組み**：引用しているだけのページより、元の情報（独自の報道など）を出したページを上に出す。報道を要約するだけでは勝てない。消防本部の出動情報・近所の報告という一次情報が火事速の武器
- **同じサイトからは上位に原則2件まで**。町ページと火事のページが同じ検索で競合しても、両方が大量に並ぶことはない

## 4. クロールとインデックス
確認日 2026-11-06

**サイトマップ**｜出典：[Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- `lastmod` は、実際の更新日と一貫して一致している場合だけ使われる。中身・構造化データ・リンクの意味のある変更の日にする
- `priority` と `changefreq` は Google が無視する
- 1ファイル5万URL・50MBまで。超えたらサイトマップ索引で分ける（火事速は4万件ずつで対応済み）
- **今の火事速の課題**：`build.py` は全URLの `lastmod` を生成日（毎回の今日）にしている。これは「実際の更新日と一致」しないため、Google に信用されず無視される可能性が高い。各ページの最新の火事の日付を `lastmod` にするのが正しい

**クロールの予算**｜出典：[Crawl budget management](https://developers.google.com/crawling/docs/crawl-budget)
- 気にすべき目安：1万ページ以上で毎日内容が変わるサイト、または Search Console に「検出 - インデックス未登録」が多いサイト。**火事速は全国版で該当しうる**
- 価値の低いURL（並べ替え・絞り込みの別URL）は robots.txt で止める。noindex では Google は取りに来続ける
- 削除したページは 404 か 410 を返す。ソフト404（中身がないのに200を返す）は直す
- サーバーの応答を速くする、304（変更なし）に対応する

**IndexNow**
出典：[blckalpaca（IndexNow FAQ を引用）](https://blckalpaca.at/en/knowledge-base/seo-geo/technical-seo/indexnow-35-billion-urls-daily-without-google)
- Bing・Yandex・Naver などが対応。**Google は対応していない**。火事速は IndexNow を送っているが、Google への速報には効かない。Google にはサイトマップの正確な `lastmod` と、内部リンク（トップ・市区町村ページから新しい火事への導線）で伝える

## 5. Google Discover
確認日 2026-11-06

出典：[Get on Discover](https://developers.google.com/search/docs/appearance/google-discover)
- 特別なタグは不要。インデックスされていてポリシーを守っていれば対象
- 画像は幅1200px以上、16:9推奨、`max-image-preview:large` を設定。ロゴや文字だらけの画像は避ける
- 誇張・釣りの見出し、好奇心や不安をあおる表現は避ける。**火事の話題は特に「不安をあおる」表現に注意**（例：「【衝撃】」のような言い回しは使わない）

出典：[Priority Pixels（2026年2月 Discover コアアップデート）](https://prioritypixels.co.uk/insights/googles-february-2026-discover-core-update-and-what-to-expect/)
- 2026-02-05 開始。まず米国英語から、全言語に広げる予定
- 利用者の国のサイトの地域情報を増やす、釣り見出しを減らす、専門性のあるサイトの詳しく独自でタイムリーな内容を増やす。専門性はサイト全体ではなく**話題ごと**に判断される
- 火事速は「火事」という1つの話題に特化しているので、話題ごとの専門性の判断では有利になりうる

## 6. 2026年のアップデート
確認日 2026-11-06｜出典：[Search Engine Land](https://searchengineland.com/google-may-2026-core-update-rolling-out-now-478430)
- 2026年2月 Discover コアアップデート、3月 コアアップデートとスパムアップデート、5月 コアアップデート
- 順位が大きく動いたときは、まず [Google 検索ステータス ダッシュボード](https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history) でアップデート期間と重なるか確かめる
- 2026年4月に「戻るボタンの乗っ取り（ブラウザ履歴の操作）」が新しいスパムポリシーに入った。戻るボタンで広告ページや別ページに飛ばす仕掛けは入れない

## 7. 競合 kaji.news の観察
確認日 2026-11-06｜トップページを読んで確認
- タイトル：「火事どこ速報 | 今どこで火事？ 全国の火事・火災をリアルタイム速報」。説明文の先頭に時刻と件数（例「【11/6 11:26時点】」）を入れている
- 都道府県・市区町村・町のページがあり、URLは日本語の地名をそのまま使っている
- 長い読み物はほとんどなく、防災情報のページが1つある程度
- 広告はトップに1か所程度
- **火事速が上回れる点**：読み物（調べ方・案内ダイヤル一覧）、出典の明示、町ごとの記録の厚み、Webプッシュ通知

## 8. 一般的に知られている考え方（出典なし・判断の補助）
- 検索結果でのクリック率は、タイトルの先頭の数文字（町名・「今日」・件数）で大きく変わる。スマホでは表示幅が短いので、大事な語を前に置く
- 新しいドメインは最初、トップページだけが表示される期間がある。下層ページは内部リンクと被リンクが増えるにつれて表示が増える
- SNS（X・LINE）で共有されたページは、被リンクや指名検索（「火事速」で検索）を通じて検索にも効く
