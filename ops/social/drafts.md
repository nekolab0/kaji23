# X 以外の SNS への投稿キュー（自動で毎回作り直す）

`site/nation.py` の `social_queue` が作る。中身は `ops/social/queue.json` と同じで、受付サーバーが API で投稿する（`docs/growth.md`）。
受付サーバーの投稿の仕組み（G2）と各配信先の Secret が入るまで、ここに出ても**投稿はされない**。
町名まで分かった「目立つ火事」だけ。発生から12時間を過ぎた火事は外す。X の文は `ops/x_drafts/latest.md`。

Muse の手で投稿する TikTok・YouTube ショート・note・はてなブログの週の素材は、週のまとめ（G8）ができたら `ops/social/weekly/` に出る。

## 富山県富山市常盤台（11月25日 19:35・期限 11月26日 7:35）

**bsky**（リンク：https://kajisoku.jp/f-n-%E5%AF%8C%E5%B1%B1%E7%9C%8C-%E5%AF%8C%E5%B1%B1%E5%B8%82-%E5%B8%B8%E7%9B%A4%E5%8F%B0-2026-11-25.html?utm_source=bsky&utm_medium=social&utm_campaign=fire_post）（画像あり）
```
【火事】11月25日 19:35ごろ、富山県富山市常盤台で火事（住宅）が報道されました。近くの方は煙や通行止めにご注意ください。
#火事 #富山
```

**misskey**
```
【火事】11月25日 19:35ごろ、富山県富山市常盤台で火事（住宅）が報道されました。近くの方は煙や通行止めにご注意ください。町名ごとの情報・目撃の共有はこちら
https://kajisoku.jp/f-n-%E5%AF%8C%E5%B1%B1%E7%9C%8C-%E5%AF%8C%E5%B1%B1%E5%B8%82-%E5%B8%B8%E7%9B%A4%E5%8F%B0-2026-11-25.html?utm_source=misskey&utm_medium=social&utm_campaign=fire_post
#火事 #富山
```

**mastodon**
```
【火事】11月25日 19:35ごろ、富山県富山市常盤台で火事（住宅）が報道されました。近くの方は煙や通行止めにご注意ください。町名ごとの情報・目撃の共有はこちら
https://kajisoku.jp/f-n-%E5%AF%8C%E5%B1%B1%E7%9C%8C-%E5%AF%8C%E5%B1%B1%E5%B8%82-%E5%B8%B8%E7%9B%A4%E5%8F%B0-2026-11-25.html?utm_source=mastodon&utm_medium=social&utm_campaign=fire_post
#火事 #富山
```

**threads**（リンク：https://kajisoku.jp/f-n-%E5%AF%8C%E5%B1%B1%E7%9C%8C-%E5%AF%8C%E5%B1%B1%E5%B8%82-%E5%B8%B8%E7%9B%A4%E5%8F%B0-2026-11-25.html?utm_source=threads&utm_medium=social&utm_campaign=fire_post）
```
【火事】11月25日 19:35ごろ、富山県富山市常盤台で火事（住宅）が報道されました。近くの方は煙や通行止めにご注意ください。町名ごとの情報はリンクから #火事
```

**instagram**（画像あり）
```
【火事】11月25日 19:35ごろ、富山県富山市常盤台で火事（住宅）が報道されました。近くの方は煙や通行止めにご注意ください。町名ごとの情報は、プロフィールのリンクから町名で検索できます。
#火事 #富山
```

**facebook**（リンク：https://kajisoku.jp/f-n-%E5%AF%8C%E5%B1%B1%E7%9C%8C-%E5%AF%8C%E5%B1%B1%E5%B8%82-%E5%B8%B8%E7%9B%A4%E5%8F%B0-2026-11-25.html?utm_source=facebook&utm_medium=social&utm_campaign=fire_post）
```
【火事】11月25日 19:35ごろ、富山県富山市常盤台で火事（住宅）が報道されました。近くの方は煙や通行止めにご注意ください。町名ごとの情報・目撃の共有はこちら
```
