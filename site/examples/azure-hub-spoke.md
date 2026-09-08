---
theme: dark
deck: Azure hub-spoke | Architecture DSL
layout: title
size: normal
---

# Azure hub-spoke network

Architecture DSL v1: nested networks, stable placement, and explicit connections

An original schematic based on the concepts in Microsoft Learn, not a deployment template.

---

## Four spokes, one shared hub

```architecture
{
  "version": 1,
  "title": "Azure hub-spoke network topology",
  "description": "An original conceptual diagram: four spoke VNets peer with a shared hub. Each spoke contains a resource subnet and three VMs. The hub provides Bastion, Firewall, and a VPN or ExpressRoute gateway. On-premises connects to the gateway, hub diagnostics go to Monitor, and an optional direct connection joins the nonproduction spokes. The outer boundary is a VNet management scope, not a network hop. Traffic routes and security policies are not shown.",
  "canvas": { "width": 1600, "height": 780 },
  "elements": [
    {
      "type": "group", "id": "managedVnets",
      "title": "Azure Virtual Network Manager | VNet management scope",
      "x": 280, "y": 20, "width": 1290, "height": 690,
      "style": { "fill": "transparent", "stroke": "muted", "dash": "8 6", "fontSize": 24 },
      "children": [
        {
          "type": "group", "id": "prodA", "title": "Production A | Spoke VNet",
          "x": 30, "y": 60, "width": 340, "height": 210,
          "style": { "fill": "surface", "stroke": "#60a5fa", "fontSize": 23 },
          "children": [
            {
              "type": "group", "id": "prodASubnet", "title": "Resource subnet",
              "x": 20, "y": 55, "width": 300, "height": 135,
              "layout": { "type": "row", "gap": 12, "padding": 16 },
              "style": { "fill": "bg", "stroke": "border", "fontSize": 21 },
              "children": [
                { "type": "node", "id": "prodAVm1", "text": "VM 1", "icon": "server", "style": { "fontSize": 20 } },
                { "type": "node", "id": "prodAVm2", "text": "VM 2", "icon": "server", "style": { "fontSize": 20 } },
                { "type": "node", "id": "prodAVm3", "text": "VM 3", "icon": "server", "style": { "fontSize": 20 } }
              ]
            }
          ]
        },
        {
          "type": "group", "id": "prodB", "title": "Production B | Spoke VNet",
          "x": 910, "y": 60, "width": 340, "height": 210,
          "style": { "fill": "surface", "stroke": "#60a5fa", "fontSize": 23 },
          "children": [
            {
              "type": "group", "id": "prodBSubnet", "title": "Resource subnet",
              "x": 20, "y": 55, "width": 300, "height": 135,
              "layout": { "type": "row", "gap": 12, "padding": 16 },
              "style": { "fill": "bg", "stroke": "border", "fontSize": 21 },
              "children": [
                { "type": "node", "id": "prodBVm1", "text": "VM 1", "icon": "server", "style": { "fontSize": 20 } },
                { "type": "node", "id": "prodBVm2", "text": "VM 2", "icon": "server", "style": { "fontSize": 20 } },
                { "type": "node", "id": "prodBVm3", "text": "VM 3", "icon": "server", "style": { "fontSize": 20 } }
              ]
            }
          ]
        },
        {
          "type": "group", "id": "hub", "title": "Hub VNet",
          "x": 500, "y": 180, "width": 320, "height": 330,
          "style": { "fill": "surface", "stroke": "#fbbf24", "fontSize": 23 },
          "children": [
            {
              "type": "node", "id": "bastion", "text": "Azure Bastion", "icon": "shield",
              "x": 30, "y": 55, "width": 260, "height": 65,
              "style": { "fontSize": 24 }
            },
            {
              "type": "node", "id": "firewall", "text": "Azure Firewall", "icon": "shield",
              "x": 30, "y": 145, "width": 260, "height": 65,
              "style": { "stroke": "#fbbf24", "fontSize": 24 }
            },
            {
              "type": "node", "id": "gateway", "text": "VPN / ExpressRoute\nGateway", "icon": "network",
              "x": 30, "y": 235, "width": 260, "height": 75,
              "style": { "fontSize": 23 }
            }
          ]
        },
        {
          "type": "group", "id": "devA", "title": "Nonprod A | Spoke VNet",
          "x": 30, "y": 400, "width": 340, "height": 210,
          "style": { "fill": "surface", "stroke": "#a78bfa", "fontSize": 22 },
          "children": [
            {
              "type": "group", "id": "devASubnet", "title": "Resource subnet",
              "x": 20, "y": 55, "width": 300, "height": 135,
              "layout": { "type": "row", "gap": 12, "padding": 16 },
              "style": { "fill": "bg", "stroke": "border", "fontSize": 21 },
              "children": [
                { "type": "node", "id": "devAVm1", "text": "VM 1", "icon": "server", "style": { "fontSize": 20 } },
                { "type": "node", "id": "devAVm2", "text": "VM 2", "icon": "server", "style": { "fontSize": 20 } },
                { "type": "node", "id": "devAVm3", "text": "VM 3", "icon": "server", "style": { "fontSize": 20 } }
              ]
            }
          ]
        },
        {
          "type": "group", "id": "devB", "title": "Nonprod B | Spoke VNet",
          "x": 910, "y": 400, "width": 340, "height": 210,
          "style": { "fill": "surface", "stroke": "#a78bfa", "fontSize": 22 },
          "children": [
            {
              "type": "group", "id": "devBSubnet", "title": "Resource subnet",
              "x": 20, "y": 55, "width": 300, "height": 135,
              "layout": { "type": "row", "gap": 12, "padding": 16 },
              "style": { "fill": "bg", "stroke": "border", "fontSize": 21 },
              "children": [
                { "type": "node", "id": "devBVm1", "text": "VM 1", "icon": "server", "style": { "fontSize": 20 } },
                { "type": "node", "id": "devBVm2", "text": "VM 2", "icon": "server", "style": { "fontSize": 20 } },
                { "type": "node", "id": "devBVm3", "text": "VM 3", "icon": "server", "style": { "fontSize": 20 } }
              ]
            }
          ]
        }
      ]
    },
    {
      "type": "node", "id": "monitor", "text": "Azure Monitor\nHub diagnostics", "icon": "analytics",
      "x": 20, "y": 80, "width": 210, "height": 110,
      "style": { "fontSize": 24 }
    },
    {
      "type": "group", "id": "onPrem", "title": "On-premises",
      "x": 20, "y": 280, "width": 210, "height": 200,
      "style": { "fontSize": 24 },
      "children": [
        {
          "type": "node", "id": "siteGateway", "text": "Network\nVPN / ER", "icon": "network",
          "x": 20, "y": 55, "width": 170, "height": 115,
          "style": { "fontSize": 24 }
        }
      ]
    },
    {
      "type": "connector", "from": "prodA", "to": "hub",
      "fromPort": "right", "toPort": "top", "routing": "orthogonal",
      "arrow": false, "ariaLabel": "Bidirectional VNet peering between Production A and Hub",
      "style": { "stroke": "#60a5fa", "strokeWidth": 3, "dash": "9 6" }
    },
    {
      "type": "connector", "from": "prodB", "to": "hub",
      "fromPort": "left", "toPort": "right", "routing": "orthogonal",
      "arrow": false, "ariaLabel": "Bidirectional VNet peering between Production B and Hub",
      "style": { "stroke": "#60a5fa", "strokeWidth": 3, "dash": "9 6" }
    },
    {
      "type": "connector", "from": "devA", "to": "hub",
      "fromPort": "right", "toPort": "bottom", "routing": "orthogonal",
      "arrow": false, "ariaLabel": "Bidirectional VNet peering between Nonproduction A and Hub",
      "style": { "stroke": "#60a5fa", "strokeWidth": 3, "dash": "9 6" }
    },
    {
      "type": "connector", "from": "devB", "to": "hub",
      "fromPort": "left", "toPort": "right", "routing": "orthogonal",
      "arrow": false, "ariaLabel": "Bidirectional VNet peering between Nonproduction B and Hub",
      "style": { "stroke": "#60a5fa", "strokeWidth": 3, "dash": "9 6" }
    },
    {
      "type": "connector", "from": "devA", "to": "devB",
      "fromPort": "bottom", "toPort": "bottom", "routing": "polyline",
      "points": [{ "x": 480, "y": 690 }, { "x": 1360, "y": 690 }],
      "arrow": false, "ariaLabel": "Optional direct peering or Virtual Network Manager connected group between nonproduction spokes",
      "style": { "stroke": "#a78bfa", "strokeWidth": 3, "dash": "2 6" }
    },
    {
      "type": "connector", "from": "siteGateway", "to": "gateway",
      "fromPort": "right", "toPort": "left", "routing": "polyline",
      "points": [{ "x": 260, "y": 392.5 }, { "x": 745, "y": 392.5 }, { "x": 745, "y": 472.5 }],
      "label": "VPN / ExpressRoute", "arrow": false,
      "style": { "stroke": "#fbbf24", "strokeWidth": 3, "fontSize": 23 }
    },
    {
      "type": "connector", "from": "hub", "to": "monitor",
      "fromPort": "left", "toPort": "right", "routing": "polyline",
      "points": [{ "x": 700, "y": 365 }, { "x": 700, "y": 60 }, { "x": 300, "y": 60 }, { "x": 300, "y": 135 }],
      "arrow": true, "ariaLabel": "Hub resource diagnostic settings send logs and metrics to Azure Monitor, not a traffic-routing hop",
      "style": { "stroke": "#34d399", "strokeWidth": 3, "dash": "2 6" }
    },
    {
      "type": "node", "id": "legend",
      "x": 280, "y": 730, "width": 1290, "height": 40,
      "text": "Blue dashed: peering  |  Violet dotted: optional direct connection  |  Green dotted: diagnostics",
      "style": { "fill": "transparent", "stroke": "transparent", "fontSize": 23 }
    }
  ]
}
```

