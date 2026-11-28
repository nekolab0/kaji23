#!/bin/sh
# 生成 → OGP画像 → 検査 → 検査結果を「データの出典」ページに反映 → 再検査
set -e
cd "$(dirname "$0")"
python3 build.py
node og.js
node weekly_social.js   # 週のまとめの SNS 用画像（ops/social/weekly/。まだないときだけ作る）
node verify.js || true
python3 build.py
node verify.js
python3 check_social.py   # X 以外の SNS への投稿キューが文のきまりを守っているか（docs/growth.md）
