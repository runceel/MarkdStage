# Microsoft Store listing — en-us

Canonical source for the MarkdStage Microsoft Store listing. Update this file
first, then copy the text into Partner Center. Japanese translations follow each
English block for review; only the English text is submitted.

Character limits: description 10,000; each product feature 200; each screenshot
caption 200.

## Description

```text
MarkdStage is a Windows application for Markdown slide decks stored in local workspace folders. It provides the shared MarkdStage slide UI, theme selection, Architecture diagram editing, presentation views, and PDF and PowerPoint export. The Microsoft Store installation includes the graphical app and the markdstage command-line tool. Node.js is not required.

Workspaces and Markdown

Open a folder and choose a .md or .markdown file, or open a Markdown file directly. Browse and filter the workspace file list, and reopen recent workspaces. Edit slide text in an external editor or AI tool; MarkdStage does not include a general Markdown text editor. Saving the file reloads the deck while preserving the current slide. If a reload fails, the last valid deck remains visible.

Choose dark, light, Microsoft, or custom themes. Decks can contain Architecture DSL and Mermaid diagrams, syntax-highlighted code, tables, and local images. Use Output preview to check the fixed 16:9 layout.

Architecture editing and Agent Skills

More controls → Shape editing opens the Architecture Editor in a native window. Edit an existing Architecture DSL diagram, then choose Save to update its fence in the Markdown file. Unsaved diagram changes do not update the deck source. If the source changed outside the editor, reload it before saving.

From the workspace file list, choose Install skills… to install MarkdStage Agent Skills for Codex, Claude Code, GitHub Copilot, or a combination. Skills are instruction files written to the selected workspace. Modified skill files are preserved unless force overwrite is explicitly selected. AI tools are installed and operated separately.

Presentation

- Presenter view with current and next slides and Slidev/Marp-style speaker notes
- A synchronized native audience window for a projector or second screen
- F11 for audience full screen, O for the slide list, and keyboard or margin-click navigation
- Surface Pen tail-button navigation while the audience window is running

Export

Use More controls → Export PDF or Export PowerPoint… in the GUI, or export from the included CLI. GUI exports are saved beside the Markdown file with the same base name, replacing an existing .pdf or .pptx at that path.

PowerPoint output is hybrid: supported text, shapes, and connectors remain editable, while unsupported visuals or effects may become images. The PowerPoint dialog offers Mermaid Editable shapes, with image fallbacks for unsupported details, or Images to keep each diagram as one image. Not every part of a slide becomes an editable object. Review the exported file before distributing it.

Requirements and local data

Requires Windows 10 version 1809 (build 17763) or later on x64 or ARM64, and Microsoft Edge WebView2 Runtime for the native UI and CLI validation. Native presentation and Architecture editing do not require a separate browser.

Layout-dependent CLI inspection and PNG capture, and PDF/PowerPoint export from either the GUI or CLI, additionally require an installed Microsoft Edge, Google Chrome, or Chromium. Browser policy that disables remote debugging prevents these operations. MarkdStage does not download or install browsers or runtimes.

Decks and installed Skills remain in local workspace files. MarkdStage does not require a MarkdStage account or upload decks to a MarkdStage service. Separately used AI assistants and services have their own data-handling policies.
```

### 和訳

MarkdStage は、ローカルのワークスペースフォルダーに保存された Markdown スライドデッキを扱う Windows アプリケーションです。MarkdStage 共通のスライド UI、テーマ選択、Architecture 図の編集、発表者・投影ビュー、PDF・PowerPoint エクスポートを備えています。Microsoft Store からのインストールには GUI アプリと `markdstage` コマンドラインツールの両方が含まれます。Node.js は不要です。

**ワークスペースと Markdown**

フォルダーを開いて `.md` または `.markdown` ファイルを選ぶか、Markdown ファイルを直接開きます。ワークスペース内のファイル一覧の表示・絞り込みや、最近使ったワークスペースの再表示ができます。スライドの文章は外部エディターや AI ツールで編集します。MarkdStage に汎用の Markdown テキストエディターはありません。ファイルを保存すると、現在のスライド位置を維持して再読み込みします。再読み込みに失敗した場合は、最後に正常に読み込めたデッキを表示し続けます。

テーマは dark、light、Microsoft、カスタムから選択できます。Architecture DSL と Mermaid の図、シンタックスハイライト付きコード、表、ローカル画像に対応しています。**Output preview** で固定 16:9 のレイアウトを確認できます。

**Architecture の編集と Agent Skills**

**More controls → Shape editing** から、ネイティブウィンドウの Architecture Editor を開きます。既存の Architecture DSL 図を編集し、**Save** を選ぶと Markdown 内の対応するコードフェンスを更新します。未保存の図の変更はデッキのソースに反映されません。外部でソースが変更された場合は、保存前に再読み込みが必要です。

ワークスペースのファイル一覧で **Install skills…** を選び、Codex、Claude Code、GitHub Copilot のいずれか、または複数を選択して MarkdStage Agent Skills をインストールできます。Skills は選択したワークスペースに書き込まれる指示ファイルです。変更済みの Skill ファイルは、強制上書きを明示的に選択しない限り保持されます。AI ツール本体のインストールと利用は別途行います。

**発表**

- 現在・次のスライドと Slidev／Marp 形式のスピーカーノートを表示する発表者ビュー
- プロジェクターやセカンドスクリーン用の、同期するネイティブ投影ウィンドウ
- F11 による投影の全画面表示、O によるスライド一覧、キーボードや余白クリックによる移動
- 投影ウィンドウの起動中に利用できる Surface Pen のテールボタン操作

**エクスポート**

