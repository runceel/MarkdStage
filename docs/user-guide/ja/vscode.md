> English version: [English](../vscode.md)

# Visual Studio Code 拡張機能

Visual Studio Code 用 MarkdStage 拡張機能は、Markdown の編集中にプレビュー、発表者ビュー、
検証、Agent Skill のコマンドを追加します。拡張機能はインストール済み MarkdStage CLI の
薄いラッパーです。解析、レンダリング、検証、ワークスペースのセキュリティ、Skill 生成は
引き続き CLI が担当します。

## 前提ソフトウェアをインストールする

信頼できる MarkdStage リリースから VSIX をインストールし、VS Code の Extension Host が
動作する環境へ互換性のある MarkdStage CLI をインストールします。

- **ローカル Windows:** [Microsoft Store の MarkdStage](https://apps.microsoft.com/detail/9N9DG772RM03)
  をインストールします。Store パッケージには `markdstage` コマンドが含まれ、Node.js は不要です。
- **macOS／Linux:** Node.js 24 以降をインストールし、npm から
  `@markdstage/markdstage` をグローバルインストールします。
- **Remote SSH、WSL、Dev Container:** そのリモート環境内へ npm CLI をインストールします。
  ローカルコンピューターだけにあるコマンドからリモートワークスペースは読み取れません。

```console
npm install --global @markdstage/markdstage
markdstage --version
```

拡張機能が MarkdStage を自動インストール・更新することはありません。コマンドが見つからない
場合はインストール案内を開き、導入後に再検出します。コマンドが `PATH` にない場合は、
**MarkdStage: Executable Path** にパッケージ版またはポータブル版 CLI のパスを設定します。

## プレビューと発表者ビュー

`.md` または `.markdown` ファイルを開き、コマンドパレットから
**MarkdStage: Preview Current Markdown** または
**MarkdStage: Present Current Markdown** を実行します。

拡張機能はインストール済み CLI を loopback 限定の `--no-open` サーバーとソース自動監視で
起動し、トークン付き URL を Visual Studio Code の内蔵ブラウザーで開きます。内蔵ブラウザーが
利用できない場合は、既定の外部ブラウザーで開く選択肢を表示します。同じ表示を再度起動すると
既存のセッションを置き換えます。所有するサーバーをすべて停止するには
**MarkdStage: Stop Preview Sessions** を実行します。拡張機能の終了時にも停止します。

プレビューと発表者ビューは、インストール済みプログラムを実行してワークスペースを読み取るため、
信頼済みワークスペースで使用します。ブラウザー UI では、スライド移動、発表者ノート、
Architecture 編集、出力プレビュー、外部の投影用ウィンドウ（**Start presentation**）、
ソースと同じ場所への PDF・PowerPoint 出力など、CLI と同じ MarkdStage の操作を利用できます。
これらは npm 版 CLI と Windows パッケージ版 CLI のどちらでも同じように動作し、投影用ウィンドウと
出力にはインストール済みの Chromium 系ブラウザーが必要です。

Architecture DSL を編集するには、**MarkdStage: Edit Architecture Diagram** を実行して同じプレビューを
開き、Architecture DSL の図があるスライドで **More controls > Shape editing** を選択します。このコマンドは
編集用途の Preview の別名であり、VS Code 専用エディターや非公開の編集モードは使用しません。通常の
Preview からも Shape editing を利用できます。対象は Architecture DSL の図だけです。Markdown が正本であり、
保存は CLI の既存のソース連動保存経路を通じて行われます。VS Code の内蔵ブラウザーでは、未対応の
ポップアップ遷移を使わず、Architecture Editor をプレビューとは別の内蔵ブラウザータブで開きます。
拡張機能は CLI が通知するバージョン付き loopback イベントを検証してタブを開くため、プレビューは
そのまま残ります。保存後はプレビュータブへ戻り、必要に応じて検証を実行してください。

## デッキを検証する

**MarkdStage: Validate Current Markdown** を実行すると、インストール済み CLI の構造化された
検証結果を取得します。エラーと警告は Problems パネルに表示され、使用中の CLI バージョンと
同じ規則で判定されます。Markdown を修正・保存してから再度検証します。

## GitHub Copilot Skill をインストールする

CLI の検出後、現在のワークスペースで
**MarkdStage: Install GitHub Copilot Skill** を実行します。拡張機能は次のコマンドを呼び出します。

```console
markdstage skill install --target copilot --root <workspace> --json
```

生成した Skill は `.github/skills/markdstage/` に保存されます。VS Code 拡張機能に別の Skill
コピーを同梱せず、インストール済み CLI から生成するため、説明するコマンドとデッキ形式が
その CLI と一致します。

MarkdStage の更新後は **MarkdStage: Check GitHub Copilot Skill** を実行します。ローカルで
変更されたファイルは競合として報告され、自動上書きされません。強制上書きは利用者が明示的に
確認した場合だけ実行できます。

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| MarkdStage CLI が見つからない | ローカル Windows では Store 版、それ以外では Extension Host が動作する環境へ npm CLI を導入し、再検出します。 |
| Windows で別の CLI が選ばれる | `Get-Command markdstage -All` で候補を確認し、**MarkdStage: Executable Path** を明示します。 |
| プレビューが起動しない | MarkdStage の出力チャンネルで CLI の標準エラーを確認し、ワークスペースが信頼済みか確認します。 |
| リモートワークスペースでローカル CLI が見つからない | Remote SSH、WSL、Dev Container の内部へ npm CLI をインストールします。 |
| Skill インストールが競合を報告する | ローカル変更を確認してから、必要な場合だけ強制上書きを明示的に選択します。 |
