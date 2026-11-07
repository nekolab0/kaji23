# 読み物の図・イラスト（すべて火事速で作ったオリジナルの SVG。写真や他サイトの画像は使わない）
# guides.py から exec される（esc を使う）

C_RED, C_ORG, C_INK, C_MUTE, C_LINE, C_BG, C_SMOKE = '#c2341b', '#f08a24', '#1f1d1b', '#6b6560', '#e6e2dc', '#faf5f2', '#9a948e'

def fig(svg, cap, cls=''):
    return f'<figure class="g-fig {cls}">{svg}<figcaption>{cap}<span class="g-credit">図：{esc(SITE_NAME)}作成</span></figcaption></figure>'

def _svg(w, h, body, label):
    return f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{esc(label)}" xmlns="http://www.w3.org/2000/svg" font-family="BIZ UDPGothic, Hiragino Sans, Noto Sans JP, sans-serif">{body}</svg>'

def _flame(x, y, s=1.0):
    """炎（外側オレンジ・内側の赤）"""
    return (f'<g transform="translate({x},{y}) scale({s})">'
            f'<path d="M0,-46 C14,-30 26,-18 22,2 C19,18 8,26 0,26 C-8,26 -19,18 -22,2 C-26,-18 -8,-22 0,-46Z" fill="{C_ORG}"/>'
            f'<path d="M0,-18 C8,-8 12,0 10,10 C8,18 4,22 0,22 C-4,22 -9,18 -10,10 C-11,0 -4,-6 0,-18Z" fill="{C_RED}"/></g>')

def _smoke(x, y):
    return ''.join(f'<circle cx="{x + dx}" cy="{y - dy}" r="{r}" fill="{C_SMOKE}" opacity="{o}"/>' for dx, dy, r, o in
                   ((0, 0, 16, .55), (14, 22, 20, .45), (2, 48, 24, .35), (22, 74, 28, .25)))

