// data/raw/dial_numbers.json（市区町村ごとの案内ダイヤル）から、受付サーバー用の worker/src/dial.js を作る
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(new URL('../data/raw/dial_numbers.json', import.meta.url), 'utf8')).dial;
const out = {};
for (const [k, v] of Object.entries(d)) if ((v.tel || []).length) out[k] = v.tel[0];
fs.writeFileSync(new URL('../worker/src/dial.js', import.meta.url),
  '// 自動生成（collector/build_dial.mjs）: 「都道府県|市区町村」→ 消防の案内ダイヤル（自動音声で出動中の火災を案内する番号）\n' +
  '// 番号は市町村ごとの案内（shobo.info の「TELで確認」）から集めたもの。変わることがあるため、つながらない番号は自動で外す。\nexport const DIAL = ' + JSON.stringify(out, null, 0).replace(/","/g, '",\n"') + ';\n');
console.log(Object.keys(out).length + ' 市区町村');