GUI の **More controls → Export PDF** または **Export PowerPoint…**、あるいは同梱 CLI からエクスポートできます。GUI では Markdown と同じフォルダーに同じベース名で保存し、そのパスに既存の `.pdf` または `.pptx` がある場合は置き換えます。

PowerPoint 出力はハイブリッド形式です。対応するテキスト・図形・コネクタは編集可能なオブジェクトとなり、未対応の表示要素や効果は画像になる場合があります。PowerPoint ダイアログでは、Mermaid の対応部分を編集可能な図形、未対応の詳細を画像にする **Editable shapes** と、図全体を 1 枚の画像にする **Images** を選べます。スライドのすべての部分が編集可能になるわけではありません。配布前に出力ファイルを確認してください。

**動作要件とローカルデータ**

x64 または ARM64 の Windows 10 バージョン 1809（ビルド 17763）以降が必要です。ネイティブ UI と CLI の検証には Microsoft Edge WebView2 Runtime が必要です。ネイティブの発表機能と Architecture 編集には、別のブラウザーは不要です。

レイアウト計測を伴う CLI の検査と PNG キャプチャ、および GUI・CLI 両方の PDF／PowerPoint エクスポートには、インストール済みの Microsoft Edge、Google Chrome、または Chromium が別途必要です。ブラウザーポリシーでリモートデバッグが無効になっていると、これらの操作は実行できません。MarkdStage はブラウザーやランタイムをダウンロード・インストールしません。

デッキとインストールした Skills はローカルのワークスペースファイルとして保存されます。MarkdStage のアカウント登録は不要で、MarkdStage のサービスへのデッキのアップロードも行いません。別途利用する AI アシスタントやサービスには、それぞれのデータ取り扱いポリシーが適用されます。

## Product features

Enter these as seven separate bullet entries, in this order.

### 1

```text
Open local Markdown workspaces, browse deck files, and use the shared slide UI with theme selection and 16:9 Output preview.
```

> ローカルの Markdown ワークスペースを開き、デッキ一覧、テーマ選択、固定 16:9 の Output preview を共通のスライド UI で利用できます。

### 2

```text
Install workspace-scoped MarkdStage Agent Skills for Codex, Claude Code, and GitHub Copilot from the GUI; modified skill files are preserved unless force overwrite is selected.
```

> GUI から Codex、Claude Code、GitHub Copilot 向け Agent Skills をワークスペースにインストールできます。強制上書きを選ばない限り、変更済みのファイルは保持されます。

### 3

```text
Edit Markdown in an external text editor; saving reloads the deck while preserving the current slide. Failed reloads retain the last valid deck.
```

> Markdown を外部エディターで保存すると、現在のスライド位置を維持して再読み込みします。失敗時には最後に正常に読み込めたデッキを表示し続けます。

### 4

```text
Edit existing Architecture DSL diagrams in a native editor window and save changes back to Markdown with explicit Save and stale-source protection.
```

> 既存の Architecture DSL 図をネイティブの編集ウィンドウで変更し、Save で Markdown に保存できます。外部変更と競合する保存は拒否します。

### 5

```text
Render Mermaid and Architecture diagrams, highlighted code, tables, and local images with dark, light, Microsoft, or custom themes.
```

> Mermaid・Architecture 図、ハイライト付きコード、表、ローカル画像を dark、light、Microsoft、カスタムの各テーマで表示できます。

### 6

```text
Use presenter view with current/next slides and notes, plus a synchronized native audience window with keyboard, pointer, and Surface Pen navigation.
```

> 発表者ビューに現在・次のスライドとノートを表示し、ネイティブ投影ウィンドウと同期します。キーボード、ポインター、Surface Pen で操作できます。

### 7

```text
Export PDF and hybrid editable PowerPoint from the GUI or bundled CLI. Supported objects remain editable; unsupported visuals may become images.
```

> GUI と同梱 CLI から PDF とハイブリッド形式の PowerPoint を出力できます。対応するオブジェクトは編集可能となり、未対応の表示要素は画像になる場合があります。

## Screenshot captions

Upload the files in `screenshots/` in filename order. Each caption below matches
the screenshot with the same number.

### 01-architecture.png

```text
Architecture DSL rendered from a Markdown deck with groups, icons, labels, and routed connectors.
```

> Markdown デッキ内の Architecture DSL を、グループ・アイコン・ラベル・経路付きコネクタを持つ図として表示しています。

### 02-shape-editing.png

```text
Architecture Editor: adjust diagram elements, then use Save to update the existing Markdown fence. Unsaved diagram changes do not update the deck source.
```

> Architecture Editor で図の要素を調整し、Save で既存の Markdown フェンスを更新します。未保存の図の変更はデッキのソースに反映されません。

### 03-presenter.png

```text
Presenter view shows the current slide, the next slide, and speaker notes. The synchronized audience window displays the slide.
```

> 発表者ビューに現在・次のスライドとスピーカーノートを表示し、同期する投影ウィンドウにはスライドを表示します。

### 04-pptx-editable-shapes.png

```text
Hybrid PowerPoint export: supported text and diagram objects are editable. Unsupported visuals may be retained as images.
```

> ハイブリッド形式の PowerPoint 出力です。対応するテキストや図のオブジェクトは編集でき、未対応の表示要素は画像として保持される場合があります。

### 05-code-mermaid.png

```text
Syntax-highlighted code and Mermaid diagrams displayed in the shared slide renderer.
```

> 共通のスライドレンダラーで、シンタックスハイライト付きコードと Mermaid 図を表示しています。

### 06-custom-theme.png

```text
A custom theme applied to a Markdown deck, using local CSS and theme assets.
```

> ローカルの CSS とテーマアセットを使い、Markdown デッキにカスタムテーマを適用しています。
