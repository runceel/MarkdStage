<p align="center">
  <a href="https://github.com/runceel/markdstage">
    <img src="./assets/brand/markdstage-mark.svg" alt="MarkdStage" width="96">
  </a>
</p>

<h1 align="center">MarkdStage</h1>

<p align="center">
  <a href="./README.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/runceel/markdstage/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/runceel/markdstage/actions/workflows/ci.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-FFB547?labelColor=0B1020"></a>
  <img alt="Source format: Markdown" src="https://img.shields.io/badge/source-Markdown-F7F4ED?labelColor=0B1020">
  <img alt="Windows: x64 and ARM64" src="https://img.shields.io/badge/Windows-x64%20%7C%20ARM64-F7F4ED?labelColor=0B1020">
</p>

<p align="center">
  <a href="https://runceel.github.io/MarkdStage/">Web サイト</a> |
  <a href="#canvas-extension">Canvas Extension</a> |
  <a href="#desktop">Desktop</a> |
  <a href="#cli">CLI</a> |
  <a href="#community-macos-app">macOS アプリ</a> |
  <a href="#examples">表示例</a> |
  <a href="#markdown-format">Markdown 形式</a> |
  <a href="#documentation">ドキュメント</a> |
  <a href="https://github.com/runceel/markdstage/releases">リリース</a>
</p>

