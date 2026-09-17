<p align="center">
  <img src="../../../assets/brand/markdstage-mark.svg" alt="MarkdStage" width="96">
</p>

> English version: [English](../README.md)

# MarkdStage ユーザーガイド

MarkdStage は Markdown スライドの作成、図の編集、プレビュー、発表、出力を行うアプリです。
Windows では Microsoft Store から GUI と CLI を同時に導入できます。同じ Markdown デッキを
GitHub Copilot Canvas Extension や npm 版 CLI のブラウザー UI でも開けます。

![サンプルの Architecture 図を開いた MarkdStage Desktop](../images/windows-slide.png)

## 使い方を選ぶ

| 利用環境 | 向いている場面 | 主な機能 |
| --- | --- | --- |
| [**Windows Desktop と同梱 CLI**](desktop.md) | Windows でデッキを扱う。外部 AI ツールの利用は任意 | ワークスペース、スキル導入、Architecture 編集、出力プレビュー、発表者ビュー、ネイティブ投影用ウィンドウ、GUI／CLI からの PDF・PowerPoint 出力 |
| [**Canvas Extension**](canvas-extension.md) | GitHub Copilot と一緒にデッキを作り込む | Markdown 読み込み、自動更新、発表者ビュー、Architecture 編集、16:9 の確認、PDF と編集可能な PowerPoint のエクスポート |
| [**npm 版 CLI**](cli.md) | Windows パッケージを使わず、ターミナル、CI、Codex、Claude Code で作業する | ブラウザー版スライド UI、検証、クリッピング診断、PNG 取得、PDF・PowerPoint 出力、Agent Skills |

3 つのいずれでも、Markdown、シンタックスハイライト付きコード、Mermaid、Architecture DSL、
ローカル画像、スピーカーノート、組み込みの dark／light／microsoft テーマを利用できます。

## はじめに

1. [MarkdStage のインストール](installation.md)で Canvas Extension、CLI、Desktop の方法を確認します。
2. [クイックスタート](quick-start.md)に沿って最初のデッキを開きます。
3. [Windows 操作チュートリアル](windows-walkthrough.md)でワークスペース、スキル、図の編集、出力を試します。
4. [AI を使った作成](ai-assisted-authoring.md)や [GitHub Copilot ハンズオン](copilot-hands-on.md)を確認します。
5. [Markdown の書き方](markdown-authoring.md)を覚えます。
6. [テーマとレイアウト](themes-and-layouts.md)を確認します。
7. [図とメディア](diagrams-and-media.md)を追加します。
8. [プレゼンテーションと PDF／PowerPoint 出力](presenting-and-export.md)に備えます。

## 機能ガイド

| トピック | ガイド |
| --- | --- |
| Canvas Extension、CLI、Desktop のインストール | [インストール](installation.md) |
| 架空のサンプル、スクリーンショット、短い操作動画を使った Windows の演習 | [Windows 操作チュートリアル](windows-walkthrough.md) |
| AI を使った作成、スキーマ、診断、必要なページだけの目視確認 | [AI を使った作成](ai-assisted-authoring.md) |
| プロンプトから PDF までの流れを、実際の出力を見ながらたどる演習 | [GitHub Copilot ハンズオン](copilot-hands-on.md) |
| Canvas のツールバー、読み込み、自動更新、スライド一覧、発表者ビュー | [Canvas Extension](canvas-extension.md) |
| Windows のワークスペース、スキル導入、Architecture 編集、発表、出力 | [MarkdStage Desktop](desktop.md) |
| 区切り、フロントマター、コンテンツサイズ、ノート、コード、表、アセット | [Markdown の記述](markdown-authoring.md) |
| dark、light、microsoft、custom テーマとスライドレイアウト | [テーマとレイアウト](themes-and-layouts.md) |
| Mermaid、Architecture DSL、画像、画面上での Architecture 編集 | [図とメディア](diagrams-and-media.md) |
| 投影用ウィンドウ、操作の同期、クリッピングの確認、PDF と PowerPoint のエクスポート | [プレゼンテーションとエクスポート](presenting-and-export.md) |
| ターミナルのコマンド、終了コード、JSON 出力、Agent Skills | [MarkdStage CLI](cli.md) |
| セットアップ、読み込み、表示、編集でよくある問題 | [トラブルシューティング](troubleshooting.md) |

## 動作要件

- **Canvas Extension:** MarkdStage Extension を現在のプロジェクトまたはユーザーにインストールした
  GitHub Copilot。
- **Windows GUI とパッケージ版 CLI:** x64／ARM64 の Windows 10 バージョン 1809 以降と
  Microsoft Edge WebView2 Runtime。Microsoft Store から導入するか、ポータブル版・
  サイドローディング版を選びます。GUI の出力と CLI の診断・キャプチャー・出力には、
  インストール済みの Edge、Chrome、Chromium のいずれかも必要です。Node.js は不要です。
- **npm 版 CLI:** Node.js 24 以降と、インストール済みの Microsoft Edge、Google Chrome、または Chromium。
- **AI 支援（任意）:** 外部 AI ツールと対応するワークスペースのスキル、または
  Canvas Extension を導入した GitHub Copilot App。Desktop 自体に AI チャットはありません。
- **デッキのソース:** 現在のワークスペース内にある `.md` または `.markdown` ファイル。

[クイックスタートを開く →](quick-start.md)
