# Search Console のデータ置き場

## 自動取得（`api/`）
`.github/workflows/gsc.yml` が毎朝7時41分ごろに `seo/fetch_gsc.py` を動かし、`api/` を上書きする。
- `meta.json`：取得日時・期間・インデックス状況の要約（まずここを見る）
- `by_date.csv`：日ごとの数字（最大16か月）
- `queries_28d.csv`・`pages_28d.csv`・`query_page_28d.csv`：直近28日（2日前まで）
- `inspection.csv`：URL検査の結果（サイトマップのURLを1日300件ずつ順番に調べる。トップは毎日）
- `inspection_summary.csv`：インデックス状況ごとのURL数

## 手動で置いたもの

Search Console の「検索パフォーマンス」からエクスポートした CSV をここに置く。

- 書き出した日ごとにフォルダを分ける（例：`2026-11-06/クエリ.csv`）。Search Console の zip をそのまま展開してよい
- まずは直近28日分の「クエリ」と「ページ」の2つがあれば十分
