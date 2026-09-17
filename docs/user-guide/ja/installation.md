> English version: [English](../installation.md)

# MarkdStage をインストールする

Windows の Microsoft Store パッケージは GUI と CLI を同時にインストールします。
ブラウザー版 CLI には npm 版、GitHub Copilot App 内で作業する場合は Canvas Extension を使います。
これらは選択肢であり、すべてを導入する必要はありません。

## Windows: Microsoft Store

### 必要なもの

- x64 または ARM64 の Windows 10 バージョン 1809 以降
- ネイティブ UI と共通スクリプトの実行に使う Microsoft Edge WebView2 Runtime
- レイアウト診断、PNG 取得、PDF／PowerPoint 出力に使う、インストール済みの
  Microsoft Edge、Google Chrome、または Chromium。GUI からの出力にも必要です。

.NET と Windows App SDK のコンポーネントは同梱されています。**Node.js と npm は不要です。**
MarkdStage が外部ランタイムをダウンロード・インストールすることはありません。
診断、キャプチャー、出力にはブラウザーのリモートデバッグが許可されている必要があります。
MarkdStage は組織のポリシーを変更しません。

### インストールしてワークスペースを開く

1. [Microsoft Store から MarkdStage](https://apps.microsoft.com/detail/9N9DG772RM03)をインストールします。
2. Windows のスタートメニューから **MarkdStage** を起動します。
3. **Open folder…** で Markdown、アセット、テーマを保存するフォルダーを開きます。
4. 一覧から Markdown ファイルを選ぶか、**Open Markdown file…** を使います。
5. 外部の AI ツールを使う場合は、**Install skills…** で対象の Agent Skill をワークスペースに
   導入します。AI ツールでも同じフォルダーを開きます。

操作の詳細は [Desktop ガイド](desktop.md)、画面とサンプルを使う手順は
[Windows 操作チュートリアル](windows-walkthrough.md)を参照してください。

### 同梱コマンドを使う

インストール後に新しいターミナルを開きます。

```powershell
markdstage --version
Get-Command markdstage -All
```

パッケージは `markdstage` のアプリ実行エイリアスを登録します。コマンドが見つからない場合は、
Windows 設定の **アプリ実行エイリアス** を確認し、ターミナルを開き直します。
npm 版が優先される場合は `Get-Command markdstage -All` で候補を確認します。
Store のエイリアスを直すために npm パッケージを追加する必要はありません。

| Windows での操作 | 使用するランタイム |
| --- | --- |
| ネイティブのワークスペース、スライド表示、Architecture 編集、発表 | WebView2 |
| GUI の PDF／PowerPoint 出力 | WebView2 とインストール済みの Edge、Chrome、Chromium のいずれか |
| CLI のヘルプ、バージョン、`guide`、`skill` | ブラウザー不要 |
| CLI の `validate` | WebView2 |
| CLI の `inspect`、`capture`、`export` | WebView2 とインストール済みの Edge、Chrome、Chromium のいずれか |

### ポータブル ZIP とサイドローディング

[最新リリース](https://github.com/runceel/markdstage/releases/latest)には x64／ARM64 の
ZIP、MSIX、SHA-256 チェックサムがあります。信頼できるリリースから環境に合うファイルを取得し、
使用前にハッシュ値を同梱の `.sha256` と比較してください。

```powershell
Get-FileHash .\MarkdStage-win-arm64.zip -Algorithm SHA256
```

ポータブル版は ZIP を**フォルダーごと**展開し、`MarkdStageApp.exe` を起動して GUI で
ワークスペースを開きます。`MarkdStageCli.exe` は検証・出力などのコンソール処理に使用できます。
ZIP は Store の `markdstage` エイリアスを登録しません。CLI からのネイティブ GUI 起動には
インストール済み MSIX が必要です。ポータブル CLI のブラウザー配信には `--no-open` を使います。
詳細は [CLI ガイド](cli.md)を参照してください。

リリースの署名済み MSIX をサイドローディングする場合は、組織の導入ポリシーに従います。
対応する MSIX をインストールする前に、そのリリースの `MarkdStage.cer` をローカルコンピューターの
**信頼されたユーザー** 証明書ストアへ登録します。配布元と証明書を確認した場合に限り実施してください。
Store からのインストールでは、この手動の証明書登録は不要です。

## GitHub Copilot Canvas Extension

このリポジトリをプロジェクトとして開くと、`.github/extensions/markdstage/` の Extension が
プロジェクトスコープで読み込まれます。

別のリポジトリへユーザースコープでインストールする場合は、信頼できるリリースタグを選び、
GitHub Copilot に次のように依頼します。

> 次の GitHub リポジトリフォルダーから MarkdStage をユーザースコープへインストールしてください。
>
> `https://github.com/runceel/markdstage/tree/<release-tag>/.github/extensions/markdstage`

インストールする前にローカルの Extension コードを確認してください。リリースタグかコミット SHA を
指定すれば、毎回同じ内容をインストールできます。

## MarkdStage CLI（npm 版）

ここではブラウザーで動く npm 版を導入します。Windows パッケージ版のネイティブアプリ用 CLI は、
[Microsoft Store から MarkdStage](https://apps.microsoft.com/detail/9N9DG772RM03)を
インストールし、後述の「Windows パッケージの動作」を参照してください。

### 必要なもの

- Node.js 24 以降
- インストール済みの Microsoft Edge、Google Chrome、または Chromium。MarkdStage がブラウザーを
  ダウンロードすることはありません。

### インストール

`npx` で直接実行するか、グローバルにインストールします。

```console
npx @markdstage/markdstage --workspace .
npx @markdstage/markdstage slides.md
npm install --global @markdstage/markdstage
```

最初のコマンドは現在のフォルダーを明示的に選び、空の UI を開きます。2つ目は `slides.md` を
自動更新付きのスライド表示で開きます。

オフラインでインストールする場合は、[GitHub Release](https://github.com/runceel/markdstage/releases)
からバージョン付きの `markdstage-markdstage-<version>.tgz` と `.sha256` チェックサムをダウンロードし、
チェックサムを確認してからローカルの tarball をインストールします。

```powershell
Get-FileHash .\markdstage-markdstage-<version>.tgz -Algorithm SHA256
npm install --global .\markdstage-markdstage-<version>.tgz
```

<a id="windows-package-behavior"></a>

## Windows パッケージの動作

Store パッケージには `markdstage` コマンドが含まれ、Node.js は不要です。GUI には
Architecture 編集、出力プレビュー、発表者ビュー、PDF／PowerPoint 出力があります。
同じファイルに対する診断と自動化には CLI コマンドを使えます。

アプリとパッケージ版 CLI のスクリプト実行には WebView2 Runtime が必要です。
引数なし、Markdown の直接指定、`preview`、`present` はインストール済みのネイティブアプリを
開くため、別の Chromium 系ブラウザーは**不要**です。`present` は発表者ビューとネイティブの
投影用ウィンドウを開きます。レイアウト診断、キャプチャー、PDF／PowerPoint エクスポートには
引き続きインストール済みの Edge、Chrome、または Chromium が必要です。組織のポリシーで
リモートデバッグが無効な場合、診断・キャプチャー・エクスポートは利用できません。
インストールでポリシーは変更しません。ヘルプ、バージョン、`guide`、`skill` にブラウザーは
不要です。これらと `validate`、`inspect`、`capture`、`export` はコンソール処理のままです。
アプリは Microsoft の Runtime ダウンロードページへのリンクを
表示し、自動ダウンロードやインストールは行いません。

パッケージ版 CLI は Markdown ファイルや `--workspace` を省略すると、呼び出し元の現在の
ディレクトリをワークスペースとして、ファイル未選択で開きます。既存のワークスペース
ウィンドウを再利用し、相対ファイル・ワークスペース引数も同じディレクトリを基準に解決します。
アプリが要求を受け入れた後だけ成功で終了し、起動失敗・タイムアウトは非ゼロの
`activation_failed` エラーです。`--no-open` は Ctrl+C まで動く既存のローカルサーバーを
明示的に選びます。ネイティブの Markdown 監視は常に有効です（`--watch` も指定可能）。
ネイティブ起動では `--theme` / `--theme-file` を拒否するため、アプリでテーマを選ぶか
`--no-open` を使います。`skill install`／`skill check` も `--root` と `--workspace` を
省略すると現在のディレクトリを使用します。JSON 出力は [CLI ガイド](cli.md)を参照してください。

npm 版はブラウザーで動くままです。両方が `markdstage` を提供している場合は
`Get-Command markdstage` で解決先を確認します。`npx @markdstage/markdstage` は
npm 版を明示的に実行します。

展開したポータブル版から Store 版へ移行する場合は、同じワークスペースを開いた後、
コマンドの解決先が曖昧にならないよう旧アプリの展開フォルダーを削除してください。
旧版の検出や設定の自動移行は行わず、最近使ったフォルダー・ウィンドウ・テーマ設定は
初期状態から始まります。Markdown・アセット・テーマは変更しません。パッケージの
アンインストールで削除されるのは専用の設定と一時データであり、ワークスペース内の
ファイルは残ります。
