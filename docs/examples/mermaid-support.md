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

The detailed compatibility guide defines the exact boundaries.

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
%%{init: {"sequence": {"diagramMarginX": 100, "actorMargin": 180, "width": 200, "messageMargin": 25, "mirrorActors": false}}}%%
sequenceDiagram
    autonumber
    actor U as Customer<br/>利用者
    participant A as Orders API
    participant D as Database
    U->>A: 注文<br/>Submit order
    activate A
    loop Up to 3 attempts
        A->>D: Save order
        D-->>A: Result
    end
    alt Created
        A-->>U: 201 Created
    else Rejected
        A-->>U: 409 Conflict
    end
    deactivate A
    Note over A,D: Supported note
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
  text: "サービス<br/>Available"
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

## Hybrid PowerPoint export

1. Convert supported primitives to native, editable PowerPoint objects.
2. Preserve an unsupported element or effect as the **smallest safe local image**.
3. Use a whole-diagram image only when the unsupported content cannot be separated safely.

Other Mermaid diagram types still render in slides. Content is never omitted merely because
editable conversion is unavailable.
