---
theme: custom
theme-file: themes/helioworks/theme.css
deck: Helioworks Platform Review
title: Helioworks Platform Review
layout: title
kicker: FY26 Q2
---

# Helioworks Platform Review

## Shipping the grid-scale rollout

**Mika Arens** · VP of Platform Engineering · March 2026

---

---
deck: Helioworks Platform Review
kicker: Where we are
page: 2
total: 4
---

## The quarter in three numbers

| Metric | Q1 | Q2 | Change |
| --- | --- | --- | --- |
| Active sites | 1,240 | **1,910** | +54% |
| Median dispatch latency | 820 ms | **310 ms** | −62% |
| Unplanned downtime | 0.42% | **0.11%** | −74% |

- The **Northfield** migration finished two weeks early
- Edge caching removed the last synchronous hop
- Remaining risk sits entirely in the legacy billing path

---

---
deck: Helioworks Platform Review
kicker: How it runs
page: 3
total: 4
---

## Platform topology

```architecture
{
  "version": 1,
  "title": "Helioworks platform topology",
  "canvas": { "width": 1600, "height": 860 },
  "elements": [
    {
      "type": "group",
      "id": "sites",
      "x": 60,
      "y": 200,
      "width": 420,
      "height": 470,
      "title": "Sites",
      "layout": { "type": "column", "gap": 40, "padding": 56 },
      "children": [
        { "type": "node", "id": "northfield", "text": "Northfield", "icon": "network" },
        { "type": "node", "id": "southport", "text": "Southport", "icon": "network" }
      ]
    },
    {
      "type": "group",
      "id": "control",
      "x": 620,
      "y": 140,
      "width": 700,
      "height": 590,
      "title": "Control plane",
      "layout": { "type": "grid", "columns": 2, "gap": 44, "padding": 64 },
      "children": [
        { "type": "node", "id": "gateway", "text": "Gateway", "icon": "api" },
        { "type": "node", "id": "dispatch", "text": "Dispatch", "icon": "server" },
        { "type": "node", "id": "events", "text": "Events", "icon": "queue" },
        { "type": "node", "id": "insight", "text": "Insight", "icon": "analytics" }
      ]
    },
    {
      "type": "node",
      "id": "ledger",
      "x": 1340,
      "y": 355,
      "width": 240,
      "height": 160,
      "text": "Ledger",
      "icon": "database"
    },
    { "type": "connector", "from": "northfield", "to": "gateway", "routing": "orthogonal", "arrow": true },
    { "type": "connector", "from": "southport", "to": "gateway", "routing": "orthogonal", "arrow": true },
    { "type": "connector", "from": "gateway", "to": "dispatch", "arrow": true },
    { "type": "connector", "from": "dispatch", "to": "events", "routing": "orthogonal", "arrow": true },
    { "type": "connector", "from": "events", "to": "insight", "arrow": true },
    { "type": "connector", "from": "control", "to": "ledger", "label": "append", "routing": "orthogonal", "arrow": true }
  ]
}
```

---

---
deck: Helioworks Platform Review
kicker: What is next
page: 4
total: 4
---

## Commitments for Q3

- Retire the legacy billing path by **week 6**
- Bring **Southport** and **Vale** online behind the same control plane
- Publish the incident review template to every regional team
- Hold median dispatch latency under **250 ms** at 2,500 sites