MarkdStage は、Markdown スライドの作成、確認、発表、エクスポートを行うオープンソースの
アプリケーションです。Windows 版は、ワークスペースのファイル一覧、Architecture 図の
ビジュアル編集、出力プレビュー、発表者・投影用ビュー、PDF と PowerPoint への出力に対応しています。
[Microsoft Store](https://apps.microsoft.com/detail/9N9DG772RM03)からインストールすると、
GUI と `markdstage` CLI の両方が導入されます。GUI からワークスペースへ Agent Skills を
インストールすることもできます。

同じ Markdown 形式を GitHub Copilot Canvas と npm 版 CLI でも利用できます。
AI の利用は任意です。テキストエディターでソースを編集するか、MarkdStage のガイドを参照できる
外部の AI ツールを使います。Desktop 自体に AI チャット画面はありません。

<a id="markdstage-を選ぶ理由"></a>

## 基本的な作業の流れ

| 作業 | できること |
| --- | --- |
| **作成** | テキストエディターで Markdown を書く、作例をコピーする、または AI に下書きを依頼します。Canvas のガイドと Agent Skills がスライド形式とテーマを説明します。 |
| **調整** | 文章はソースファイルで編集します。図形、プロパティ、接続線は Desktop、Canvas、CLI のブラウザー UI にある Architecture Editor で変更できます。 |
| **確認** | AI に「スライドに内容が収まっているか確認して」と依頼できます。AI がレイアウト診断と必要なページの画像を使って、修正が必要な箇所を調べます。 |
| **発表** | 手元でスピーカーノートと次のスライドを見ながら、操作が同期する観客向けウィンドウで発表できます。 |
| **共有** | 閲覧用の PDF や、確認・編集用のハイブリッド PowerPoint に出力できます。受け手に MarkdStage の導入を求めずに配布できます。 |

診断は見た目の確認を補助するもので、すべてのデザイン上の問題を判断するものではありません。
配布前には最終出力の全ページを確認します。PowerPoint では対応する文章・リスト・表・コード・
Architecture 図を編集でき、対応外の表現には画像フォールバックを使います。
PowerPoint 側の変更は Markdown には逆反映されません。対応範囲は
[発表とエクスポートのガイド](./docs/user-guide/ja/presenting-and-export.md)を参照してください。

## MarkdStage の使い方

| 利用環境 | 用途 |
| --- | --- |
| **[Windows Desktop と同梱 CLI](#desktop)** | GUI でワークスペース、スキル導入、Architecture 編集、表示確認、発表、出力を扱います。同梱 CLI は診断と自動化に使えます。 |
| **[GitHub Copilot と Canvas](#canvas-extension)** | GitHub Copilot App で作成・修正を依頼し、Architecture 図を画面上で調整して、Canvas から発表・出力できます。 |
| **[npm 版 CLI と Agent Skill](#cli)** | ターミナル、CI、Claude Code、Codex とブラウザー UI を使います。Canvas は不要です。 |
| **[AI を使わない編集](#present-without-ai)** | Markdown を自分で書くか作例から始め、Desktop、Canvas、CLI で開きます。 |
| **MarkStageForMac**（第三者製） | コミュニティ製の macOS ネイティブアプリで発表します。本リポジトリの開発・サポート対象外です |

<a id="desktop"></a>

## MarkdStage Desktop を使う

[Microsoft Store から MarkdStage](https://apps.microsoft.com/detail/9N9DG772RM03)をインストール
します。1 回のインストールで Windows アプリと `markdstage` コンソールエイリアスが導入されます。
**Windows パッケージに Node.js と npm は不要です。**

1. Windows のスタートメニューから **MarkdStage** を起動します。
2. **Open folder…** を選び、Markdown とアセットを保存するフォルダーを開きます。
3. AI ツールを使う場合は **Install skills…** で Codex、Claude Code、GitHub Copilot のうち
   利用するものを選び、**Install** を実行します。AI ツールでも同じフォルダーを開きます。
   スキル導入は任意であり、AI ツール本体や Canvas Extension はインストールされません。
4. ワークスペースの一覧から Markdown を選びます。文章をテキストエディターで編集して保存すると、
   Desktop の表示が更新されます。
5. Architecture 図のあるスライドで **More controls > Shape editing** を選びます。
   図を変更し、**Save** で Markdown に書き戻します。
6. **More controls** から **Output preview**、**Presenter view**、**Export PDF**、
   **Export PowerPoint…** を使用します。

![サンプルの Architecture 図と、編集・発表・出力のメニューを表示した MarkdStage Desktop](./docs/user-guide/images/windows-controls.png)

ネイティブ表示には Microsoft Edge WebView2 Runtime を使います。レイアウト診断、PNG 取得、
PDF／PowerPoint 出力には、インストール済みの Edge、Chrome、または Chromium も必要です。
MarkdStage がこれらのランタイムをダウンロードすることはありません。

ワークスペースの操作とスキル導入は [Windows ガイド](./docs/user-guide/ja/desktop.md)、
架空のサンプル、スクリーンショット、AI への依頼例を使った図の編集から出力までの手順は
[Windows 操作チュートリアル](./docs/user-guide/ja/windows-walkthrough.md)を参照してください。
ポータブル ZIP と署名済みサイドローディングパッケージについては、
[インストールガイド](./docs/user-guide/ja/installation.md)と
[v4.2.5 リリース](https://github.com/runceel/markdstage/releases/tag/v4.2.5)で説明しています。

<a id="canvas-extension"></a>

## Canvas Extension を使う

このリポジトリをプロジェクトとして開くと、`.github/extensions/markdstage/` がプロジェクトスコープで
読み込まれます。別のリポジトリへユーザースコープでインストールする場合は、現在の
**[v4.2.5 リリース](https://github.com/runceel/markdstage/releases/tag/v4.2.5)** を指定して
GitHub Copilot に依頼します。

> 次の GitHub リポジトリフォルダーから MarkdStage をユーザースコープへインストールしてください。
>
> `https://github.com/runceel/markdstage/tree/v4.2.5/.github/extensions/markdstage`

Extension は利用者の環境でローカルのコードを実行します。インストールする前に中身を確認し、
同じ状態を再現できるよう、信頼できるリリースタグかコミット SHA を指定してください。
`main` ブランチは開発中の最新版です。

### 最小ワークフロー

Extension の導入後、元資料やメモを添えて Copilot に依頼します。

> このメモから技術者向けの5枚のスライドを作成してください。dark テーマの `slides.md` として保存し、
> MarkdStage Canvas で表示してください。

先に `slides.md` を用意する必要はありません。作成後は、変更したい箇所を指定できます。

> テーマはそのままで、2枚目の説明だけ短くしてください。

1. 言い回しは Markdown、図の調整は [Architecture Editor](#examples) で直接編集できます。
2. Copilot に「スライドに内容が収まっているか確認して」と依頼します。自分で見た目を確認するときは **More controls > Output preview** を使えます。
3. **◀ ▶**、**矢印キー**、**☰ スライド一覧**でスライドを送れます。対応環境では Surface Pen も使えます。
4. **More controls** から発表用ウィンドウを開くか、PDF / PowerPoint に出力します。配布前に最終出力を確認します。

既存のデッキには「`slides.md` を使ってこのデッキをプレゼンテーションしてください」と依頼できます。
Copilot が形式のガイド、表示中のデッキ、診断を使う仕組みは
[AI を使った作成ガイド](./docs/user-guide/ja/ai-assisted-authoring.md)で説明しています。

Canvas の **More controls > Open Markdown** か `I` キーを使えば、AI を介さずにワークスペースの Markdown をそのまま開けます。
Git リポジトリではリポジトリルート、それ以外では現在のセッションで開いているフォルダーが
ワークスペースになります。`open_canvas` を直接呼び出す場合の Canvas ID は
**`MarkdStage`** です。

```text
canvasId: MarkdStage
```

<a id="cli"></a>

## CLI を使う

[MarkdStage CLI](./docs/user-guide/ja/cli.md) は Canvas なしで、Claude Code、Codex、ターミナル、
CI から利用できます。**npm 版 CLI** は **Node.js 24 以降**と、インストール済みの **Microsoft Edge、
Google Chrome、または Chromium** が必要です。ブラウザーの自動ダウンロードは行いません。
前提条件やオフライン導入は[インストールガイド](./docs/user-guide/ja/installation.md)を参照してください。

**Store 版には CLI が含まれるため、CLI を使うためだけに npm を追加する必要はありません。**
引数なしの `markdstage`、Markdown の直接指定、`preview` はネイティブのワークスペース
ウィンドウを開くか再利用し、`present` はネイティブの投影用ウィンドウも開きます。
診断とエクスポートはコンソールコマンドとして実行できます。
フラグ、前提条件、npm 版との違いは [CLI ガイド](./docs/user-guide/ja/cli.md)を参照してください。

### 導入して下書きを依頼

npm 版を選んだ場合は、先に CLI をインストールします。

```console
npm install --global @markdstage/markdstage
```

どちらの配布版でも、資料を作るフォルダーでスキル登録コマンドを実行できます。
Desktop の **Install skills…** も使用できます。以下は Claude Code の例です。

```console
markdstage skill install --target claude
```

Codex を使う場合は、スキル登録の行を `markdstage skill install --target codex` に置き換えます。
**利用する方を選び、両方を登録する必要はありません。** Skill は `markdstage guide` と同じ
形式・コマンドのガイドを提供します。選んだフォルダーの `.claude/skills/markdstage/` または
`.agents/skills/markdstage/` に導入されます。

同じフォルダーを利用するエージェントで開き、元資料やメモを添えて依頼します。

> markdstage スキルを使い、このメモから技術者向けの5枚のスライドを `slides.md` に作成してください。
> dark テーマで表示し、レイアウトも確認してください。

> テーマはそのままで、2枚目の説明だけ短くしてください。

### 調整・確認・発表

```console
markdstage slides.md
```

Markdown をテキストエディターで編集すると、保存時に UI が更新されます。npm 版のブラウザー UI で
鉛筆ボタンから Architecture 図の配置を調整でき、**Advanced edit** で詳細な編集ができます。
配置変更はその場で保存され、詳細デザイナーの下書きは **Save** で Markdown に書き戻されます。

収まりの確認は、同じエージェントに自然言語で依頼できます。

> スライドに内容が収まっているか確認してください。はみ出す箇所を調べ、必要なページは画像でも確認してください。

AI は Skill の手順に沿って構造の検証とレイアウト診断を行い、結果をもとに修正が必要な箇所を
調べます。利用者が診断コマンドを指定する必要はありません。

<details>
<summary>AI が使う診断の仕組み</summary>

`inspect`（CLI）と `inspect_layout`（Canvas）は、主に AI が描画後のクリッピングを調べるための
診断手段です。固定 16:9 の出力で見切れるページや要素を構造化された情報として返すため、
AI は最初から全ページを画像化せずに、修正が必要な箇所を絞れます。

CLI では AI が `validate` で構造・テーマ・DSL を検証し、`inspect` で収まりを診断します。
画像による確認が必要なページには `capture --pages` を使います。手動実行や CI での利用方法は
[CLI ガイド](./docs/user-guide/ja/cli.md)を参照してください。

</details>

調整後は AI に発表・出力を依頼するか、自分で次のコマンドを実行できます。

```console
markdstage present slides.md
markdstage export slides.md --output slides.pdf
markdstage export slides.md --output slides.pptx
```

npm 版の `present` は同じフル UI を発表者ビューで開き、**Start presentation** で同期した
観客向けウィンドウを開きます。Windows パッケージ版の `present` は発表者ビューとネイティブの
投影用ウィンドウをすぐに開き、繰り返してもそのウィンドウを再利用します。
配布前には最終出力の全ページを確認します。

<a id="present-without-ai"></a>

## AI を使わずに編集・発表する

Markdown を自分で書くか、[最小の記述例](#markdown-format)や
[ソース付きの作例](https://runceel.github.io/MarkdStage/#examples)から始めて、
`slides.md` として保存します。スキル登録は不要です。Windows の Store 版では次を実行します。

```console
markdstage --workspace .
markdstage slides.md
markdstage present slides.md
```

npm 版をグローバルインストールせずに使う場合は、次を実行します。

```console
npx @markdstage/markdstage --workspace .
npx @markdstage/markdstage slides.md
npx @markdstage/markdstage present slides.md
```

これらの `npx` コマンドは従来どおりブラウザーで動く npm 版です。最初のコマンドは現在の
ワークスペースを対象に Canvas と同等の空の UI を開きます。2つ目は
`slides.md` を自動更新付きで開きます。npm 版 CLI UI と Canvas のどちらでも
**More controls > Open Markdown** からファイルを直接開けます。
Desktop ではワークスペースの一覧か **Open Markdown file…** を使います。

<a id="community-macos-app"></a>

## コミュニティ製 macOS アプリ

[MarkStageForMac](https://github.com/07JP27/MarkStageForMac) は、MarkdStage コミュニティが
開発した macOS ネイティブアプリです。本リポジトリの開発・リリース・サポート対象外です。

<a id="examples"></a>

## 表示例

同じソースとレンダラーで、編集・プレビュー・発表・出力をつなげられます。
[Web サイトの作例](https://runceel.github.io/MarkdStage/#examples)では、表示結果と
ダウンロードできる Markdown を確認できます。

<table>
  <tr>
    <td width="50%">
      <img src="./assets/readme/simple-slide.png" alt="MarkdStage で表示した標準 Markdown スライド">
    </td>
    <td width="50%">
      <img src="./assets/readme/architecture-dsl.png" alt="MarkdStage スライドで表示した Architecture DSL 図">
    </td>
  </tr>
  <tr>
    <td valign="top">
      <strong>標準 Markdown</strong><br>
      見出し、リスト、強調、コード、表、画像をそのまま書けます。図の配置を自動で任せたいときは
      Mermaid も使えます。
    </td>
    <td valign="top">
      <strong>Architecture DSL</strong><br>
      グループやアイコンの位置、コネクターの経路を指定したいときは、
      <code>architecture</code> フェンスに JSON を書きます。
    </td>
  </tr>
</table>

### ネットワーク構成図の例

[Azure ハブスポークのサンプル](./site/examples/azure-hub-spoke.md)では、Architecture DSL v1 で
共有ハブ、4 つのスポーク VNet、入れ子のサブネットと VM、種類の異なる接続を表現しています。
ネットワークの位置は固定し、VM は自動で横並びに配置します。Azure Firewall 経由の
インターネット送信は別の経路図に分け、VNet の接続関係と通信の流れを区別しています。

[![Architecture DSL で描画した、4 つのスポークと共有ハブサービスを持つ Azure ハブスポーク構成図](./assets/readme/azure-hub-spoke/slide-002.png)](./site/examples/azure-hub-spoke.md)

[Microsoft Learn のハブスポーク構成](https://learn.microsoft.com/ja-jp/azure/architecture/networking/architecture/hub-spoke)
の概念を独自の配置で図示したもので、Azure 公式画像ではなく組み込みの汎用アイコンを使用しています。
デッキの描画にレンダラーの変更や外部画像素材は不要です。GitHub では `architecture` フェンスが
コードとして表示されるため、プレビュー画像から編集可能な Markdown ソースにリンクしています。
MarkdStage で図を開いて編集する手順は、[ガイドの実例](./docs/user-guide/ja/diagrams-and-media.md#azure-hub-spoke-example)
を参照してください。

### 図の記法を使い分ける

図の関係から自動配置したいときは **Mermaid** を使い、色味をテーマに合わせることもできます。
位置、サイズ、グループ、接続線を指定してスライドに合わせた構成にしたいときは
**Architecture DSL** を使えます。どちらにも対応しており、作りたい図に応じて選べます。

Architecture 図は直接調整できます。Desktop ではワークスペースの一覧、Canvas では
**More controls > Open Markdown** でソースを開きます。**More controls > Shape editing** から
ソースにひも付いた Architecture Editor を開き、ノード、グループ、画像、コネクターを編集します。
変更は下書きとして保持され、**Save** で Markdown に書き戻されます。
CLI の `preview --watch` でも Architecture 図のビジュアル編集に対応しています。

<p align="center">
  <img src="./assets/readme/architecture-editor.png" alt="Azure ハブスポーク構成図を開いた Architecture Editor。Hub VNet を選択し、プロパティを表示している" width="100%">
</p>

記法の詳細は[図とメディアのガイド](./docs/user-guide/ja/diagrams-and-media.md)を参照してください。

<a id="markdown-format"></a>

## Markdown 形式

```markdown
---
title: Sample
theme: dark
layout: title
---

# Sample presentation

---

## Second slide

- Use standard Markdown
- Write code and Mermaid directly

<!--
スピーカーノート:
ここで Markdown と Mermaid の記述例を紹介します。
-->
```

先頭のフロントマターがデッキ全体の設定になります。各スライドのフロントマターでは、
`layout`、`size`、`theme` などを個別に上書きできます。スピーカーノートは、コードフェンスの外側で
スライドに直接書いた HTML コメントに記述します。ノートは発表者ビューに表示され、PowerPoint
エクスポートでは対応するノートペインに読みやすいプレーンテキストとして書き出されます。
通常のスライド、投影用ウィンドウ、PDF 出力には表示されません。

<a id="documentation"></a>

## ドキュメント

- [ユーザーガイド](./docs/user-guide/ja/README.md)
- [インストールと前提条件](./docs/user-guide/ja/installation.md)
- [Windows Desktop: ワークスペース、スキル、編集、出力](./docs/user-guide/ja/desktop.md)
- [スクリーンショット付き Windows 操作チュートリアル](./docs/user-guide/ja/windows-walkthrough.md)
- [AI を使った作成](./docs/user-guide/ja/ai-assisted-authoring.md)
- [GitHub Copilot ハンズオン](./docs/user-guide/ja/copilot-hands-on.md)
- [Agent Skill のインストール](./docs/user-guide/ja/cli.md#agent-skills)
- [Canvas Extension の仕様とアクション](./.github/extensions/markdstage/README.md)
- [MarkdStage Desktop](./apps/MarkdStage.Desktop/README.md)
- [MarkdStage CLI](./docs/user-guide/ja/cli.md)
- [図とメディア](./docs/user-guide/ja/diagrams-and-media.md)
- [発表とエクスポートの対応範囲](./docs/user-guide/ja/presenting-and-export.md)
- [カスタムテーマ作成](./.github/extensions/markdstage/docs/custom-theme-authoring.md)
- [プロダクト原則](./PRODUCT.md)
- [ブランドとデザインシステム](./DESIGN.md)
- [現在のアーキテクチャ](./docs/architecture.md)
- [アーキテクチャ決定記録 (ADR)](./docs/adr/README.md)
- [リリース手順](./.github/RELEASING.md)
- [サードパーティ通知](./.github/extensions/markdstage/THIRD-PARTY-NOTICES.md)
- [MIT ライセンス](./LICENSE)

## リポジトリ構成

| パス | 内容 |
| --- | --- |
| `.github/extensions/markdstage/` | Canvas Extension、レンダラー、同梱オープンソースソフトウェア、スキーマ |
| `packages/markdstage-cli/` | `@markdstage/markdstage` CLI パッケージと CLI・Desktop が使う Agent Skill 生成処理 |
| `apps/MarkdStage.Desktop/` | WinUI 3 Desktop アプリ |
| `assets/brand/` | MarkdStage のロゴ、ロックアップ、README バナー |
| `assets/readme/` | スライドと Architecture Editor の作例画像 |
| `docs/user-guide/images/` | ユーザーガイドのスクリーンショットと Windows 操作動画 |
| `site/` | 日英対応の GitHub Pages サイト、本文、ソース付き作例 |
| `slides.md` | 機能を紹介するサンプルデッキ |

## Web サイトの開発

[Web サイト](https://runceel.github.io/MarkdStage/) は `site/` から静的に生成します。
ビルドに追加パッケージは不要です。Node.js 24 以降で次を実行します。

```console
npm run preview:site
```

日本語は `http://127.0.0.1:4173/MarkdStage/`、英語は末尾に `en/` を付けて開きます。
ソースの編集後はコマンドを再実行してください。`npm run build:site` は公開に必要な
ファイルだけを `_site/` に生成します。別の公開先でビルドする場合は、環境変数
`SITE_URL` にサイトの完全なベース URL を指定します。ローカルのポートは `PORT` で変更できます。

本文は `site/content/ja.json` と `site/content/en.json` をセットで編集します。
共通リンク、CLI コマンド、Canvas の信頼できるリリースタグは
`site/content/product.json` で管理します。`site/examples/` の作例は
`site/assets/examples/` の PNG と対応しています。作例を変更したら
[CLI の `capture --pages 1`](./docs/user-guide/ja/cli.md) で先頭スライドを再取得し、
対応する PNG を置き換えてください。Windows の画面は `docs/user-guide/images/` を再利用します。

`npm run test:site` は既存の Node、Playwright、axe-core でサイトを確認します。
必要に応じて `npm ci` でテスト依存関係、`npx playwright install chromium` で
Chromium を用意してください。
**GitHub Pages** workflow は PR では確認のみを行い、`main` への反映後に
確認済みの `_site/` を公開します。`main` を対象に手動実行することもできます。
Pages の Source は **GitHub Actions** に設定します。既存の公開先 URL を読み取り、
独自ドメイン・DNS・HTTPS 設定は変更しません。

## v2.0.0 の破壊的変更

MarkdStage への移行にあたり、旧ブランド名の互換エイリアスは用意していません。

| 変更前 | 変更後 |
| --- | --- |
| Canvas ID `presentation` | Canvas ID `MarkdStage` |
| ツール `presentation_guide` | ツール `markdstage_guide` |
| `.github/extensions/presentation/` | `.github/extensions/markdstage/` |
| `.github/skills/presentation/` | `markdstage skill install --target copilot` |
| `Presentation-win-*.zip` | `MarkdStage-win-*.zip` |

既存の Markdown 構文、テーマ、Architecture DSL、`load_deck` や `goto_slide` などの
アクション仕様は変更していません。

## ライセンス

このリポジトリの独自部分は MIT License で公開しています。同梱しているオープンソースソフトウェアの
ライセンスと著作権表示は、
[THIRD-PARTY-NOTICES.md](./.github/extensions/markdstage/THIRD-PARTY-NOTICES.md) を参照してください。
