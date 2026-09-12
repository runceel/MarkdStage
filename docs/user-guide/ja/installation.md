> English version: [English](../installation.md)

# MarkdStage をインストールする

使い方に合う画面を選びます。Canvas Extension は GitHub Copilot と一緒に作成する場合、
CLI はターミナルや自動化で使う場合、Desktop は Windows で発表する場合に向いています。

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

## MarkdStage CLI

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

## MarkdStage Desktop

### 必要なもの

- Windows
- Microsoft Edge WebView2 Runtime

.NET と Windows App SDK のコンポーネントはポータブルパッケージに同梱しています。

### インストールして起動する

1. [最新リリース](https://github.com/runceel/markdstage/releases/latest)から x64 または ARM64 の
   ポータブル ZIP をダウンロードします。
2. フォルダーごと展開します。
3. `MarkdStageApp.exe` を実行します。

発表と操作方法は [MarkdStage Desktop](desktop.md) を参照してください。

### Desktop v4 / Microsoft Store への移行

MSIX 版は開発中です。上記は公開済みアーカイブ版の手順であり、Store 公開はパッケージの
受け入れ確認後に案内します。v4 パッケージには `markdstage` コマンドが含まれ、Node.js は
不要です。Desktop は発表用アプリであり、PDF／PowerPoint の出力ボタンは追加しません。
エクスポートは CLI の機能です。

アプリとパッケージ版 CLI のスクリプト実行には WebView2 Runtime が必要です。
present／preview、レイアウト診断、キャプチャー、エクスポートには、インストール済みの
Chromium 系ブラウザーも必要です。組織のポリシーでリモートデバッグが無効な場合、
診断・キャプチャー・エクスポートは利用できません。help、guide、skill の導入には
ブラウザーは不要です。アプリは Microsoft の Runtime ダウンロードページへのリンクを
表示し、自動ダウンロードやインストールは行いません。

パッケージ版 CLI のデッキ操作ではファイルまたは `--workspace` を、`skill install`／
`skill check` では `--root`（または `--workspace`）を明示してください。

最初の Store 公開で配布を切り替え、**以後アーカイブ版への更新は一切提供しません**。
Store 版をインストールして同じワークスペースを開き、旧アプリの展開フォルダーを削除して
ください。両方を残す構成はサポートしません。旧版の検出や自動移行は行わず、最近使った
フォルダー・ウィンドウ・テーマ設定は初期状態から始まります。Markdown・アセット・テーマは
変更しません。パッケージのアンインストールで削除されるのは専用の設定と一時データであり、
ワークスペース内のファイルは残ります。