<!--
Conceptual connectivity, not packet flow. Unarrowed links denote connections that support both directions, subject to configuration.
Peering is non-transitive. Routes, forwarded-traffic settings, gateway transit, NSGs, and firewall policies must be configured separately.
The hub service subnets, workload routing, public IPs, and DNS are omitted for clarity.
Azure Virtual Network Manager is an optional management service, not a VNet or traffic-routing hop.
Generic built-in icons are used, not the official Azure product icons.
Reference: https://learn.microsoft.com/azure/architecture/networking/architecture/hub-spoke
-->

---

## Connectivity is not a traffic route

```architecture
{
  "version": 1,
  "title": "Spoke internet egress through a hub firewall",
  "description": "A separate conceptual traffic view: each production subnet has a user-defined default route to the hub firewall private IP. Forward traffic crosses configured VNet peering to Azure Firewall and then reaches the internet. Only the outbound direction is drawn; return routing and policies are required. This is centralized internet egress, not Azure Firewall forced tunneling to on-premises.",
  "canvas": { "width": 1500, "height": 510 },
  "elements": [
    {
      "type": "group", "id": "spokeOne", "title": "Production A | Spoke VNet",
      "x": 20, "y": 25, "width": 400, "height": 190,
      "style": { "stroke": "#60a5fa", "fontSize": 26 },
      "children": [
        {
          "type": "node", "id": "routeOne", "text": "Resource subnet\nUDR: 0.0.0.0/0\nNext hop: Firewall private IP", "icon": "server",
          "x": 25, "y": 55, "width": 350, "height": 110,
          "style": { "fontSize": 23 }
        }
      ]
    },
    {
      "type": "group", "id": "spokeTwo", "title": "Production B | Spoke VNet",
      "x": 20, "y": 285, "width": 400, "height": 190,
      "style": { "stroke": "#60a5fa", "fontSize": 26 },
      "children": [
        {
          "type": "node", "id": "routeTwo", "text": "Resource subnet\nUDR: 0.0.0.0/0\nNext hop: Firewall private IP", "icon": "server",
          "x": 25, "y": 55, "width": 350, "height": 110,
          "style": { "fontSize": 23 }
        }
      ]
    },
    {
      "type": "group", "id": "egressHub", "title": "Hub VNet",
      "x": 730, "y": 150, "width": 360, "height": 210,
      "style": { "stroke": "#fbbf24", "fontSize": 26 },
      "children": [
        {
          "type": "node", "id": "egressFirewall", "text": "Azure Firewall\nInspect + allow / deny", "icon": "shield",
          "x": 25, "y": 65, "width": 310, "height": 110,
          "style": { "stroke": "#fbbf24", "fontSize": 24 }
        }
      ]
    },
    {
      "type": "node", "id": "internet", "text": "Internet", "icon": "cloud",
      "x": 1280, "y": 215, "width": 200, "height": 110,
      "style": { "fontSize": 26 }
    },
    {
      "type": "connector", "from": "routeOne", "to": "egressFirewall",
      "fromPort": "right", "toPort": "top", "routing": "polyline",
      "points": [{ "x": 600, "y": 135 }, { "x": 910, "y": 135 }],
      "label": "Via VNet peering", "arrow": true,
      "style": { "stroke": "#fbbf24", "strokeWidth": 4, "fontSize": 24 }
    },
    {
      "type": "connector", "from": "routeTwo", "to": "egressFirewall",
      "fromPort": "right", "toPort": "bottom", "routing": "polyline",
      "points": [{ "x": 600, "y": 395 }, { "x": 910, "y": 395 }],
      "label": "Via VNet peering", "arrow": true,
      "style": { "stroke": "#fbbf24", "strokeWidth": 4, "fontSize": 24 }
    },
    {
      "type": "connector", "from": "egressFirewall", "to": "internet",
      "fromPort": "right", "toPort": "left", "routing": "straight",
      "label": "Egress", "arrow": true,
      "style": { "stroke": "#fbbf24", "strokeWidth": 4, "fontSize": 24 }
    }
  ]
}
```

Peering is non-transitive. UDRs, peering settings, return routes, and security policies are separate configuration.

<!--
This view illustrates centralized internet egress only. Azure Firewall forced tunneling to on-premises is a different configuration.
The Architecture DSL expresses the diagram, not Azure route computation or deployable infrastructure.
-->

---

## What this demonstrates

- **Nested groups:** management scope > VNet > subnet > VM.
- **Mixed layout:** fixed network positions with automatic VM rows.
- **Explicit connectors:** ports, waypoint routing, arrows, and line styles.
- **Portable source:** Markdown + JSON; no external images or runtime changes.

For documentation, use a rendered overview image linked to this source. GitHub does not render `architecture` fences.

<!--
Feasibility: this topology fits the existing v1 grammar without implementation changes.
Trade-offs: manual waypoints require maintenance after moving networks; nested groups have a four-level limit; connector labels may shrink or be omitted when space is insufficient.
Built-in icons are generic. Official Azure artwork can be supplied as separately licensed assets and referenced with node.icon.
For README, prefer the overview image and a source link. For the user guide, explain group-relative coordinates, fixed versus row layout, connection versus traffic semantics, and the targeted capture workflow.
Reference: https://learn.microsoft.com/azure/architecture/networking/architecture/hub-spoke
-->
