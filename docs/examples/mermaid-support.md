---
title: Mermaid support in MarkdStage
theme: microsoft
deck: Mermaid support
layout: title
---

# Mermaid support in MarkdStage
## Editable where safe, faithfully preserved everywhere

Bundled Mermaid 11.15.0 rendering with hybrid PowerPoint export.

---

## One source, three outcomes

| Where | What MarkdStage does |
| --- | --- |
| Slides and themes | Renders every bundled Mermaid format offline and applies the deck theme |
| Supported PowerPoint content | Keeps safe shapes, text, and connectors as editable objects |
| Unsupported or unsafe content | Preserves the smallest safe image fallback, or the whole diagram when separation is unsafe |

The compatibility guide summarizes editable coverage and fallback behavior.

---

## Flowcharts: common shapes and routes

```mermaid
flowchart LR
    subgraph Authoring
        direction LR
        A([Design<br/>設計]) --> B{Review}
    end
    B -->|Ready| C[[Publish]]
    B -->|Revise| D[Edit]
    D --> B
    classDef accent fill:#dbeafe,stroke:#2563eb,color:#102030
    class C accent
```

Common nodes, connectors, labels, subgraphs, and supported styling stay editable.

---

## Sequence: messages and control frames

```mermaid
%%{init: {"sequence": {"diagramMarginX": 80, "actorMargin": 160, "width": 220, "messageMargin": 22}}}%%
sequenceDiagram
    autonumber
    participant U as Customer<br/>利用者
    participant A as Orders API
    U->>A: 注文<br/>Submit order
    loop Up to 3 attempts
        A->>A: Validate and save
    end
    alt Accepted
        A-->>U: 201 Created
    else Rejected
        A-->>U: 409 Conflict
    end
```

---

## Class: structure and relationships

```mermaid
classDiagram
direction LR
namespace Core {
    class Account {
        +String name
        +save()
    }
    class Ledger {
        +record()
    }
}
class Gateway
note for Account "口座ノート<br/>Account note"
Account "1" *-- "0..*" Ledger : owns
Ledger ..> Gateway : publishes
Gateway <|-- Account : inherits
```

Compartments, common relations, multiplicities, notes, and namespaces remain independent.

---

## State: basic lifecycle

```mermaid
stateDiagram-v2
direction LR
[*] --> Idle
state "待機<br/>Idle" as Idle
Idle --> Running: 開始<br/>Start
Running --> Idle: 停止<br/>Stop
Running --> [*]
classDef active fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#102030
class Running active
```

Basic states, labels, start/end pseudo-states, and simple transitions stay editable.

---

## ER: attributes and cardinalities

```mermaid
erDiagram
direction LR
ACCOUNT["顧客<br/>Account"] {
  uuid id PK "primary"
  string displayName UK "表示名"
}
ORDER {
  int id PK
  uuid accountId FK
}
LINE_ITEM {
  int id PK
  int orderId FK
}
ACCOUNT ||--o{ ORDER : places
ORDER ||--|{ LINE_ITEM : contains
```

Entity rows, keys, labels, routes, and crow's-foot terminals use the rendered geometry.

---

## Requirement: blocks and relations

```mermaid
requirementDiagram
direction LR
requirement availability {
  id: "REQ-001"
  text: "サービスの可用性<br/>Service availability"
  risk: high
  verifymethod: test
}
element api {
  type: "Service"
  docRef: "docs/api"
}
element monitor {
  type: "Test"
  docref: "tests/availability"
}
api - satisfies -> availability
monitor - verifies -> availability
```

Supported requirement/element boxes, fields, relation labels, and markers stay editable.

---

## Packet and tree view

```mermaid
packet
title Request header / 要求ヘッダー
0-3: "Version"
4-7: "Flags"
8-15: "Length"
16-31: "識別子\nIdentifier"
```

```mermaid
treeView-beta
"Platform"
  "API"
    "認証"
    "Data"
  "Worker"
    "Queue"
```

Packet fields and bit labels, plus tree hierarchy lines and labels, remain editable.

---

## Kanban: columns, cards, and labels

