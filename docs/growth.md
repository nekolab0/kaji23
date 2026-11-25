# 流入を増やす「攻め」の設計（配信網・SEO/AIO）

2026-11-25 に運営者の依頼で作った設計。毎日の自動改善（`docs/autopilot.md`）は「守り」としてそのまま続け、
ここに書く「攻め」は、毎週の「外を見る」の回と backlog（`docs/backlog.md`）を通して進める。
ここと `CLAUDE.md` が食い違うときは `CLAUDE.md` を優先し、食い違いを明示して直す PR を出す。

## 0. 前提（運営者が決めたこと・2026-11-25）
- 流入は今 X（t.co）経由が中心。X 以外の SNS にも、**ユーザーがいるかどうかに関係なく**投稿先を増やしてよい。
- **X の投稿は Muse のブラウザ操作**（API ではない）。X API の従量課金（URL つき投稿は1件 0.2 ドル）はかからないので、X は今のまま Muse が投稿する。
- **新しい SNS のアカウント作成は Muse が行う**。作り方・名前・規約の確認は `ops/tasks/muse-sns-accounts-2026-11-25.csv` の手順に従う。
- 追う数字は今までどおり **PV（直近7日）**。新しい配信先は「その配信先から来た PV」で、続けるかやめるかを決める。

## 1. 全体の形

```
火事のページができる（build / 受付サーバー）
   │
   ├─ 投稿キュー（ops/social/queue.json）……「目立つ火事」と週のまとめ・読み物・クイズ
   │     │
   │     ├─ 自動で投稿：受付サーバーの cron が API で投稿（Bluesky・Misskey・Mastodon・Threads・Facebook ページ・Instagram）
   │     │     結果は D1 の social_posts に残し、同じ火事を同じ先に二度投稿しない
   │     │
   │     └─ Muse が投稿：ops/social/drafts.md を見てブラウザで投稿（X・TikTok・YouTube ショート・note・はてなブログ）
   │
   └─ 計測：utm_source ごとの来訪（share_clicks）＋ Cloudflare Web Analytics の参照元 → ops/metrics/latest.md
```

- 投稿の元は1つ（キュー）。配信先ごとに文字数・ハッシュタグ・リンクの付け方だけを変える。
- 自動の投稿は**受付サーバー（Cloudflare Workers）に集める**。理由：①Threads のトークンは60日で切れるので、受付サーバーが D1 に持って自動で更新できる ②あとで、消防の発表を受け取った瞬間に投稿できる（有事の速さ D に効く）③GitHub Actions の Secret をあちこちに増やさない。
- キューは `daily.yml` の公開（`deploy`）が成功したあとに受付サーバーへ送る（ページが公開される前にリンクを投稿しない）。

## 2. 配信先の一覧と、自動・Muse の分け方

