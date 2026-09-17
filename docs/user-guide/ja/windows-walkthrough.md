# Windows 操作チュートリアル: ワークスペースから出力まで

> English version: [English](../windows-walkthrough.md)

ワークスペースの選択、任意の Agent Skills 導入、図の編集、レイアウト確認、発表者ビュー、
エクスポートを順に試します。Browser → API → Database というサービスのレビューを例に、
ソースの作成から発表・出力までを進めます。

## サンプルと操作動画

[サンプルの Markdown](../../../site/examples/windows-workflow.md)をダウンロードし、
`C:\decks\sample-review` などの新しいフォルダーに `slides.md` として保存します。
6 枚のスライド、3 枚目の Architecture 図、スピーカーノートを含みます。
MarkdStage が裏表紙を追加するため、表示と出力は 7 ページになります。
外部アセットやアカウントへのアクセスは不要です。

[3 分 4 秒の Windows チュートリアル動画を再生・ダウンロードする（MP4）](../images/windows-workflow.mp4)。
AI エージェントへの文章による依頼と Markdown の出力例から始まり、ファイル表示、
図のドラッグと Save、発表者・投影用ウィンドウ、GUI の PDF/PPTX 出力、PDF の確認、
PowerPoint での文字と図形の編集を説明します。音声はありません。
[Web サイト](https://runceel.github.io/MarkdStage/#windows-workflow)で英語・日本語の字幕を
切り替えて再生できます。

MarkdStage の画面は **Windows ポータブル版 v4.2.5** のものです。
MarkdStage の操作名とサンプルは英語、PowerPoint の操作画面は日本語です。
以下の Store の手順では同じアプリの
ワークスペース UI と Store が登録する CLI エイリアスを使います。
ポータブル ZIP はエイリアスを登録しません。

## 1. 導入してワークスペースを開く

1. [Microsoft Store から MarkdStage](https://apps.microsoft.com/detail/9N9DG772RM03)を導入します。
   GUI と `markdstage` CLI が含まれ、Node.js と npm は不要です。
2. **MarkdStage** を起動し、**Open folder…** でサンプルのフォルダーを開きます。
3. **MARKDOWN FILES** に `slides.md` があることを確認します。

![公開用サンプルと Install skills を表示した Windows ワークスペース](../images/windows-workspace.png)

ネイティブ UI には WebView2、診断・キャプチャー・出力にはインストール済みの
Edge、Chrome、Chromium のいずれかも必要です。前提条件と別の導入方法は
[インストールガイド](installation.md)を参照してください。

## 2. AI を使う場合はスキルを導入する

**Install skills…** で利用する対象を選び、**Install** を実行します。
選択したワークスペース内の、Codex は `.agents/skills/markdstage/`、
Claude Code は `.claude/skills/markdstage/`、GitHub Copilot は
`.github/skills/markdstage/` に導入されます。

![導入する Agent Skills を選ぶネイティブのダイアログ](../images/windows-skills.png)

ローカルの編集を置き換える意図がなければ、**Force overwrite modified skill files** は
オフのままにします。外部の AI ツールでも同じフォルダーを開いてください。
スキルは使い方を伝えるファイルであり、AI ツールの導入やサインインは行いません。
Desktop 自体に AI チャット画面はありません。

同梱の Markdown をそのまま使う場合、この操作と以下の AI への依頼は省略できます。

## 3. ソースを作成・修正する

ダウンロードしたサンプル、テキストエディターで書いた Markdown、または AI が作成した
ファイルを使えます。**AI エージェントへの依頼文の例:**

```text
markdstage スキルを使って slides.md を作成してください。

Browser -> API -> Database サービスをレビューする6枚のスライドにします。
light テーマを使い、表紙、目的、Architecture 図、コンポーネントの役割、
レビュー項目、発表と出力の確認項目を含めてください。

スピーカーノートも追加してください。構造と固定16:9のレイアウトを確認し、
エラーや見切れがあれば直してください。
```

AI の完了報告で、保存先、構造の検証結果、レイアウトの結果、未解決の問題を確認します。
ソースも開き、事実とノートを自分で読みます。再実行した AI の出力が同梱サンプルと
バイト単位で一致するとは限りません。

修正箇所を限定する場合は、次のように依頼できます。

```text
テーマ、図、スライドの順序を保ったまま、2枚目の説明だけを短くしてください。
slides.md を保存し、変更したスライドを固定16:9のクリッピングについて再確認してください。
```

**Canvas Extension を導入した GitHub Copilot App** では、次のように確認を依頼できます。

```text
slides.md を元ファイルにひも付いた MarkdStage Canvas のデッキとして開いてください。
inspect_layout でクリッピングを確認し、報告された見切れを Markdown で直して、
固定16:9の Output preview を表示してください。
Shape editing で同じファイルへ保存できるよう、ソースとの関連付けを維持してください。
```

Desktop と Canvas は別々に同じファイルを表示します。Desktop で選択したスライドが
外部 AI へ自動共有されるわけではありません。
2 つの連携方法は [AI を使った作成](ai-assisted-authoring.md)で説明しています。

## 4. Architecture 図を編集する

1. Desktop で `slides.md` を選びます。必要なら **Return to slide view** を選びます。
2. **Slide list** から **3 Request path** を選びます。
3. **More controls > Shape editing** を選びます。
4. 描画面の **API** ノード、または **Elements** の **api — API** を選びます。
5. ドラッグで位置を調整します。動画では `X=470, Y=140` から `X=550, Y=220` に移動しています。
   座標を指定する場合は **Properties > Geometry** で **X** と **Y** を入力します。
6. **Save** で保存してエディターを閉じ、スライドの図が更新されたことを確認します。

![API ノードを選択し、位置を変更する前のネイティブ Architecture Editor](../images/windows-architecture-editor.png)

変更は **Save** まで下書きのままです。その間にテキストエディターや AI が元ファイルを
変更した場合は、新しい内容を上書きせず読み込み直します。編集には既存の
`architecture` フェンスが必要です。一般の Markdown テキストや Mermaid ソースは対象外です。

## 5. 出力レイアウトを確認する

**More controls > Output preview** で固定 1280×720 の表示を確認します。初期状態では有効です。
レスポンシブ表示で配置を編集した場合は再び有効にし、クリッピング警告があれば解消します。

![図の編集、出力プレビュー、発表、エクスポートを選べる Desktop の操作メニュー](../images/windows-controls.png)

構造化された結果を得るには、サンプルのフォルダーで次を実行するか、AI に実行を依頼します。

```console
markdstage validate slides.md --json
markdstage inspect slides.md --json
markdstage capture slides.md --pages 3
```

validate はソースの構造、inspect はスライドへの収まりを確認し、capture は目視確認用の画像を
取得します。いずれも図の技術的な意味の正しさまでは判断しません。

## 6. ノートを見ながら発表する

**More controls > Presenter view** を選び、現在のスライド、次のスライド、ノートを確認します。

![通信経路の図とスピーカーノートを表示した Desktop の発表者ビュー](../images/windows-presenter.png)

**Start presentation** で操作が同期するネイティブの投影用ウィンドウを開きます。
投影先の画面へ移し、`F11` で全画面、`Esc` でウィンドウ表示へ戻します。
**End presentation** で閉じます。Store 版の `markdstage present slides.md` でも、
発表者ビューと投影用ウィンドウを直接開けます。

ノートは投影用ウィンドウと PDF には含まれませんが、PowerPoint のノートには含まれます。

## 7. エクスポートして確認する

スライド表示に戻り、**More controls > Export PDF** または **Export PowerPoint…** を選び、
完了通知を待ちます。Markdown と同じフォルダーに `slides.pdf` または `slides.pptx` が
作成されます。**同名の出力がある場合は置き換えます。**

別名が必要な場合は同梱 CLI を使います。

```console
markdstage export slides.md --output review.pdf
markdstage export slides.md --output review.pptx
```

出力された全 7 ページと、PowerPoint の場合はノートも確認します。対応する文章と図は
PowerPoint で編集でき、対応外の表現は画像になります。PowerPoint 側の変更は Markdown に
逆反映されません。詳細は[出力の互換性](presenting-and-export.md)を参照してください。

## 8. 出力した PowerPoint ファイルを編集する

PowerPoint は別途用意するアプリであり、MarkdStage のインストールには含まれません。
動画と同じ編集を行う場合は、次のように操作します。

1. 出力した `slides.pptx` を PowerPoint で開き、3 枚目を選びます。
2. **Request path** の見出し内をクリックし、文字を選択して **Request flow** に書き換えます。
3. **API** の四角形を選び、**図形の書式 > 図形の塗りつぶし** で色を変更します。
   英語版の操作名は **Shape Format > Shape Fill** です。
4. `Ctrl+S` で保存し、変更後のスライドを確認します。

![見出しの文字と API 図形の塗りつぶしを変更した、実際の PowerPoint の画面](../images/windows-powerpoint-edit.png)

ここで変更しているのは、差し替え用の画像ではなく、編集可能な文字と対応する四角形です。
アイコンや対応外の表現など、画像として出力されるオブジェクトもあります。
変更は PPTX にだけ保存されるため、今後 MarkdStage で修正するための元ファイルとして
`slides.md` を残してください。
