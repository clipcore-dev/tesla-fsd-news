# TESLA FSD WORLD NEWS

テスラ FSD の最新情報を毎朝 1 本、記事にして公開するブログです。
`posts/日付.json` を 1 つ足して `main` に push すると、GitHub Actions が組み立てて GitHub Pages に公開します。

## 毎朝の記事の作り方（自動実行の手順）

1. 今日の日付（日本時間）を確かめます。`posts/YYYY-MM-DD.json` がすでにあれば、何もせず終わります。
2. 直近 3 本の記事（`posts/` の新しい順）を読み、前回までに何を伝えたか・各国の状況の表がどうなっていたかを把握します。
3. Web 検索で、前回の記事以降の新しい情報を調べます。見る範囲は次のとおりです。
   - FSD の新しいバージョン・リリースノート・OTA の配信状況（Not a Tesla App、Teslascope、TeslaNorth、Tesla Oracle、Electrek、Teslarati ほか）
   - 各国の認証・規制（日本の国土交通省・DCAS / UN-R171、欧州 RDW・UNECE、韓国、中国、豪州・NZ）
   - HW3 / HW4 / AI5 の対応状況、HW3 の交換計画
   - 料金（月額・買い切り）、Tesla 公式（tesla.com、Tesla Japan、X の公式投稿）
4. 主要な事実は、できるだけ元の記事を開いて確かめます。検索結果の要約だけで書きません。
5. `posts/YYYY-MM-DD.json` を書きます（形式は下）。`posts/2026-11-22.json` が見本です。
6. `node build.mjs --check` を実行し、エラーが出たら直します。通るまで公開しません。
7. `git add posts/YYYY-MM-DD.json && git commit -m "記事: YYYY-MM-DD" && git push origin main`

大きなニュースが無い日も休まず、短めの記事（各国の状況の表の更新・配信率・次の注目点）を出します。
調べても新しい情報がまったく確かめられない場合は、無理に話題を作らず「新しい動きは確認できなかった」と正直に書きます。

## 書くときの決まり

- **事実・報道・独自分析を区別します。** 見出しの下の `meta` に【公式発表】【報道】【報道・要確認】【独自分析】のどれかを書きます。
- **出典を必ず付けます。** `sources` や `source` の `url` には、実際に開いて確かめた記事の URL だけを入れます。URL を推測で作りません。確かめられなかった出典は名前だけにします。
- **確認できていないことは「未確認」と書きます。** 予定・発言・報道を、決定事項のように書きません。
- **数字には、何の数字か（母集団・基準日・出典）を `note` に書きます。** 割合のグラフ（`share`・`meter`）は、根拠のある数字があるときだけ使います。
- **他のサイトの文章を写しません。** 自分の言葉で要約し、引用は短く。他サイトの画像は使いません（画像の部品はありません）。
- **特定の個人や特定の 1 台の車の話にしません。** 読者は日本の Tesla オーナー全般（特に HW3 搭載の旧型 Model 3・Model Y）です。
- **安全の注意を外しません。** FSD（Supervised）は運転支援で、運転者の監視が必要であることと矛盾する書き方をしません。
- 投資の助言はしません（株価の予想・売買の勧めを書かない）。
- 文体は見本の記事と同じ「〜だ。〜した。」の新聞調です。タイトルは 60 文字前後で、その日いちばん大事なことを入れます。

## 記事の構成（毎回この順）

1. `lead`：今日いちばん大事なことを 3〜4 段落で
2. `tiles`「30秒でわかる今日のニュース」：4 枚（偶数）。悪い知らせは `tone: "warn"`、良い知らせは `tone: "good"`
3. 番号つきの見出し（`h2`「1. …」）でニュースを 2〜5 本。各ニュースは `meta` → `p` → 必要なら `features`・`table`・`share` → `source`
4. `h2`「世界のFSD展開状況」＋国別の `table`（地域・最新状況・前回比）。前回の記事の表を引き継いで更新します
5. `h2`「日本のFSD解禁予測」などの独自分析（変化があった日だけでよい）
6. `h2`「HW3オーナーへの影響」＋ `kv`
7. `h2`「次に注目すること」＋ `list`、最後に「何を調べ、何を確かめられなかったか」を `p` で 1 段落
8. `conclusion`：今日の結論を 1〜2 文

## 記事ファイルの形式

```jsonc
{
  "date": "2026-11-23",            // ファイル名と同じ
  "edition": "朝刊",
  "updated": "9:00",               // 日本時間
  "title": "…",
  "description": "…",              // 一覧と検索結果に出る要約。120 文字前後
  "lead": ["段落", "**太字** と [リンク](https://…) が使えます"],
  "blocks": [ /* 下の部品を並べる */ ],
  "conclusion": "…"
}
```

| type | 中身 |
|---|---|
| `h2` / `h3` / `meta` / `p` / `note` | `text`（`p` と `note` は `sources: [{name, url}]` を付けられる） |
| `list` | `items: ["…"]` |
| `source` | `text`, `url`（「出典：…」の行） |
| `tiles` | `title`, `items: [{label, value, note, tone}]`（偶数個）, `sources` |
| `features` | `title`, `items: [{icon, title, value, note}]`, `sources`。icon は shield / eye / route / alert / bike / car / chip / globe / clock / doc / yen |
| `share` | `label`, `value`, `parts: [{label, value, pct, tone}]`（pct の合計 100）, `note`（必須） |
| `meter` | `label`, `value`, `pct`（0〜100）, `note`（必須） |
| `table` | `title`（任意）, `head: […]`, `rows: [[…]]`, `note`。3 列まで |
| `kv` | `title`, `sub`, `rows: [{k, v, tone}]` |
| `hr` | 区切り線 |

`tone` は `"warn"`（オレンジ）か `"good"`（緑）だけです。広告の位置は自動で入るので、記事には書きません。

## 手元で見る

```bash
node build.mjs --local --preview-ads
python3 -m http.server 4173 --directory dist
```

## 広告の設定

`site.config.json` の `adsense.client`（`ca-pub-…`）と `adsense.slots`（top / middle / bottom / list の広告ユニット ID）を入れると広告が出ます。空のあいだは何も表示されません。`affiliate.items` に `{title, note, url}` を入れると、記事の最後に「PR」と表示した紹介枠が出ます。
