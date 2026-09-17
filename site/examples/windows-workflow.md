---
deck: Sample service review
theme: light
layout: title
---

# Sample service review

A local example for the MarkdStage Windows walkthrough.

<!--
Introduce the review objective and the Browser, API, and Database components.
-->

---

## Review objective

- Explain a small service to a technical audience.
- Check the request path and each component's role.
- Keep the source, diagrams, and speaker notes in Markdown.

<!--
Introduce the three components before showing the diagram.
-->

---

## Request path

```architecture
{
  "version": 1,
  "title": "Sample request path",
  "description": "A browser sends a request to an API, which reads from a database.",
  "canvas": { "width": 1200, "height": 460 },
  "elements": [
    {
      "type": "node",
      "id": "browser",
      "x": 60, "y": 140, "width": 260, "height": 160,
      "text": "Browser",
      "icon": "browser",
      "style": { "fontSize": 28 }
    },
    {
      "type": "node",
      "id": "api",
      "x": 470, "y": 140, "width": 260, "height": 160,
      "text": "API",
      "icon": "api",
      "style": { "fontSize": 28 }
    },
    {
      "type": "node",
      "id": "database",
      "x": 880, "y": 140, "width": 260, "height": 160,
      "text": "Database",
      "icon": "database",
      "style": { "fontSize": 28 }
    },
    {
      "type": "connector",
      "from": "browser", "to": "api",
      "fromPort": "right", "toPort": "left",
      "routing": "orthogonal",
      "label": "Request",
      "arrow": true
    },
    {
      "type": "connector",
      "from": "api", "to": "database",
      "fromPort": "right", "toPort": "left",
      "routing": "orthogonal",
      "label": "Read",
      "arrow": true
    }
  ]
}
```

<!--
Follow the request from left to right.
In Shape editing, select API, adjust its position, then Save.
Recheck the connector routing after the change.
-->

---

## Component responsibilities

| Component | Responsibility |
| --- | --- |
| Browser | Collect input and display the response |
| API | Validate the request and read the required data |
| Database | Store the example records |

<!--
Use these responsibilities to check whether the diagram tells the same story
as the text.
-->

---

## Review checklist

- Confirm the meaning of each connection.
- Check slide fit in the fixed 16:9 output preview.
- Read the speaker notes in presenter view.

<!--
Layout diagnostics find clipping, not factual mistakes.
Review both the Markdown and the rendered result.
-->

---

## Presentation and output

- Open the audience window from presenter view.
- Export PDF for reading or PowerPoint for further editing.
- Review every exported page before sharing.

<!--
Speaker notes are excluded from the audience window and PDF.
PowerPoint includes notes; review them before distributing that file.
-->
