export const ARCHITECTURE_FONT_ROLES = ["node", "group", "connector"];
export const AUTHORED_FONT = "Courier New";
export const FONT_TEST_THEME_CSS = "--ms-font:Arial,sans-serif;";

export function architectureFontSlide(role) {
  const elements = ["Authored", "Themed"].map((label, index) => {
    const common = {
      type: role,
      style: { fontSize: 32, fontWeight: 400, ...(index === 0 ? { fontFamily: AUTHORED_FONT } : {}) },
    };
    const y = 70 + index * 220;
    if (role === "connector") {
      return { ...common, from: { x: 100, y }, to: { x: 900, y }, label: `${label} connector` };
    }
    if (role === "node") {
      return { ...common, id: label.toLowerCase(), text: `${label} node` };
    }
    return {
      ...common, id: label.toLowerCase(), x: 100, y, width: 800, height: 150,
      ...(role === "group" ? { title: `${label} group` } : { text: `${label} node` }),
    };
  });
  return [
    `## ${role} font families`,
    "```architecture",
    JSON.stringify({
      version: 1, canvas: { width: 1000, height: 500 },
      elements: role === "node" ? [{
        type: "group", id: "weighted-grid", x: 230, y: 100, width: 540, height: 260,
        layout: { type: "grid", columns: 2, columnWidths: [1, 2], padding: 20, columnGap: 20 },
        children: elements,
      }] : elements,
    }),
    "```",
  ].join("\n");
}
