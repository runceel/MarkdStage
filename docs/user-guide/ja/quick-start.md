# クイックスタート

> English version: [English](../quick-start.md)

この手順では、同梱の [`examples/quick-start.md`](../examples/quick-start.md) デッキを使います。
自分のワークスペースに `slides.md` としてコピーします。以下のコマンドはこのファイル名を前提にします。

## 1. Markdown デッキを作成する

最小構成のデッキは、フロントマター、タイトル、`---` のスライド区切りだけでできています。

```markdown
---
title: My first deck
theme: dark
layout: title
---

# My first deck

A sample Markdown presentation.

---

## Next slide

- Write standard Markdown
- Keep one main idea per slide
```

`.md` または `.markdown` 拡張子で保存します。

トップレベルでは、空行の後に単独で置いた `---` がスライド区切りになります。
`<!-- slide -->` のような独自の区切りは使用しません。スライド末尾にトップレベルの
HTML コメントを置く場合は、コメントの終了行と次の `---` の間に空行を入れてください。

## 2. Windows Desktop で開く

1. [Microsoft Store から MarkdStage](https://apps.microsoft.com/detail/9N9DG772RM03)を導入します。
   GUI と CLI が同時にインストールされ、Node.js は不要です。
2. **MarkdStage** を起動し、**Open folder…** でワークスペースを開きます。
3. ファイル一覧から `slides.md` を選びます。

![Windows アプリで Markdown デッキを開いた画面](../images/windows-slide.png)

画面は UI の説明用に [Windows 操作チュートリアルのサンプル](windows-walkthrough.md)を
使用しています。上の最小デッキとは内容が異なります。

発表専用ではなく、スライド表示から **More controls** で編集、出力プレビュー、発表、
エクスポートを行えます。前回の発表者ビューが残っている場合は **Return to slide view** を選びます。

### Canvas を選ぶ場合

どちらの方法でも開けます。

- GitHub Copilot に「`slides.md` を MarkdStage Canvas で開いてください」と依頼します。
- MarkdStage Canvas を開き、**More controls > Open Markdown** からファイルを選びます。

デッキ全体がすぐに開きます。**◀**、**▶**、矢印キー、**☰** でスライドを送れます。

### CLI を選ぶ場合

Store 版の `markdstage slides.md` は同じネイティブアプリを開きます。
ブラウザーで動く npm 版の場合は、次を実行します。

```console
npx @markdstage/markdstage slides.md
```

npm 版の前提条件は[インストールガイド](installation.md)を参照してください。
npm の UI では **More controls > Open Markdown** から別のファイルを選べます。

## 3. 編集して確認する

文章はテキストエディターで編集し、保存するとプレビューが更新されます。
Architecture 図のあるスライドでは **More controls > Shape editing** と **Save** で
図を Markdown に書き戻します。**Output preview** を有効に保ち、固定 16:9 の結果を確認します。

AI の利用は任意です。Desktop と併用する場合はファイル一覧に戻り、**Install skills…** で
対象を選び、AI ツールでも同じフォルダーを開きます。
[Windows 操作チュートリアル](windows-walkthrough.md)に依頼例とサンプルの図があります。

## 4. プレゼンテーションを開始する

- **Canvas Extension:** **More controls > External window** で外部の投影用ウィンドウを開くか、
  **More controls > Presenter view** で現在のスライド、次のスライド、ノートをまとめて表示します。
- **CLI:** 同じ操作を使うか、`markdstage present slides.md` で発表者ビューから開始します。
- **Desktop:** **More controls > Presenter view**、**Start presentation** の順に選びます。
  Store 版の `markdstage present slides.md` は両方のビューを直接開きます。
- 投影用ウィンドウで `F11` を押すと全画面表示になり、`Esc` で元に戻ります。

## 5. PDF または PowerPoint をエクスポートする

Desktop、Canvas、npm 版 CLI UI で同じ操作を使用できます。

1. **More controls > Output preview** が有効か確認し、クリッピング警告があれば直します。
   初期状態では有効です。再び有効にする必要がある場合だけクリックします。
2. **More controls > Export PDF** を選びます。テキスト、表、コード、Architecture DSL が
   PowerPoint 上で編集可能なまま残るハイブリッド形式が必要なときは
   **More controls > Export PowerPoint** を選びます。
3. Markdown と同じフォルダーに出力されたファイルを確認します。GUI は元のファイル名から
   決まる同名の出力を置き換えるため、以前の出力が必要なら先にコピーしてください。

Canvas Extension を導入せずに、CLI から同じ出力を得ることもできます。

```console
markdstage export slides.md --output slides.pdf
markdstage export slides.md --output slides.pptx
```

出力にはインストール済みの Edge、Chrome、Chromium のいずれかが必要です。
npm 版をグローバルインストールせずに使う場合は、`markdstage` を `npx @markdstage/markdstage` に
置き換えます。

## 次のステップ

- [Windows 操作チュートリアルを試す](windows-walkthrough.md)
- [GitHub Copilot ハンズオンを試す](copilot-hands-on.md)
- [AI を使った作成](ai-assisted-authoring.md)
- [Canvas Extension を使う](canvas-extension.md)
- [MarkdStage Desktop を使う](desktop.md)
- [Markdown スライドを記述する](markdown-authoring.md)