| 配信先 | 担当 | 形 | 1日の上限（初期値） | 必要な Secret（値は書かない） | 段階 |
|---|---|---|---|---|---|
| X（@kaji_sokuohu） | Muse（今のまま） | `ops/x_drafts/latest.md`（E016 の A/B を続ける） | 今のまま | なし | 実施中 |
| Bluesky | 自動 | 本文＋リンクカード（OG 画像つき）。ハンドルは `kajisoku.jp`（DNS の TXT `_atproto`） | 8件 | `BSKY_HANDLE`・`BSKY_APP_PASSWORD` | 1a |
| Misskey（misskey.io） | 自動 | 本文＋URL。bot フラグを立てる。公開範囲は規約に合わせる（初期は「ホーム」） | 8件 | `MISSKEY_HOST`・`MISSKEY_TOKEN` | 1a |
| Mastodon（bot を認めるサーバー） | 自動 | 本文＋URL。bot フラグを立てる。公開範囲は「未収載」 | 8件 | `MASTODON_HOST`・`MASTODON_TOKEN` | 1a |
| Threads | 自動 | 本文＋リンクの添付。ハッシュタグは1つだけ（`#火事`）。500字まで | 5件 | `META_APP_ID`・`META_APP_SECRET`・`THREADS_USER_ID`・`THREADS_TOKEN`（最初の1回だけ。以後は D1 で自動更新） | 1b |
| Instagram（プロアカウント） | 自動 | 火事ごとの OG 画像（JPEG）＋本文。リンクは貼れないので「プロフィールのリンクから町名で検索」 | 2件 | `IG_USER_ID`（トークンは Threads と同じ Meta アプリから） | 2 |
| Facebook ページ | 自動 | 本文＋リンク | 3件 | `FB_PAGE_ID`・`FB_PAGE_TOKEN` | 2 |
| TikTok | Muse | 週1本：週のまとめ画像（5〜8枚）の写真投稿。文面は `ops/social/weekly/` | 週1本 | なし（API は監査が通るまで非公開になるので使わない） | 2 |
| YouTube ショート | Muse | 週1本：同じ画像から自動で作る縦の動画（mp4） | 週1本 | なし | 2 |
| note・はてなブログ | Muse | 週1本：週のまとめ記事の要約＋火事速へのリンク（全文の転載はしない） | 週1本 | なし | 2 |
| Google ニュース | 自動（何もしない） | 構造化データ・サイトマップで自動で拾われる | ― | なし | 済 |
| Yahoo!ニュース・SmartNews・グノシー・LINE NEWS | 運営者の申請（承認） | 媒体としての申し込み。審査がある | ― | ― | 3（段階1を越えてから） |
| LINE 公式アカウント | 後回し | 無料の通数を超えると有料。地域別の通知は Web プッシュで代わりにする | ― | ― | 見送り（今は） |
| Discord | 後回し | 地域別チャンネルに Webhook。人がいない間は効果が薄い | ― | ― | 見送り（今は） |
| Yahoo!知恵袋・5ch・Wikipedia・掲示板 | **やらない** | 宣伝の書き込みはスパム扱いになり、サイトの信用を落とす | ― | ― | やらない |

段階：1a＝今週（トークンだけで動く3つ）、1b＝Instagram のアカウントができたら（Threads は Instagram が必要）、2＝今月、3＝検索の段階1（インデックス）を越えてから。

### 投稿してよい火事・文面のきまり（全配信先で共通）
- 投稿するのは `featured_fires`（`site/nation.py`）が選ぶ「目立つ火事」と、受付サーバーが受け取った消防の発表のうち町名まで分かったもの。**情報が市までしかない火事は投稿しない**（同じ文の連投に見え、スパム判定の原因になる）。
- 文は `x_post_text` と同じ方針：場所・時刻・情報源の種類・ページの URL だけ。けが人・亡くなった方・見出し文は書かない。煽る言葉（「大炎上」「ヤバい」など）は使わない。
- 番地・個人名・店名（報道の見出しにあっても）は書かない。
- 同じ火事は各配信先に1回だけ。続報で町名がわかったときも、新しくは投稿しない（返信で足すのは段階2で検討）。
- 投稿と投稿の間は、同じ配信先で20分以上あける。上限に達したら、残りは投稿しない（翌日に回さない。古い速報は出さない）。
- 各アカウントのプロフィールに「火事速の自動投稿です。情報源は消防の発表と報道。誤りは contact@kajisoku.jp へ」と書く（Muse が作るとき）。
- 誤りの連絡が来たら、その火事のページと各投稿を消すのは運営者の判断（承認）。受付サーバーには投稿の ID を残すので、消すときに使える。