```mermaid
kanban
    todo[Todo / 未着手]
        design["設計<br/>Design"]
        review[Review API]@{ assigned: "Alice", priority: "High", ticket: "42" }
    done[Done / 完了]
        ship[Ship]
```

Basic columns, cards, plain ticket/assignee labels, and priority bars stay editable.
Use `kanban`; `kanban-beta` is not a version alias in the bundled renderer.

---

## Block: basic shapes and connectors

```mermaid
block-beta
    columns 5
    a["受付<br/>Intake"] space:3 b("Review")
    space:5
    c{"承認"} space:3 d[("Store")]
    a -- "送信<br/>Send" --> b
    b --> d
    c --> a
```

`block` and `block-beta` share editable basic shapes, connectors, and simple HTML labels.
Special outlines and unsafe labels stay local images; arbitrary shapes and complex nesting
are not fully supported.

---

## Quadrant: points, borders, and rotated labels

```mermaid
quadrantChart
    title Priorities / 優先度
    x-axis Low effort --> High effort
    y-axis Low value --> High value
    quadrant-1 Invest
    quadrant-2 Quick wins
    quadrant-3 Hold
    quadrant-4 Review
    API: [0.25, 0.75] radius: 7, color: #2563eb
    Worker: [0.7, 0.6] radius: 6, color: #16a34a
    Legacy: [0.8, 0.2] radius: 8, color: #f97316
```

Quadrant rectangles, circular points, borders, titles, and simple axis/point labels stay editable.

---

## XY chart: bars, line vertices, and ticks

```mermaid
xychart-beta
    title "Sales / 売上"
    x-axis "Month / 月" [Jan, Feb, Mar, Apr]
    y-axis "Revenue / 収益" 0 --> 100
    bar [25, 65, 40, 85]
    line [40, 55, 30, 95]
```

`xychart` and `xychart-beta` share editable bars, straight line segments, axes, ticks,
and rotated labels; horizontal orientation and negative ranges also use rendered geometry.

---

## Charts: the editable boundary

- These are shapes, text, and lines, **not data-backed PowerPoint charts**.
- Positions, sizes, point radii, and line vertices come directly from Mermaid's SVG.
- Japanese and explicit SVG multiline text stay editable; literal HTML markup is not reinterpreted.
- Shadows, gradients, clipping, decorated text, unsafe transforms, and unknown geometry stay local images.
- Closed/curved/disconnected paths and existing element, point, or depth limits retain fallback diagnostics.

---

## Gantt: tasks, dates, rows, and milestones

```mermaid
gantt
    title Delivery / リリース
    dateFormat YYYY-MM-DD
    axisFormat %m/%d
    tickInterval 2day
    todayMarker off
    section Design / 設計
    Research :done, research, 2026-01-05, 2d
    Design :active, design, after research, 3d
    Gate :milestone, crit, gate, after design, 0d
    section Build / 実装
    API :api, 2026-01-06, 4d
    Release :crit, release, after api, 2d
```

Ordinary tasks (including done/active/critical), labels, date ticks, row backgrounds,
and rectangular excluded periods use Mermaid's rendered geometry, not recreated date math.

---

## Gantt: the editable boundary

- Known milestones keep their rounded diamond silhouette as editable rounded squares: centered 45° rotation and 0.8 scale only.
- Japanese, explicit SVG multiline labels, and simple rotated tick text reuse the common text adapter.
- The usual faded tick line/label pair is native only when its painted extents are safely separated.
- Overlapping or uncertain tick groups (including default top-axis labels) remain local images with their group alpha intact.
- Arbitrary transforms, effects, decorations, or unknown geometry retain local fallback bounds, source paths, reasons, and paint order.
- Other group opacity and existing scene/element/depth limits remain guarded; this is not general CSS transform or calendar-layout support.

---

## Hybrid PowerPoint export

1. Convert supported primitives to native, editable PowerPoint objects.
2. Preserve an unsupported element or effect as the **smallest safe local image**.
3. Use a whole-diagram image only when the unsupported content cannot be separated safely.

Other Mermaid diagram types still render and are preserved as images when editable conversion
is unavailable.

---
layout: backcover
---

# Mermaid support

Editable where safe. Faithfully preserved everywhere.