# ---------- 今どこで火事？ ----------
def art_kajidoko_hero():
    b = f'<rect width="720" height="300" rx="16" fill="{C_BG}"/>'
    # 町並み
    for x, w, h in ((30, 70, 120), (110, 90, 90), (210, 60, 150), (280, 100, 100), (390, 70, 130)):
        b += f'<rect x="{x}" y="{250 - h}" width="{w}" height="{h}" fill="#e9e3dc"/>'
        b += ''.join(f'<rect x="{x + 12 + i * 22}" y="{250 - h + 16 + j * 26}" width="12" height="14" fill="#fff"/>' for i in range(max(1, (w - 12) // 22)) for j in range(max(1, (h - 30) // 26)))
    b += f'<path d="M300,250 L300,190 L340,160 L380,190 L380,250Z" fill="#d9cfc4"/>'
    b += _smoke(350, 150) + _flame(340, 190, .7)
    b += f'<rect x="0" y="250" width="470" height="6" fill="{C_LINE}"/>'
    # スマホ
    b += f'<rect x="520" y="30" width="150" height="250" rx="22" fill="#fff" stroke="{C_INK}" stroke-width="4"/>'
    b += f'<rect x="538" y="60" width="114" height="26" rx="13" fill="{C_BG}" stroke="{C_LINE}"/><text x="552" y="78" font-size="13" fill="{C_MUTE}">〇〇町　🔍</text>'
    b += f'<rect x="538" y="98" width="114" height="110" rx="10" fill="#eef3f6"/>'
    b += f'<path d="M595,118 C584,118 576,126 576,137 C576,152 595,170 595,170 C595,170 614,152 614,137 C614,126 606,118 595,118Z" fill="{C_RED}"/><circle cx="595" cy="137" r="7" fill="#fff"/>'
    b += f'<rect x="538" y="220" width="114" height="34" rx="10" fill="{C_RED}"/><text x="595" y="242" font-size="13" fill="#fff" text-anchor="middle" font-weight="700">火事を確認</text>'
    b += f'<path d="M470,150 C490,150 495,140 515,140" stroke="{C_RED}" stroke-width="3" stroke-dasharray="6 6" fill="none"/>'
    return _svg(720, 300, b, 'サイレンや煙に気づいたら、スマホで町名を調べるイメージ')

def art_kajidoko_flow():
    """スマホで読める縦長の流れ図（幅400）"""
    def box(x, y, w, h, t, fill='#fff', stroke=C_LINE, col=C_INK, bold=True, fs=19):
        lines = t.split('\n')
        tx = ''.join(f'<text x="{x + w / 2}" y="{y + h / 2 + (i - (len(lines) - 1) / 2) * (fs + 5) + fs * .35}" font-size="{fs}" text-anchor="middle" fill="{col}"{" font-weight=\'700\'" if bold else ""}>{esc(l)}</text>' for i, l in enumerate(lines))
        return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}" stroke="{stroke}" stroke-width="2"/>' + tx
    arr = lambda x1, y1, x2, y2: f'<path d="M{x1},{y1} L{x2},{y2}" stroke="{C_MUTE}" stroke-width="3" marker-end="url(#ah)"/>'
    b = f'<defs><marker id="ah" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10Z" fill="{C_MUTE}"/></marker></defs>'
    b += f'<rect width="400" height="470" rx="16" fill="{C_BG}"/>'
    b += box(20, 20, 220, 64, '火や煙が\n目の前に見える') + arr(250, 52, 282, 52) + box(288, 24, 92, 56, '119番', fill=C_RED, stroke=C_RED, col='#fff', fs=22)
    b += f'<line x1="20" y1="112" x2="380" y2="112" stroke="{C_LINE}" stroke-width="2" stroke-dasharray="6 6"/>'
    b += box(20, 136, 360, 64, 'サイレンが聞こえる\nどこで火事か知りたい') + arr(200, 200, 200, 228)
    for i, (t, sub) in enumerate((('案内ダイヤルに電話', '消防本部の自動音声'), ('火事速で町名を検索', '報道・消防の発表・報告'), ('火災メール・出動情報', '自治体・消防本部の配信'))):
        y = 232 + i * 64
        b += f'<rect x="20" y="{y}" width="360" height="54" rx="12" fill="#fff" stroke="{C_LINE}" stroke-width="2"/>'
        b += f'<text x="40" y="{y + 25}" font-size="19" font-weight="700" fill="{C_INK}">{esc(t)}</text><text x="40" y="{y + 45}" font-size="14" fill="{C_MUTE}">{esc(sub)}</text>'
    b += f'<text x="200" y="448" font-size="17" fill="{C_RED}" text-anchor="middle" font-weight="700">確かめるための119番はしない</text>'
    return _svg(400, 470, b, '火や煙が見えたら119番、場所を知りたいときは案内ダイヤル・火事速・火災メールで調べる流れ')

# ---------- サイレン ----------
def art_siren_waves():
    """3つのサイレンの音の動き（幅400・スマホ向け）"""
    rows = [('消防車（火災出動）', 'ウーウー ＋ 鐘のカンカン', 'fire', C_RED), ('救急車', 'ピーポー（2つの音を交互に）', 'amb', '#2f6fb3'), ('パトカー', 'ウー（上がって下がる音）', 'pol', '#4a4a8a')]
    b = f'<rect width="400" height="430" rx="16" fill="{C_BG}"/>'
    for i, (name, sound, k, col) in enumerate(rows):
        y0 = 20 + i * 132
        b += f'<text x="20" y="{y0 + 22}" font-size="20" font-weight="700" fill="{col}">{esc(name)}</text><text x="20" y="{y0 + 46}" font-size="15" fill="{C_MUTE}">{esc(sound)}</text>'
        b += f'<rect x="20" y="{y0 + 58}" width="360" height="62" rx="10" fill="#fff" stroke="{C_LINE}"/>'
        mid = y0 + 92
        if k == 'fire':
            d = f'M30,{mid + 18}' + ''.join(f' Q{30 + j * 85 + 30},{mid - 26} {30 + j * 85 + 60},{mid - 14} L{30 + j * 85 + 85},{mid + 18}' for j in range(4))
            b += f'<path d="{d}" stroke="{col}" stroke-width="4" fill="none"/>'
            b += ''.join(f'<line x1="{x}" y1="{y0 + 64}" x2="{x}" y2="{y0 + 80}" stroke="{C_ORG}" stroke-width="5" stroke-linecap="round"/>' for x in range(44, 372, 28))
        elif k == 'amb':
            d = f'M30,{mid - 12}' + ''.join(f' L{30 + j * 43 + 43},{mid - 12 if j % 2 == 0 else mid + 12} L{30 + j * 43 + 43},{mid + 12 if j % 2 == 0 else mid - 12}' for j in range(8))
            b += f'<path d="{d}" stroke="{col}" stroke-width="4" fill="none"/>'
        else:
            b += f'<path d="M30,{mid + 20} C90,{mid - 34} 140,{mid - 34} 200,{mid + 20} C260,{mid - 34} 310,{mid - 34} 370,{mid + 20}" stroke="{col}" stroke-width="4" fill="none"/>'
    b += f'<text x="20" y="418" font-size="12" fill="{C_MUTE}">音の高さの動きのイメージ（使い方は消防本部ごとに違います）</text>'
    return _svg(400, 430, b, '消防車・救急車・パトカーのサイレンの音の動きのイメージ')

def art_siren_hero():
    b = f'<rect width="720" height="240" rx="16" fill="{C_BG}"/><rect x="0" y="200" width="720" height="40" fill="{C_LINE}"/>'
    # 消防車
    b += f'<rect x="150" y="110" width="330" height="80" rx="10" fill="{C_RED}"/><rect x="480" y="128" width="90" height="62" rx="10" fill="{C_RED}"/>'
    b += f'<rect x="494" y="138" width="60" height="26" rx="4" fill="#dfeef7"/><rect x="170" y="92" width="280" height="12" rx="6" fill="#bdb6ae"/>'
    b += ''.join(f'<line x1="{x}" y1="92" x2="{x}" y2="104" stroke="#8d867f" stroke-width="3"/>' for x in range(185, 450, 22))
    b += f'<rect x="505" y="116" width="40" height="12" rx="4" fill="#ff4a2a"/>'
    b += ''.join(f'<circle cx="{x}" cy="196" r="20" fill="{C_INK}"/><circle cx="{x}" cy="196" r="8" fill="#ddd"/>' for x in (210, 300, 520))
    b += f'<rect x="170" y="130" width="120" height="40" rx="4" fill="#fff" opacity=".9"/><text x="230" y="157" font-size="18" text-anchor="middle" fill="{C_RED}" font-weight="700">消防</text>'
    # 音
    b += f'<text x="590" y="70" font-size="28" fill="{C_RED}" font-weight="700">ウーウー</text><text x="600" y="108" font-size="24" fill="{C_ORG}" font-weight="700">カンカン</text>'
    b += ''.join(f'<path d="M{575 - i * 14},{120 - i * 16} q 12,14 0,28" stroke="{C_MUTE}" stroke-width="3" fill="none"/>' for i in range(3))
    return _svg(720, 240, b, '鐘を鳴らして走る消防車のイラスト')

# ---------- 119番 ----------
def art_119_steps():
    """119番で聞かれる順番（幅400・スマホ向け）"""
    steps = [('火事ですか、救急ですか？', '火事です！'), ('住所はどこですか？', '〇〇市〇〇町1丁目2番3号'), ('何が燃えていますか？', '2階建ての家の2階です'), ('逃げ遅れた人は？', '家族は全員外に出ています')]
    b = f'<rect width="400" height="560" rx="16" fill="{C_BG}"/>'
    for i, (q, a) in enumerate(steps):
        y = 20 + i * 134
        b += f'<circle cx="34" cy="{y + 30}" r="18" fill="{C_RED}"/><text x="34" y="{y + 37}" font-size="19" fill="#fff" text-anchor="middle" font-weight="700">{i + 1}</text>'
        b += f'<text x="62" y="{y + 12}" font-size="13" fill="{C_MUTE}">消防（指令員）</text>'
        b += f'<rect x="60" y="{y + 18}" width="320" height="46" rx="14" fill="#fff" stroke="{C_LINE}" stroke-width="2"/><text x="76" y="{y + 48}" font-size="18" fill="{C_INK}">{esc(q)}</text>'
        b += f'<rect x="100" y="{y + 72}" width="280" height="46" rx="14" fill="{C_RED}"/><text x="116" y="{y + 102}" font-size="18" fill="#fff" font-weight="700">{esc(a)}</text>'
    return _svg(400, 560, b, '119番通報で聞かれる順番と答え方の例')

def art_119_hero():
    b = f'<rect width="720" height="240" rx="16" fill="{C_BG}"/>'
    b += f'<rect x="250" y="20" width="130" height="210" rx="20" fill="#fff" stroke="{C_INK}" stroke-width="4"/>'
    b += f'<text x="315" y="120" font-size="44" font-weight="800" fill="{C_RED}" text-anchor="middle">119</text>'
    b += ''.join(f'<circle cx="{280 + (k % 3) * 35}" cy="{150 + (k // 3) * 22}" r="7" fill="{C_LINE}"/>' for k in range(9))
    b += f'<path d="M410,60 h220 a14,14 0 0 1 14,14 v52 a14,14 0 0 1 -14,14 h-180 l-26,22 v-22 h-14 a14,14 0 0 1 -14,-14 v-52 a14,14 0 0 1 14,-14Z" fill="{C_RED}"/>'
    b += f'<text x="520" y="110" font-size="26" font-weight="800" fill="#fff" text-anchor="middle">火事です！</text>'
    b += _flame(140, 160, 1.2) + _smoke(150, 90)
    return _svg(720, 240, b, '119番に「火事です」と伝えるイラスト')

# ---------- 原因ランキング ----------
def art_cause_hero():
    b = f'<rect width="720" height="230" rx="16" fill="{C_BG}"/>'
    # たばこ
    b += f'<g transform="translate(90,40)"><rect x="0" y="100" width="120" height="16" rx="3" fill="#fff" stroke="{C_INK}" stroke-width="2"/><rect x="0" y="100" width="34" height="16" fill="#e0b177"/><rect x="116" y="100" width="10" height="16" fill="{C_ORG}"/>{_smoke(126, 86)}<text x="60" y="160" font-size="18" text-anchor="middle" font-weight="700" fill="{C_INK}">1位 たばこ</text></g>'
    # たき火
    b += f'<g transform="translate(300,40)"><path d="M10,118 L110,96 M10,96 L110,118" stroke="#8a5a32" stroke-width="12" stroke-linecap="round"/>{_flame(60, 92, .9)}<text x="60" y="160" font-size="18" text-anchor="middle" font-weight="700" fill="{C_INK}">2位 たき火</text></g>'
    # こんろ
    b += f'<g transform="translate(510,40)"><rect x="0" y="104" width="120" height="20" rx="4" fill="#cfc8c0"/><ellipse cx="60" cy="102" rx="44" ry="8" fill="#555"/><rect x="22" y="58" width="76" height="34" rx="6" fill="#7d7d7d"/>{_flame(60, 104, .4)}<text x="60" y="160" font-size="18" text-anchor="middle" font-weight="700" fill="{C_INK}">3位 こんろ</text></g>'
    return _svg(720, 230, b, '火事の原因の上位3つ（たばこ・たき火・こんろ）のイラスト')

def art_bars(rows, title, unit='件', color=C_RED):
    """横棒グラフ（幅400・スマホ向け。rows: [(名前, 数値)]）"""
    if not rows: return ''
    mx = max(v for _, v in rows) or 1
    h = 62 + len(rows) * 50
    b = f'<rect width="400" height="{h}" rx="16" fill="#fff" stroke="{C_LINE}"/><text x="20" y="34" font-size="17" font-weight="700" fill="{C_INK}">{esc(title)}</text>'
    for i, (k, v) in enumerate(rows):
        y = 56 + i * 50
        w = max(4, int(170 * v / mx))
        b += f'<text x="20" y="{y + 23}" font-size="{17 if len(k) <= 5 else 15}" fill="{C_INK}">{esc(k)}</text><rect x="132" y="{y + 2}" width="{w}" height="30" rx="6" fill="{color if i == 0 else "#e8a291" if color == C_RED else "#9cbbd9"}"/>'
        b += f'<text x="{140 + w}" y="{y + 24}" font-size="16" fill="{C_INK}" font-weight="700">{v:,}{esc(unit)}</text>'
    return _svg(400, h, b, title)
