#!/bin/sh
# 生成 → OGP画像 → 検査 → 検査結果を「データの出典」ページに反映 → 再検査
set -e
cd "$(dirname "$0")"
python3 build.py
node og.js
node verify.js || true
python3 build.py
node verify.js
