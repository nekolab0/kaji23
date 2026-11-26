# X 以外の SNS への投稿キュー（自動で毎回作り直す）

`site/nation.py` の `social_queue` が作る。中身は `ops/social/queue.json` と同じで、受付サーバーが API で投稿する（`docs/growth.md`）。
受付サーバーの投稿の仕組み（G2）と各配信先の Secret が入るまで、ここに出ても**投稿はされない**。
町名まで分かった「目立つ火事」だけ。発生から12時間を過ぎた火事は外す。X の文は `ops/x_drafts/latest.md`。

Muse の手で投稿する TikTok・YouTube ショート・note・はてなブログの週の素材は、週のまとめ（G8）ができたら `ops/social/weekly/` に出る。

## 群馬県太田市世良田町（11月26日 13:46・期限 11月27日 1:46）

**bsky**（リンク：https://kajisoku.jp/f-n-%E7%BE%A4%E9%A6%AC%E7%9C%8C-%E5%A4%AA%E7%94%B0%E5%B8%82-%E4%B8%96%E8%89%AF%E7%94%B0%E7%94%BA-2026-11-26.html?utm_source=bsky&utm_medium=social&utm_campaign=fire_post）（画像あり）
```
【火事】11月26日 13:46ごろ、群馬県太田市世良田町で火事（住宅）が報道されました。近くの方は煙や通行止めにご注意ください。
#火事 #太田
```

**misskey**
```
【火事】11月26日 13:46ごろ、群馬県太田市世良田町で火事（住宅）が報道されました。近くの方は煙や通行止めにご注意ください。町名ごとの情報・目撃の共有はこちら
https://kajisoku.jp/f-n-%E7%BE%A4%E9%A6%AC%E7%9C%8C-%E5%A4%AA%E7%94%B0%E5%B8%82-%E4%B8%96%E8%89%AF%E7%94%B0%E7%94%BA-2026-11-26.html?utm_source=misskey&utm_medium=social&utm_campaign=fire_post
#火事 #太田
```

**mastodon**
```
【火事】11月26日 13:46ごろ、群馬県太田市世良田町で火事（住宅）が報道されました。近くの方は煙や通行止めにご注意ください。町名ごとの情報・目撃の共有はこちら
https://kajisoku.jp/f-n-%E7%BE%A4%E9%A6%AC%E7%9C%8C-%E5%A4%AA%E7%94%B0%E5%B8%82-%E4%B8%96%E8%89%AF%E7%94%B0%E7%94%BA-2026-11-26.html?utm_source=mastodon&utm_medium=social&utm_campaign=fire_post
#火事 #太田
```

**threads**（リンク：https://kajisoku.jp/f-n-%E7%BE%A4%E9%A6%AC%E7%9C%8C-%E5%A4%AA%E7%94%B0%E5%B8%82-%E4%B8%96%E8%89%AF%E7%94%B0%E7%94%BA-2026-11-26.html?utm_source=threads&utm_medium=social&utm_campaign=fire_post）
```
【火事】11月26日 13:46ごろ、群馬県太田市世良田町で火事（住宅）が報道されました。近くの方は煙や通行止めにご注意ください。町名ごとの情報はリンクから #火事
```

**instagram**（画像あり）
```
【火事】11月26日 13:46ごろ、群馬県太田市世良田町で火事（住宅）が報道されました。近くの方は煙や通行止めにご注意ください。町名ごとの情報は、プロフィールのリンクから町名で検索できます。
#火事 #太田
```

**facebook**（リンク：https://kajisoku.jp/f-n-%E7%BE%A4%E9%A6%AC%E7%9C%8C-%E5%A4%AA%E7%94%B0%E5%B8%82-%E4%B8%96%E8%89%AF%E7%94%B0%E7%94%BA-2026-11-26.html?utm_source=facebook&utm_medium=social&utm_campaign=fire_post）
```
【火事】11月26日 13:46ごろ、群馬県太田市世良田町で火事（住宅）が報道されました。近くの方は煙や通行止めにご注意ください。町名ごとの情報・目撃の共有はこちら
```