### URL の目印（utm）
- すべての投稿の URL に `utm_source=<配信先>&utm_medium=social&utm_campaign=<種類>` を付ける。
- `<配信先>`：`x`・`bsky`・`misskey`・`mastodon`・`threads`・`instagram`・`facebook`・`tiktok`・`youtube`・`note`・`hatena`
- `<種類>`：`fire_post`（火事の速報）・`weekly`（週のまとめ）・`guide`（読み物）・`quiz`（クイズ）・`profile`（プロフィールのリンク）
- 今の `share_clicks` は `fire.html` だけを数えている。報道・消防の火事のページ（`f-n-`・`f-o-`）と読み物も数えられるように、受付サーバーのルートを広げる（backlog）。

## 3. 作るもの（コード）

| # | 作るもの | 場所 | 区分 |
|---|---|---|---|
| C1 | 投稿キューの生成：`featured_fires` の結果と週のまとめ・読み物・クイズの告知を、配信先ごとの文にして `ops/social/queue.json`・`ops/social/drafts.md` に書く（`ops/x_drafts/latest.md` は今のまま残す） | `site/nation.py`・`site/build.py` | 自動 |
| C2 | 受付サーバーに投稿の仕組み：`POST /api/social/enqueue`（`SOCIAL_KEY` で守る）、D1 の `social_queue`・`social_posts`・`social_tokens`、cron で配信先ごとに上限と間隔を守って投稿。Secret がない配信先は飛ばす（エラーにしない） | `worker/src/social.js`・`worker/src/index.js` | 自動（ただし**実際に投稿を始める**のは、運営者が Secret を入れたとき＝承認の代わり） |
| C3 | `daily.yml` の `deploy` のあとに、キューを受付サーバーへ送るジョブ | `.github/workflows/daily.yml` | 自動 |
| C4 | 配信先ごとの送り方：Bluesky（`com.atproto.server.createSession` → `com.atproto.repo.createRecord`、リンクカードは OG 画像を `uploadBlob`）、Misskey（`/api/notes/create`）、Mastodon（`/api/v1/statuses`）、Threads（`/threads` → `/threads_publish`、`refresh_access_token` で週1回トークンを更新して D1 に保存）、Instagram（`/media` → `/media_publish`）、Facebook（`/{page-id}/feed`） | `worker/src/social.js` | 自動 |
| C5 | 計測：`share_clicks` を `f-n-`・`f-o-`・`g-`・`quiz.html` にも広げる。`ops/metrics/latest.md` に「配信先ごとの来訪（直近7日）」の表と、Cloudflare Web Analytics の参照元（`bsky.app`・`threads.com`・`l.instagram.com`・`chatgpt.com`・`perplexity.ai`・`gemini.google.com`・`copilot.microsoft.com` など）を出す | `worker/`・`ops/metrics.py` | 自動 |
| C6 | 週のまとめ（backlog の「今週の火事まとめ」8.0）を作るときに、SNS 用の画像5〜8枚（1080×1350）と縦の動画（1080×1920・ffmpeg）と文面を `ops/social/weekly/` に書き出す（Muse が TikTok・YouTube・note・はてなに使う） | `site/` | 自動 |
| C7 | サイトの「運営者情報」と全ページの構造化データ（Organization）に、作った SNS アカウントを `sameAs` で並べる。フッターに各 SNS へのリンク | `site/build.py` | 自動（SEO 担当に確認） |
| C8 | Atom フィード（まず全国1本 `/feed.xml`。都道府県ごとは段階2から）と WebSub（backlog 4.5 を前倒し）。新しい火事のページだけの短いサイトマップとして Google に早く知らせる（2026-11-25 に SEO 担当が確認：Discover の「フォロー」の根拠は 2025-11 に消えたので、ねらいから外した。`seo/decisions.md`） | `site/build.py`・`site/nation.py` | 自動（SEO 担当に確認済み） |

作る順番：C1 → C2・C4（Bluesky・Misskey・Mastodon）→ C3 → C5 → C4（Threads）→ C8 → C7 → C6 → C4（Instagram・Facebook）。
1日1件の自動マージの上限は守る。C2・C4 は受付サーバーの変更なので、`worker/` のテストを全部通したものだけをマージする。

