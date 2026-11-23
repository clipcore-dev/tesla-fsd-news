# Tesla FSD・世界ニュースの公開

既存の静的サイトをCloudflare Pagesへ公開します。GitHub Pagesの既存ワークフローと別のTesla Japan Watchはそのまま運用できます。Cloudflare側の記事は、日本時間の日付ごとに一件を保存し、記事一覧とRSSに反映します。

## 初回公開

1. Cloudflareで専用のPages **Direct Upload**プロジェクトを作成し、本番ブランチを `main` にします。既存サイトのプロジェクトやDNSレコードを流用しません。
2. GitHubリポジトリの Actions variables に `PAGES_PROJECT`、`CLOUDFLARE_ACCOUNT_ID`、`SITE_URL`（希望する公開先のHTTPS URL）を設定。Actions secrets に対象アカウントの `Cloudflare Pages: Edit` 権限を持つ `CLOUDFLARE_API_TOKEN` を登録します。キーはチャットやファイルに貼りません。
3. **Tesla FSD Cloudflare Pages** を `bootstrap` で実行します。記事なしの初期版を生成し、Pagesの初期URLでホーム、記事一覧、RSS、サイトマップが生成物と一致するかを確認します。既存の11月22日号は出典の再確認が必要なため初期版に含めません。
4. Pagesプロジェクトの **Custom domains** で `tesla.clipcore.io` を追加し、Activeを確認します。その後、独自ドメインでトップ、アーカイブ、RSS、SSLを確認します。
5. 利用するOpenAI APIプロジェクトの `OPENAI_API_KEY` をActions secretsへ登録し、Web検索とJSON出力に対応するモデルを `OPENAI_MODEL` に設定します。調査と別工程の照合はAPI課金の対象です。まず `daily` を手動実行し、記事と出典、公開結果を確認します。GitHubを定期実行の起点にする場合は `DAILY_PUBLISH_ENABLED=true` を設定します。調査は毎朝06:00 JSTに開始予定で、記事は照合と公開処理が終わってから表示されます。GitHub側の混雑で実行が遅れる場合があります。

管理画面から初期版をアップロード済みの場合は、手順1・3を飛ばします。手順4も設定済みなら不要です。過去記事はソース内の `src/japan-watch/` をビルド時にコピーします。公開済みのアーカイブを保持するため、このフォルダーを含めてGitHubへ反映してください。`archive` を手動実行すると、OpenAI APIを呼び出さずに同梱した過去記事を公開できます。

## 朝6時のChatGPTタスクから渡す場合

既存タスクが外部ツールからワークフローを実行できる場合は、調査候補を次の形式で `editorial_handoff` に渡して `daily` を起動できます。出典は実際に開いた具体的なHTTPSページを2件ずつ指定します。引き渡された候補も別工程で照合します。

```json
{"sections":[{"title":"見出し","kind":"公式発表","text":"確認できた事実の要約","sources":[{"name":"一次資料の名前","url":"https://example.org/release"},{"name":"独立した媒体と記事名","url":"https://example.net/news/article"}]}]}
```

認証済みの受け渡し元からは `gh workflow run cloudflare-publish.yml --repo clipcore-dev/tesla-fsd-news --ref main --raw-field mode=daily --raw-field editorial_handoff="$(cat candidate.json)"` で起動できます。候補データは公開リポジトリのワークフロー入力に載るため、公開候補の事実・出典のみ渡してください。`PUBLISH_HANDOFF_ONLY=true` で受け渡し専用に切り替えられます。

既存のChatGPTタスクから直接実行できることが確認されるまでは、手動で候補を渡すか、GitHubで独立して調査を開始します。

## 検証と復旧

- 出典を開けない、新着と確認できない、独立した出典が揃わない、画像の承認済みハッシュが違う、生成に失敗した場合は記事を公開しません。
- 記事の保存元は直前に公開したCloudflare Pages版の `edition-state.json` です。公開ドメインの内容と一致を確認し、読めない場合は停止します。公開済みの版やプロジェクトを削除する前に、同ファイルのバックアップを取ります。
- アップロード後は、外部から取得したページがその実行の生成物と一致するかを検証します。失敗した場合は直前の本番版への切り戻しを試み、Actionsに結果を記録します。
- 停止するときは `DAILY_PUBLISH_ENABLED` を削除するか、GitHub Actionsでワークフローを無効化します。定期実行の成否はActionsで確認できます。

公式資料：[Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) ・ [独自ドメイン](https://developers.cloudflare.com/pages/configuration/custom-domains/) ・ [GitHub Actionsの定期実行](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
