# Tesla FSD・世界ニュースの公開

既存の静的サイトをCloudflare Pagesへ公開します。GitHub Pagesの既存ワークフローと別のTesla Japan Watchはそのまま運用できます。Cloudflare側の記事は、日本時間の日付ごとに一件を保存し、記事一覧とRSSに反映します。

## 初回公開

1. Cloudflareで専用のPages **Direct Upload**プロジェクトを作成し、本番ブランチを `main` にします。既存サイトのプロジェクトやDNSレコードを流用しません。
2. GitHubリポジトリの Actions variables に `PAGES_PROJECT`、`CLOUDFLARE_ACCOUNT_ID`、`SITE_URL`（希望する公開先のHTTPS URL）を設定。Actions secrets に対象アカウントの `Cloudflare Pages: Edit` 権限を持つ `CLOUDFLARE_API_TOKEN` を登録します。キーはチャットやファイルに貼りません。
3. **Tesla FSD Cloudflare Pages** を `bootstrap` で実行します。記事なしの初期版を生成し、Pagesの初期URLでホーム、記事一覧、RSS、サイトマップが生成物と一致するかを確認します。既存の11月22日号は出典の再確認が必要なため初期版に含めません。
4. Pagesプロジェクトの **Custom domains** で `tesla.clipcore.io` を追加し、Activeを確認します。その後、独自ドメインでトップ、アーカイブ、RSS、SSLを確認します。
管理画面から初期版をアップロード済みの場合は、手順1・3を飛ばします。過去記事はソースの `src/japan-watch/` からビルド時にコピーします。`archive` を手動実行すると同梱した過去記事を公開できます。

## 朝6時のChatGPT記事の公開

朝6時のChatGPTタスクを記事の作成元にします。Codexの公開タスクが当日の原稿を読み、本文と出典を照合し、確認できた内容だけを GitHub Actions の `daily` に渡します。GitHub Actionsは記事と出典の形式・日付・重複・画像を検証し、Cloudflare Pagesへ公開します。OpenAI APIキーや別の生成APIは使用しません。

次の形式で記事をUTF-8のJSONにします。各節の `kind` は `公式発表`、`報道`、`独自分析` のいずれかです。各節に実際に開いた独立した出典URLを2件以上指定します。

```json
{"date":"2026-11-24","title":"朝刊の見出し","summary":"朝刊の要約","sections":[{"title":"節の見出し","kind":"公式発表","paragraphs":["確認できた本文。"],"sources":[{"name":"一次資料","url":"https://example.org/release"},{"name":"独立した出典","url":"https://example.net/news"}]}]}
```

入力フィールド `mode=daily` と `editorial_handoff` を含むJSONを標準入力から `gh workflow run cloudflare-publish.yml --repo clipcore-dev/tesla-fsd-news --ref main --json` に渡します。ワークフロー入力には公開可能な本文と出典だけを入れます。原稿が未着・照合できない場合は起動しません。


## 検証と復旧

- 出典を開けない、新着と確認できない、独立した出典が揃わない、画像の承認済みハッシュが違う、生成に失敗した場合は記事を公開しません。
- 記事の保存元は直前に公開したCloudflare Pages版の `edition-state.json` です。公開ドメインの内容と一致を確認し、読めない場合は停止します。公開済みの版やプロジェクトを削除する前に、同ファイルのバックアップを取ります。
- アップロード後は、外部から取得したページがその実行の生成物と一致するかを検証します。失敗した場合は直前の本番版への切り戻しを試み、Actionsに結果を記録します。
- 停止するときはCodexの公開タスクを一時停止するか、GitHub Actionsでワークフローを無効化します。公開処理の成否はActionsで確認できます。

公式資料：[Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) ・ [独自ドメイン](https://developers.cloudflare.com/pages/configuration/custom-domains/) ・ [GitHub Actionsの定期実行](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