## 4. SEO・AIO で足すこと

すでにあるもの（足さない）：IndexNow、Bing Webmaster Tools、`max-image-preview:large`、定型文ページの noindex、運営者情報・方針のページ（`about.html`・`policy.html`）、AI のクローラーを止めない robots.txt、火事ごとの OG。
`seo/knowledge.md` 2章のとおり、Google は「AI 向けの特別な SEO はない」としていて、llms.txt は使わない。**llms.txt は作らない**（2026-11-25 にチャットで挙げた案は取り下げ）。

| # | 足すこと | ねらい | 区分 |
|---|---|---|---|
| S1 | 火事のページの冒頭の1文を「{日付} {時刻}ごろ、{場所}で{種別}の火事。情報源：{消防の発表／報道}（{更新時刻}更新）」の形にそろえる | AI の回答・スニペットに、そのまま引かれる1文にする。「いま型」の検索に答える | 自動（SEO 担当に確認） |
| S2 | `sameAs`（C7）と、全配信先のプロフィールの名前を「火事速」にそろえる | 名前で検索される（ブランド検索）状態をつくる。AI Overviews でクリックが減っても、名前での検索は減りにくい | 自動 |
| S3 | AI からの来訪を数える（C5）。Search Console の生成 AI のレポートが出ていれば、週次で数字を写す | AI 経由の流入が育っているかを見る | 自動 |
| S4 | 埋め込みの小窓（backlog 3.0「この町の火事」）を前倒し。自治会・マンション・地域ブログ向けの説明ページを1つ作る | 外からのリンクと来訪の両方が増え、後から来る似たサイトに対する壁にもなる | 自動（説明ページは SEO 担当に確認） |
| S5 | 季節の山に合わせた読み物・投稿：12月の「年末の火の用心」、12/22 の糸魚川大火10年（backlog 3.0）、1〜3月の乾燥・暖房器具 | 節目の日は検索と共有が増える | 自動（記事）・承認（投稿の文面は Muse へ） |
| S6 | Yahoo!ニュース・SmartNews などへの媒体申請の下調べ（窓口・条件）を週次の回で1つずつ調べ、`seo/knowledge.md` に書く | 申請は段階1を越えてから。先に条件を知っておく | 自動（調べるだけ） |

## 5. 回し方

- **毎日の回**（`docs/autopilot.md` 2章）：今までどおり。backlog から選ぶとき、この設計の C1〜C8・S1〜S6 も候補に入る（backlog に点数つきで載せた）。
- **毎週の回**（`docs/autopilot.md` 3章・月曜）：「外を見る」に、**新しい配信先・SNS の新機能を1つ以上調べる**ことを足した。配信先ごとの来訪（C5）を見て、2週続けて来訪が0の配信先は、投稿の上限を半分にする（やめはしない。運営者の方針「ユーザーの有無に関係なく増やす」に合わせる）。運営者にお願いすることに、Muse 向けの週の作業（TikTok・YouTube・note・はてな）を入れる。
- **Muse の作業**：①X の投稿（今のまま）②アカウント作成とトークンの発行（`ops/tasks/muse-sns-accounts-2026-11-25.csv`）③週1回、`ops/social/weekly/` の画像・動画・文面を TikTok・YouTube ショート・note・はてなブログに投稿。

## 6. 判定

- 実験の番号は、作ったときに `docs/experiments.md` に振る。
- 配信先を足したら、2週間後に「その配信先からの来訪（C5）」と「全体の PV（直近7日）」を見る。全体の PV が増えず、その配信先からの来訪もなければ、上の「上限を半分」のとおりにする。
- 守る数字（`docs/goals.md`）は今までどおり。誤った情報・削除依頼が1件でも来たら、自動投稿を全部止めて（`SOCIAL_PAUSE` を受付サーバーの変数に入れる）、運営者に知らせる。
