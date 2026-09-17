# MarkdStage Desktop

> English version: [English](../desktop.md)

MarkdStage Desktop は、Markdown デッキを扱う Windows アプリです。ワークスペースのファイル一覧、
Agent Skills の導入、共通のスライド UI、Architecture 図の編集、発表者・投影用ビュー、
PDF と PowerPoint への出力に対応しています。

スライドの文章は外部のテキストエディターや AI ツールで記述します。Desktop は保存された
Markdown を描画し、`architecture` 図を画面上で編集できます。汎用テキストエディターや
AI チャット画面は内蔵していません。

## インストールして起動する

[Microsoft Store から MarkdStage](https://apps.microsoft.com/detail/9N9DG772RM03)を
インストールし、スタートメニューから **MarkdStage** を起動します。同時に `markdstage` CLI も
導入されるため、Node.js と npm の追加インストールは不要です。ランタイムの要件、
ポータブル ZIP、サイドローディングについては[インストールガイド](installation.md)を参照してください。

## ワークスペースと Markdown ファイルを開く

1. **Open folder…** を選び、資料を保存するフォルダーを開きます。
2. **MARKDOWN FILES** の一覧で `.md` または `.markdown` ファイルを探します。
   **Filter Markdown files** で絞り込み、ファイル追加後は **Refresh** で一覧を更新できます。
3. ファイルを選ぶとスライド表示になります。**Open Markdown file…** から Windows の
   ファイルピッカーで選ぶこともできます。

![サンプルの Markdown、フィルター、Install skills ボタンを表示した Desktop のワークスペース](../images/windows-workspace.png)

このフォルダーが Markdown、アセット、テーマ、生成するスキル、出力ファイルのワークスペースに
なります。左上の **Back to the file list** で一覧へ戻れます。開始画面には最近使った
ワークスペースも表示されます。GUI がターミナルの現在のディレクトリを自動選択することはありません。

架空のデータだけで一連の操作を試すには、[Windows 操作チュートリアル](windows-walkthrough.md)を
参照してください。

## ワークスペースへ Agent Skills をインストールする

フォルダーを開いた後、ワークスペース画面の **Install skills…** を選びます。
利用する対象を 1 つ以上選択して **Install** を実行します。
初期状態では 3 つすべてが選択されているため、使わない対象は選択を解除します。

| 対象 | ワークスペース内に作成されるディレクトリ |
| --- | --- |
| Codex | `.agents/skills/markdstage/` |
| Claude Code | `.claude/skills/markdstage/` |
| GitHub Copilot | `.github/skills/markdstage/` |

![導入先と、変更済みファイルの上書きオプションを選ぶ Install MarkdStage skills ダイアログ](../images/windows-skills.png)

Desktop は Node.js を必要とせず、`markdstage skill install` と同じパッケージ内の
MarkdStage Agent Skills を書き込みます。同じ内容のファイルは変更しません。
ローカルで編集済みのファイルは既定では競合として報告し、上書きしません。編集内容を
意図的に置き換える場合に限り、**Force overwrite modified skill files** を選択してください。

AI ツールでも同じワークスペースを開き、スキルを検出させます。スキルは Markdown 形式、テーマ、
図、CLI の使い方を伝えるファイルです。AI ツール本体の導入、サービスへのサインイン、
Canvas Extension のインストールは行いません。Markdown の直接編集と発表にはスキルは不要です。
同等の CLI 操作は [Agent Skills](cli.md#agent-skills) を参照してください。

## スライドの確認と図の編集

スライド表示では固定 16:9 の **Output preview** が初期状態で有効です。
下部のツールバーには、前／次の操作、**Slide list**、**More controls** があります。

![発表、図の編集、出力プレビュー、エクスポートのメニューを開いた Desktop](../images/windows-controls.png)

| 作業 | 操作 |
| --- | --- |
| 固定出力とクリッピング警告を確認する | **More controls > Output preview** |
| 既存の Architecture 図を編集する | **More controls > Shape editing** |
| 現在・次のスライドとノートを表示する | **More controls > Presenter view** |
| ネイティブの投影用ウィンドウを直接開く | **More controls > External window** |
| PDF／PowerPoint を書き出す | **More controls > Export PDF** または **Export PowerPoint…** |

`architecture` フェンスのあるスライドでは、**Shape editing** で別ウィンドウの
Architecture Editor を開きます。図が複数ある場合は対象を選択します。図形、テキスト、位置、
サイズ、接続線などを変更し、**Save** で下書きを Markdown に書き戻します。
編集中に元ファイルが外部で変更された場合は、上書きせず保存時にエラーを表示します。

![サンプルの通信経路と API のプロパティを表示したネイティブの Architecture Editor](../images/windows-architecture-editor.png)

編集には既存の `architecture` フェンスが必要です。最初は空のフェンスでも構いません。
Mermaid のソース、Archify から読み込んだ図、一般の Markdown テキストはこのエディターの
対象外です。操作の詳細は[図とメディア](diagrams-and-media.md)、Markdown でのテーマ指定は
[テーマとレイアウト](themes-and-layouts.md)を参照してください。

## スライドを移動する

| 入力 | 操作 |
| --- | --- |
| `Left` / `PageUp` | 前のスライド |
| `Right` / `PageDown` / `Space` | 次のスライド |
| `Home` | 最初のスライド |
| `End` | 最後のスライド |
| `O` | Slide list を開く |
| 空白部分を左クリックまたはタップ | 次のスライド |
| 空白部分を右クリック | 前のスライド |

空白部分の操作は、現在のスライドのプレビューと投影用ウィンドウで使えます。
スライド内の操作できるコンテンツの上では働きません。

**Slide list** を選ぶか `O` を押すと、目的のページへ移動できます。上記のキー操作は
スライド移動用であり、テキスト入力欄や図の編集中の操作にはそのまま適用されません。

## スピーカーノートを使う

ノートは、スライドに直接書いた HTML コメント（コードフェンスの外）に記述します。

```markdown
## Demonstration

- The audience sees this content.

<!--
Explain the setup, then run the demo.
-->
```

**More controls > Presenter view** で現在のスライド、次のスライド、ノートを表示します。
ノートは通常のスライド表示、投影用ウィンドウ、PDF には含まれません。PowerPoint には
ノートとして書き出されるため、配布前に内容を確認してください。

![現在の図、次のスライド、スピーカーノートを表示した Desktop の発表者ビュー](../images/windows-presenter.png)

## 聞き手に見せる

発表者ビューで **Start presentation** を選ぶと、操作が同期するネイティブの投影用ウィンドウが
開きます。スライド表示の **More controls > External window** からも開けます。

- 投影用ウィンドウを目的のディスプレイへ移します。
- `F11` を押して全画面にします。
- `Esc` を押すとウィンドウ表示に戻ります。
- 投影用ウィンドウを閉じるか、**End presentation** を選ぶと終了します。

どちらのウィンドウで操作しても、両方の表示が同時に切り替わります。

## PDF と PowerPoint を出力する

1. スライド表示に戻り、**More controls > Output preview** で確認します。
2. **More controls** の **Export PDF** または **Export PowerPoint…** を選びます。
3. 完了通知を待ち、通知内のリンクか Markdown と同じフォルダーから出力を開きます。
4. 自動追加される裏表紙を含め、全ページを確認します。

GUI は元ファイル名から出力名を決めます。`slides.md` なら `slides.pdf` または `slides.pptx` です。
同名の出力がある場合は置き換えます。必要なファイルを先にコピーするか、別名が必要なら
CLI の `--output` を使用してください。

出力には WebView2 に加えて、インストール済みの Edge、Chrome、または Chromium が必要です。
PowerPoint はハイブリッド出力であり、対応する文章、表、コード、図は編集可能な要素、
対応外の表現は画像になります。PowerPoint 側の変更は Markdown に反映されません。
Mermaid の出力方式、ノート、互換性は[プレゼンテーションとエクスポート](presenting-and-export.md)で
説明しています。

## 同梱 CLI を使う

Store 版を導入した場合、ワークスペースでターミナルを開いて実行します。

```console
markdstage --version
markdstage slides.md
markdstage inspect slides.md --json
markdstage present slides.md
markdstage export slides.md --output review.pdf
```

パッケージ版 CLI でファイルを開くと、対応するネイティブのワークスペースウィンドウを再利用します。
`present` は発表者ビューと投影用ウィンドウをすぐに開きます。`inspect` と `export` は
コンソール処理です。npm 版、ポータブル版との違いは [CLI ガイド](cli.md)を参照してください。

## 自動再読み込み

Desktop は選択した Markdown ファイルを監視します。保存された内容が有効ならデッキを読み込み直し、
表示中のスライド位置をできるだけ保ちます。

内容が壊れている場合はエラーを表示し、最後に正しく表示できたデッキをそのまま残します。
ファイルを直して保存し直すと元に戻ります。

## Surface Pen

投影用ウィンドウを開いている間は、次の操作が使えます。

| ジェスチャー | 操作 |
| --- | --- |
| テールボタンを1回押す | 次のスライド |
| テールボタンを長押しする | 前のスライド |

ペンの接続、取り外し、ドッキングをきっかけに MarkdStage が起動したり、
プレゼンテーションが始まったりすることはありません。

[次へ: Windows 操作チュートリアル →](windows-walkthrough.md)
