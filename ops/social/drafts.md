# X 以外の SNS への投稿キュー（自動で毎回作り直す）

`site/nation.py` の `social_queue` が作る。中身は `ops/social/queue.json` と同じで、受付サーバーが API で投稿する（`docs/growth.md`）。
受付サーバーの投稿の仕組み（G2）と各配信先の Secret が入るまで、ここに出ても**投稿はされない**。
町名まで分かった「目立つ火事」だけ。発生から12時間を過ぎた火事は外す。X の文は `ops/x_drafts/latest.md`。

Muse の手で投稿する TikTok・YouTube ショート・note・はてなブログの週の素材は、週のまとめ（G8）ができたら `ops/social/weekly/` に出る。

いま出す火事はありません。