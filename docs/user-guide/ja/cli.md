> English version: [English](../cli.md)

# MarkdStage CLI

MarkdStage CLI は、ターミナルから Markdown デッキの発表、検証、レイアウト診断、PNG 取得、
PDF／PowerPoint エクスポートを行います。GitHub Copilot の Canvas を必要としないため、Codex、Claude Code、CI、
リモートシェルでもコンソールコマンドを使えます。ネイティブアプリを開く操作には Windows の
デスクトップセッションが必要です。

CLI は Canvas Extension と Desktop と同じ Markdown パーサー、レンダラー、テーマ処理、
Architecture DSL 検証、PDF／PNG／PowerPoint 出力を利用します。フォントやブラウザーの
バージョンによって見た目が異なる場合があるため、ピクセル単位で一致すると考えず最終出力を確認します。

## インストール

パッケージの提供状況、前提条件、npm 導入、オフライン tarball は
[インストールガイド](installation.md)を参照してください。CLI には 2 種類あります。

- **Windows パッケージ版（Desktop v4 / MSIX）:** Node.js は不要です。対話コマンドは
  インストール済みネイティブアプリを開き、外部ブラウザーではなく WebView2 を使います。
  `validate` のスクリプト実行も WebView2 を使います。`inspect`、`capture`、`export` には
  引き続きインストール済みの Edge、Chrome、または Chromium が必要です。
- **npm 版（`@markdstage/markdstage`）:** Node.js 24 以降が必要で、ブラウザーの UI を
  使います。既存のサーバー／ブラウザー動作は変わりません。

両方とも `markdstage` を提供します。共存時はシェルがどちらを実行するか確認してください
（PowerShell では `Get-Command markdstage -All`）。`npx @markdstage/markdstage` は npm 版を
明示的に選びます。

