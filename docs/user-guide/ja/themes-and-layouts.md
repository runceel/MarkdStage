# テーマとレイアウト

> English version: [English](../themes-and-layouts.md)

テーマは色とタイポグラフィを決め、レイアウトは各スライドの内容の並べ方を決めます。

## 組み込みテーマ

デッキ全体のテーマはフロントマターで指定します。

```markdown
---
theme: dark
---
```

| テーマ | 向いている場面 |
| --- | --- |
| `dark` | 既定のダークネイビーのプレゼンテーション |
| `light` | 明るくくせのないプレゼンテーション |
| `microsoft` | Microsoft、Fluent、Office を意識したプレゼンテーション |
| `custom` | 組織のブランドカラーやカバー画像を使いたいとき |

Canvas Extension でデッキを開くときにテーマを指定すると、その指定が Markdown の
フロントマターより優先されます。どちらにもない場合は `dark` になります。

## スライドレイアウト

### タイトル

最初のスライドはタイトルレイアウトにします。

```markdown
---
layout: title
---

# Product launch

Technical briefing
```

### 標準

標準スライドでは `layout` を書きません。最初の H1 または H2 がタイトル領域に固定され、
本文はその下から始まります。

### セクション

章の区切りにはセクションレイアウトを使います。

```markdown
---
layout: section
---

## Architecture
```

セクションスライドの内容は短くまとめます。

### 中央配置

内容が少なく、上下中央に置きたいときは `layout: center` を指定します。

```markdown
---
layout: center
---

## One decision

Adopt the shared platform.
```

### 裏表紙

裏表紙は Canvas Extension が自動で足します。表示する内容は、フロントマターか
カスタムテーマのメタデータで `logo` や `copyright` に指定します。

## カスタムテーマを作成する

`theme.css` と、必要ならメタデータを入れたフォルダーを用意します。

```text
themes/brand/
  theme.css
  theme.json
  assets/
    cover.svg
    logo.svg
```

Markdown から参照します。

```markdown
---
theme: custom
theme-file: themes/brand/theme.css
---
```

`theme.css` には、CSS カスタムプロパティの宣言だけを書きます。

```css
:root {
  --bg: #101820;
  --fg: #ffffff;
  --body: #d7e3ef;
  --accent: #00a4ef;
  --surface: #182b3a;
  --border: #31536b;
}
```

セレクター、`@import`、`url()`、JavaScript、ワークスペース外のパスは受け付けません。
同じフォルダーに `theme.json` を置くと、スライド背景、表紙画像、表紙・裏表紙のロゴ、
著作権表記を指定できます。

```json
{
  "version": 1,
  "background": { "image": "assets/common.png" },
  "layouts": {
    "default": { "background": { "image": "assets/default.webp" } },
    "center": { "background": { "image": "assets/center.jpg" } }
  }
}
```

各背景は任意の文字列 `alt` も受け付けます。画像パスは `theme.json` からの相対パスで、
従来の安全なパス規則に従うテーマ内の `assets/` に限定されます。未知のキーや不正な値は
エラーになります。

## 背景画像

**すべてのテーマ・レイアウト**で、スライドごとに背景を上書きできます。タイトル、
セクション、裏表紙も対象です。

```markdown
---
layout: center
background-image: /assets/background.png
---

## One decision
```

先頭のスラッシュを省いた `assets/background.png` 形式も使えます。
ファイル先頭のフロントマターに書いても、後続スライドには継承されません。
探索順は Markdown と同じ階層の `assets/`、ワークスペース直下の `assets/` です。
ソース名がない場合はワークスペース直下だけを使います。これはテーマフォルダー内の
画像とは別の、デッキ用の画像です。

テーマ背景・個別背景ともに拡張子は `.svg`、`.png`、`.webp`、`.jpg`、`.jpeg` のみ、
1 ファイル最大 2 MiB です。リモート URL と `data:` URL は指定できません。
個別背景のファイル名は空白やパーセント記号を含めそのまま書き、区切りには `/` を使います。
ソースのパスは URL デコードされないため、`%20` は空白ではなくそのままの文字列です。
クエリ、フラグメント、バックスラッシュ、`.` / `..` のパス要素は指定できません。
シンボリックリンクの解決先も
assets フォルダーとワークスペースの内側に限定されます。

| レイアウト | 背景の優先順位 |
| --- | --- |
| 標準 (`default`) | 個別画像 → `layouts.default.background` → ルートの `background` → 既存背景 |
| `center` | 個別画像 → `layouts.center.background` → ルートの `background` → 既存背景 |
| `title` | 個別画像 → `cover.background` → 既存の表紙背景 |
| `section` / `backcover` | 個別画像 → 既存のレイアウト背景 |

共通背景は default/center にだけ適用されます。画像は中央配置でスライド全体を覆うように
トリミングされ (`object-fit: cover`)、本文・図・ロゴの背面に表示されます。
既存の背景色やグラデーションは下地として残ります。追加のオーバーレイやレイアウト別の
色設定はありません。新しい画像を指定しなければ、従来の表紙・ロゴや CSS のみのテーマは
そのまま維持されます。

フォールバックするのは**未指定の場合だけ**です。不正な値、ファイルの不存在、
2 MiB 超過はエラーになり、別の画像に黙って置き換わることはありません。

指定できるプロパティの一覧は
[カスタムテーマ作成ガイド](../../../.github/extensions/markdstage/docs/custom-theme-authoring.md)を参照してください。

## 発表前にレイアウトを確認する

伸縮する Canvas ではうまく見えても、固定 16:9 の出力では内容が見切れることがあります。
Canvas Extension で **More controls > Output preview** を選び、書き出す前に警告をすべて
解消してください。

[次へ: 図とメディア →](diagrams-and-media.md)
