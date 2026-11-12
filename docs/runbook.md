# 手順書

よく行う作業の手順をまとめる。API キーやトークンの値はここに書かない（名前だけ）。

## 1. PR をマージする
1. PR のページ（`https://github.com/nekolab0/kaji23/pull/番号`）を開く。
2. 「Merge pull request」→「Confirm merge」を押す。
3. マージすると、`daily` というワークフローが自動で動き、サイトを作り直して公開する。1回 約25分かかる。
   - `data/`・`verify/`・`seo/` と `.md` ファイルだけの変更では、作り直しは動かない。その場合も、30分ごとの定期の回で反映される。
   - `worker/` の変更は、Cloudflare 側が自動で受付サーバーに反映する（Workers Builds）。反映されたかは Cloudflare の画面で確かめる。
4. 30分ごとの自動保存（`data: 日時` というコミット）と重なって「This branch has conflicts」と出ることがある。そのときは、作業したチャットに「競合を直して」と頼む。

## 2. Secret（秘密の値）を入れる

### GitHub（サイトの生成・Search Console の取得で使う）
リポジトリの「Settings」→「Secrets and variables」→「Actions」

| 種類 | 名前 | 用途 |
|---|---|---|
| Secret | `GSC_KEY` | Search Console を読むサービスアカウントの鍵（JSON） |
| Variable | `GSC_SITE` | Search Console のプロパティ名 |
| Variable | `SITE_URL` | サイトの URL |
| Variable | `SITE_OPERATOR` | `policy.html` に出す運営者名（本名は入れない） |
| Variable | `SITE_CONTACT` | 問い合わせ先 |

### Cloudflare（受付サーバーで使う）
Cloudflare の「Workers & Pages」→ `kaji23-reports` →「Settings」→「Variables and Secrets」→「Add」。種類は「Secret」を選ぶ。保存すると、受付サーバーにすぐ反映される。

| 名前 | 用途 | 入れないとき |
|---|---|---|
| `GH_TOKEN` | 30分ごとにサイトの作り直しを呼び出す | 受付サーバーからの呼び出しが止まる（GitHub の定期実行だけになる） |
| `TWILIO_SID`・`TWILIO_TOKEN`・`TWILIO_FROM` | 案内ダイヤルへの自動電話 | 電話をかけない（費用はかからない） |
| `X_BEARER` | X の投稿の検索 | X の投稿を拾わない（費用はかからない） |
| `MAIL_FORWARD` | 火災として読めなかったメールの転送先 | 転送しない |
| `PHONE_DAILY_MAX` | 自動電話の1日の上限（任意。入れなければ20回） | — |
| `X_DAILY_MAX` | X の投稿を読む1日の上限（任意。入れなければ300件） | — |

- Web プッシュ通知の鍵と、IP をハッシュにするための塩は、受付サーバーが自動で作る。登録は不要。
- 値をチャットに貼らない。貼ってしまったら、その鍵は作り直す。

## 3. 無視してよい表示
- **GitHub Actions の一覧で `daily` が「cancelled」（灰色）になっている**：30分ごとの回が重なったとき、後の回が取り消される。正常。
- **`daily` の `monitor` ジョブ・`indexnow` ジョブが「skipped」**：`monitor` は本番に問題がないときは動かない。正常。
- **`daily` がたまに1回だけ失敗する（赤）**：GitHub 側の一時的な不調（部品の取得の失敗、成果物の保存の失敗、起動の失敗）で起きる。次の回が成功していれば、対応は不要。**2回以上続けて失敗したら、失敗した回の画面のスクリーンショットをチャットに送る。**
- **「GitHub Pages の公開が2回とも失敗しました」という黄色の警告**：直近3時間以内に公開できていれば、次の回に任せる作りにしてある。対応は不要。
- **「データの保存を見送りました」という黄色の警告**：`main` が同時に更新されたときに出る。次の回で保存される。
- **手元の検査（`site/verify.js`）の D6・M1・M2 の NG**：D6 は消防署側のページの更新待ち。M1・M2 は作業環境から本番に接続できないために出る。GitHub 上では本番に接続して確かめている。
- **Search Console の「検出 - インデックス未登録」**：エラーではなく、Google の順番待ち。件数の動きは `docs/STATUS.md` で追う。
- **Search Console の「見つかりませんでした（404）」が `api.kajisoku.jp/` の1件だけ**：対策済み（2026-11-10、PR #20）。ほかの URL で出たら、対象の URL をチャットに送る。

## 4. 公開できたか確かめる
1. `https://github.com/nekolab0/kaji23/actions` を開き、いちばん上の `daily` が緑のチェックになっているか見る。`build` と `deploy` が緑なら公開できている。
2. `https://kajisoku.jp/` を開き、ページのいちばん下の取得日時が新しくなっているか見る。古いままのときは、ブラウザの再読み込み（Ctrl＋F5）をする。
3. 直した箇所のページを開いて、変更が出ているか見る。
4. サイトマップを直したときは `https://kajisoku.jp/sitemap.xml` を開き、6つのファイル名が並んでいるか見る。
5. 受付サーバーを直したときは `https://api.kajisoku.jp/api/sources` を開き、消防本部の読み取り状況が表示されるか見る。

## 5. 困ったとき
- GitHub や Search Console からエラーのメールが届いたら、メールか画面のスクリーンショットをチャットに送る。
- サイトを前の状態に戻したいときは、原因になった PR のページで「Revert」を押し、できた PR をマージする。
- 新しいチャットで作業を始めるときは、「`docs/STATUS.md` を読んでから進めて」と伝える（`CLAUDE.md` にも書いてある）。

## 自動改善（`docs/autopilot.md`）
- 毎日の改善と毎週のレポートは、Claude のスケジュールタスクが動かす。止めたいときは、Claude のアプリでスケジュールタスクを一時停止する。
- 自動でマージされた変更を戻したいときは、その PR の画面の「Revert」を押すか、チャットで「#番号を戻して」と頼む。
- 承認待ちの PR は、タイトルの先頭に【承認待ち】が付いている。マージすれば承認、閉じれば却下。理由をコメントに書くと、次の回から反映される。

### アクセス解析（Cloudflare Web Analytics）の設定
1. Cloudflare の「Analytics & Logs」→「Web Analytics」→「Add a site」で `kajisoku.jp` を追加する。
2. 表示される JS スニペットの `"token": "…"` の値を、GitHub の Variable `CF_BEACON_TOKEN` に入れる（公開されても問題ない値）。次の生成から全ページに入る。
3. 同じ画面のサイトタグを Variable `CF_SITE_TAG` に、Cloudflare のアカウント ID を Variable `CF_ACCOUNT_ID` に入れる。
4. Cloudflare の「My Profile」→「API Tokens」→「Create Token」→「Custom token」で、権限を「Account ／ Account Analytics ／ Read」だけにしたトークンを作り、GitHub の **Secret** `CF_ANALYTICS_TOKEN` に入れる。
5. 翌朝の `gsc` の回から、`ops/analytics/latest.json` に直近7日の PV・訪問が入る。