[Microsoft Store の MarkdStage](https://apps.microsoft.com/detail/9N9DG772RM03)には GUI と
CLI が含まれます。GUI でもスキル導入と PDF／PowerPoint 出力を行えます。
詳細は [Desktop](desktop.md) を参照してください。この手順に npm の追加導入は不要です。

Windows のポータブル ZIP には `MarkdStageApp.exe` と `MarkdStageCli.exe` が含まれますが、
エイリアスは登録しません。ワークスペースは GUI 実行ファイルで開き、CLI 実行ファイルは
コンソール処理に使います。CLI からのネイティブ GUI 起動には MSIX のパッケージ ID が必要です。
ポータブル CLI のブラウザー配信では `--no-open` を明示してください。

## コマンド

```console
markdstage
markdstage --workspace .
markdstage slides.md
markdstage present slides.md
markdstage preview slides.md --watch
markdstage validate slides.md --json
markdstage inspect slides.md --json
markdstage capture slides.md --pages 2,4
markdstage export slides.md --output slides.pdf
markdstage export slides.md --output slides.pptx
markdstage export slides.md --output slides.pptx --mermaid-image-fallback
markdstage guide architecture-dsl
markdstage skill install --target codex
```

**Windows パッケージ版**の `markdstage` は呼び出し元の現在のディレクトリを
ワークスペースとして、ファイル未選択でネイティブアプリを開きます。
`markdstage --workspace .` は同じ動作を明示的に指定します。既に開いているワークスペースは
ウィンドウを再利用し、ファイル一覧を表示します。`markdstage slides.md` はそのファイルを
通常のスライド表示で開き、自動更新します。
ファイル一覧に戻ると投影用ウィンドウは停止しますが、前のデッキは一覧の背後に保持します。

**npm 版**では、同じコマンドがブラウザー上の Canvas と同等の UI を開きます。
ファイル未指定時は空の UI で、**Open Markdown** からデッキを選びます。

| コマンド | 説明 |
| --- | --- |
| `present` | パッケージ版: ネイティブのワークスペースウィンドウを発表者ビューで開くか再利用し、ネイティブの投影用ウィンドウも開きます。繰り返しても投影用ウィンドウを閉じたり重複させたりしません。npm 版: ブラウザーの発表者ビューを開き、**Start presentation** で投影用ウィンドウを開きます。 |
| `preview` | 通常のスライド表示を開きます。パッケージ版はネイティブアプリ、npm 版はブラウザーの UI です。 |
| `validate` | デッキ構造、Architecture DSL、展開済みの静的 Adaptive Card JSON、テーマとパスを検証します。カードの画像や SDK 描画はブラウザー検査が必要です。 |
| `inspect` | Canvas の `inspect_layout` と同じ 1280x720 の診断を返し、カードの内容診断とクリッピングを区別します。`--slide <n>` で 1 ページだけ、`--all` で収まっているスライドも含め、`--fail-on-issues` はクリッピングまたはカードの内容診断があると終了コード 5 を返します。 |
| `capture` | 1280x720 の PNG を書き出します。`--pages` を指定しない場合はクリッピングが報告されたスライドだけを取得します。 |
| `export` | Canvas Extension と同じ 16:9 の PDF、または編集可能な要素を残したハイブリッド PowerPoint を生成します。`--output` の拡張子で形式を選び、省略時は PDF です。明示的な `.pptx` 出力で `--mermaid-image-fallback` を指定すると、UI の出力ダイアログで **Images** を選ぶ場合と同様に、Mermaid 図を編集可能な PowerPoint 図形ではなく 1 枚の画像として配置します。 |
| `guide` | MarkdStage の公式ガイド（`overview`、`slide-format`、`themes`、`custom-themes`、`theme-schema`、`architecture-dsl`、`architecture-schema`）を表示します。 |
| `skill` | 持ち運べる Agent Skills を導入・確認します。 |
| `help` | 全体の使い方、または 1 つのコマンドのヘルプを表示します。`markdstage help <command>` は `markdstage <command> --help` と同じ内容です。 |

### 対話コマンドのオプションと終了動作

| オプション | パッケージ版のネイティブ起動 | npm 版 / パッケージ版の `--no-open` |
| --- | --- | --- |
| `--workspace <dir>` | ワークスペースを選び、正規化されたルートが同じウィンドウを再利用します。 | サーバーのワークスペースを指定します。 |
| `--watch` | 指定可能です。省略してもネイティブの Markdown 自動監視は常に有効です。 | 既存の監視動作を維持します。 |
| `--theme <name>`、`--theme-file <path>` | 使用法エラーです。アプリでテーマを選ぶか `--no-open` を追加します。黙って無視しません。 | 既存のテーマ上書きを利用できます。 |
| `--no-open` | アプリを起動せず、既存のローカルサーバーをヘッドレスで実行します。 | ブラウザーを開かずに UI を配信します。 |
| `--json` | アプリによる受け入れを出力して終了します。 | 既存のサーバー出力を維持します。 |

パッケージ版 CLI はアプリが要求を受け入れた後に終了し、ネイティブアプリは独立して動作を
続けます。`--no-open` はアプリへの要求ではなく、Ctrl+C までコンソールのサーバーを維持する
明示的な選択です。ネイティブ起動の `present` は Markdown ファイルが必須で、未指定なら
使用法エラーです。`markdstage present --no-open` は従来のファイル未指定のヘッドレス配信を
維持します。例:

```console
markdstage preview slides.md --no-open --watch --theme dark
```

`help`、`--help`、`--version`、`guide`、`skill`、`validate`、`inspect`、`capture`、
`export` はコンソール処理のままで、ネイティブアプリを起動しません。

引数なしでは現在のディレクトリをワークスペースとして使用します。ファイルだけを指定した場合、
最も近い `.git` エントリーのある親フォルダーを使用し、なければファイルのフォルダーを使用します。
相対引数（相対指定の `--workspace` を含む）はこの処理の前に呼び出し元のディレクトリを
基準として絶対パスに変換します。ワークスペースは存在するディレクトリである必要があります。
ファイルも存在する必要があり、
`.md` または `.markdown` で、正規化したワークスペース内にある必要があります。
パッケージ版 CLI とアプリの両方が、共通の正規化、リンク拒否、包含確認を行います。
`skill install` と `skill check` も、`--root` または `--workspace` を省略すると現在の
ディレクトリを使用します。

```console
markdstage help
markdstage help capture
markdstage capture --help
```

## 推奨する資料作成フロー

1. 元資料、対象者、目的、おおよその枚数または発表時間、テーマ、必要な図、最終出力を決めます。
2. デッキに必要なガイドだけを確認します。最初に `markdstage guide slide-format` を実行し、
   必要に応じて `themes`、`custom-themes`、`architecture-dsl` を参照します。
3. Markdown を唯一の正本としてデッキ全体を作成し、空行の後の `---` でスライドを区切ります。
4. 見た目を確認する前に `markdstage validate slides.md --json` を実行し、構造、テーマ、
   Architecture DSL のエラーを修正します。
5. 編集中は `markdstage slides.md` を実行します。ネイティブアプリ（パッケージ版）または
   ブラウザー（npm 版）が保存時に再読み込みし、表示中の
   スライドを維持しながら、一時的に不完全な保存では直前の正常なデッキを表示し続けます。
6. `markdstage inspect slides.md --json` で固定 16:9 出力のクリッピングを確認します。局所的な
   修正後は `--slide <n>`、CI などの品質ゲートでは `--fail-on-issues` を使います。
7. `inspect` の後で必要な場合だけ `markdstage capture slides.md` を実行します。既定では
   クリッピングされたスライドだけを取得し、バランス、余白、図の見た目を確認したいページには
   `--pages 2,4` を使います。
8. Markdown を修正し、検証と対象ページの診断を繰り返して、エラーやクリッピングがなく、簡潔で
   視覚的なバランスが取れた状態にします。
9. UI の **Presenter view** に切り替えるか `markdstage present slides.md` で起動し、
   `markdstage export slides.md --output slides.pdf` で PDF を出力するか、
   `markdstage export slides.md --output slides.pptx` で PowerPoint を出力します。

全スライドを最初から画像化するのではなく、構造化された検証とレイアウト診断を優先します。
配布前には最終出力の全ページを確認します。

<a id="watch-モードで-architecture-を編集する"></a>

## Architecture を編集する

次のブラウザー編集手順は **npm 版**と、パッケージ版の **`--no-open`** で配信する UI の
手順です。ネイティブ起動は自動監視付きのスライド表示を開きます。ネイティブの Architecture
エディターにはアプリの **More controls → Shape editing** を使います。

npm 版の `markdstage slides.md` はライブ編集用の環境です。

1. Architecture DSL を含むスライドで **More controls > Shape editing** を選びます。
2. 詳細デザイナーが直接開きます。要素の移動、プロパティーの変更、追加、複製、
   親の変更、削除を行えます。
3. **Save** で下書きを対応する `architecture` フェンスへアトミックに書き戻します。
   図形を動かしただけでは保存しません。

エディターの外でソースが変更された場合、上書きせず保存を拒否します。保存に成功すると、表示中の
ページを保ったままデッキを再読み込みします。Markdown が一時的に不完全な状態で保存されても、
直前の正常なデッキを表示し続けます。

フルアプリケーションでは、自動更新がオンでもオフでも Architecture 編集を利用できます。
発表者、capture、inspect、export の出力には編集 UI は含まれません。別の edit コマンドや
edit オプションはありません。

## 終了コード

| コード | 意味 |
| --- | --- |
| 0 | 成功。パッケージ版の対話コマンドではネイティブアプリが要求を受け入れたことを示します。 |
| 1 | コマンドの使い方の誤り |
| 2 | デッキまたは入力のエラー |
| 3 | 実行環境のエラー（出力コマンド用 Chromium がない、ネイティブ起動の `activation_failed` など） |
| 4 | 描画または出力の失敗 |
| 5 | レイアウトまたは検証で問題が見つかった |

`--json` はエラーを含め、すべてのコマンドで機械可読な出力を返します。CI やエージェントは結果を
そのまま利用できます。

パッケージ版のネイティブ起動で成功とするのは、Windows がプロセスを開始した時点ではなく、
アプリが受け入れを応答した時点です。

```json
{"ok":true,"accepted":true,"workspace":"C:\\decks","file":"C:\\decks\\slides.md","mode":"preview","processId":1234,"windowId":5678}
```

ファイル未指定なら `file` は `null`、`mode` は `"preview"` または `"present"` です。
`processId` と `windowId` は、要求を受け入れた実際のネイティブアプリとワークスペース
ウィンドウを示し、自動化で利用できます。上記の数値は例です。
アプリの拒否、起動失敗、応答タイムアウトは非ゼロで終了し、
`{"ok":false,"error":"activation_failed","message":"..."}` を返します。CLI 側の使用法・
入力検証エラーは従来のエラーコードと同じ失敗形式を維持します。

## Agent Skills

`markdstage skill install` は、MarkdStage の Markdown 形式と CLI コマンドを AI エージェントに
伝える Agent Skill を書き出します。参照ファイルは `markdstage guide` と同じガイドから生成される
ため、内容がずれることはありません。ファイルはコマンド実行時に生成され、MarkdStage の
ソースリポジトリにある Agent Skill 自動検出ディレクトリからコピーされるものではありません。

Windows では Desktop のワークスペース画面の **Install skills…** から、ターミナルを使わず
同じファイルを導入できます。使用する対象を選び、その AI ツールでも同じワークスペースを開きます。
スキルは AI ツール本体や Canvas Extension をインストールしません。

| ターゲット | ディレクトリ |
| --- | --- |
| `codex` | `.agents/skills/markdstage/` |
| `claude` | `.claude/skills/markdstage/` |
| `copilot` | `.github/skills/markdstage/`（Canvas 用の説明を含む） |

```console
markdstage skill install --target codex
markdstage skill install --target claude,codex --root .
markdstage skill check --target all
```

利用者が編集したファイルは競合として報告し、`--force` を指定しない限り上書きしません。
MarkdStage の更新後は再度インストールを実行し、ワークスペースのガイドを更新します。
内容が一致するファイルは変更されません。競合を確認してから、必要な場合だけローカルの編集を
置き換えてください。

## セキュリティ

- ネイティブ起動は登録済みパッケージのアプリと、同一ユーザー専用の要求ごとの応答チャネルを
  使用します。アプリ側でも入力パスを再検証します。
- ローカルの発表用サーバーはループバックにのみバインドし、すべての経路をプロセスごとの推測できない
  URL トークンの下で配信します。
- リクエストにはループバックの `Host` ヘッダーが必要です。状態を変更する経路は同一オリジンの
  `Origin` ヘッダーを要求し、可変な状態は `no-store` で配信します。
- デッキ、アセット、テーマ、生成物はワークスペースの外に出ません。`--workspace <dir>` で明示的に
  指定できます。未指定時はファイルの Git ルートまたは格納フォルダーを使い、
  ファイル未指定なら呼び出し元の現在のディレクトリを使います。

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| `PDF export requires Microsoft Edge, Google Chrome, or Chromium.`（終了コード 3） | Chromium 系ブラウザーをインストールするか、導入済みの環境で実行します。 |
| `... is outside the workspace.`（終了コード 2） | ファイルをワークスペース内に移すか、`--workspace` でそのフォルダーを指定します。 |
| `activation_failed`（終了コード 3） | インストール済みパッケージ、WebView2、Windows セッション内でアプリが要求を受け入れられるかを確認します。ローカルサーバーが必要な場合だけ `--no-open` を使います。 |
| ネイティブ起動で `--theme` / `--theme-file` が拒否される（終了コード 1） | アプリでテーマを選ぶか、`--no-open` でサーバー側の上書きを使います。 |
| 発表中にデッキが更新されない | npm / サーバー: `present --watch` で再実行します。ネイティブアプリ: 監視は常に有効なので、ファイルのアクセス権や再読み込みエラーを確認します。 |
| PDF でスライドが切れる | `markdstage inspect` を実行し、報告されたスライドを短くするかレイアウトを変更します。 |
