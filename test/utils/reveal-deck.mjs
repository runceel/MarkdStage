const block = "<!-- markdstage: reveal=block -->";

export const BLOCK_REVEAL_SLIDES = [
  [
    "## Explain, then illustrate",
    "",
    "This introduction is visible from the start.",
    "",
    "<!-- markdstage: reveal=list-items nested=together -->",
    "",
    "- First",
    "- Second",
    "",
    block,
    "",
    "This conclusion appears after the list.",
    "",
    block,
    "",
    "```architecture",
    JSON.stringify({
      version: 1,
      canvas: { width: 800, height: 250 },
      elements: [
        { type: "node", id: "client", x: 40, y: 60, width: 180, height: 100, text: "Client", icon: "browser" },
        { type: "node", id: "api", x: 550, y: 60, width: 180, height: 100, text: "API", icon: "api" },
        { type: "connector", id: "request", from: "client", to: "api", label: "request", arrow: true },
      ],
    }),
    "```",
  ].join("\n"),
  `## Image\n\n${block}\n\n![Image](/assets/sample.svg)`,
  `## Table\n\n${block}\n\n| Name | Value |\n| --- | --- |\n| A | B |`,
  `## Code\n\n${block}\n\n\`\`\`js\nconst answer = 42;\nconsole.log(answer);\n\`\`\``,
  `## Mermaid\n\n${block}\n\n\`\`\`mermaid\nflowchart LR\nA[Client] --> B[API]\n\`\`\``,
  `## Entire list\n\n${block}\n\n1. Parent\n   - Child\n2. Next`,
];
