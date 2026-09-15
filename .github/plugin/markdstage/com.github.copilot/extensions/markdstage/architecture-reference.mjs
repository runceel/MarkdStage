import { architectureContract } from "./renderer/architecture-contract.mjs";

const annotations = new Set(["$schema", "$id", "$anchor", "$comment", "title", "description", "examples"]);
const schemaMaps = new Set(["properties", "patternProperties", "dependentSchemas", "$defs"]);
const schemaArrays = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const schemaValues = new Set([
  "items", "contains", "additionalProperties", "unevaluatedProperties", "unevaluatedItems",
  "propertyNames", "not", "if", "then", "else", "contentSchema",
]);

function assertions(schema) {
  if (typeof schema === "boolean") return schema;
  return Object.fromEntries(Object.entries(schema)
    .filter(([key]) => !annotations.has(key))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => [
      key,
      schemaMaps.has(key)
        ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, assertions(value[name])]))
        : schemaArrays.has(key) ? value.map(assertions)
          : schemaValues.has(key) ? assertions(value) : value,
    ]));
}

const minimalExample = {
  version: 1,
  title: "Request path",
  canvas: { width: 1600, height: 900 },
  elements: [
    { type: "node", id: "client", x: 160, y: 300, width: 280, height: 140, text: "Client" },
    { type: "node", id: "api", x: 860, y: 300, width: 280, height: 140, text: "API" },
    { type: "connector", from: "client", to: "api", label: "HTTPS", arrow: true },
  ],
};

/**
 * A complete, bounded authoring reference, not a second list of permitted fields.
 * Names and constraints come from the generated contract; prose explains runtime semantics.
 */
export function architectureSchemaReference(contract = architectureContract) {
  const aliases = new Map();
  const used = new Set();
  for (const name of Object.keys(contract.definitions).sort((a, b) => a.length - b.length || (a < b ? -1 : 1))) {
    const signature = JSON.stringify(assertions(contract.definitions[name]));
    if (!aliases.has(signature)) aliases.set(signature, name);
  }
  function describe(schema, defining) {
    if (typeof schema === "boolean") return schema ? "any" : "never";
    const alias = aliases.get(JSON.stringify(assertions(schema)));
    if (alias && alias !== defining) {
      used.add(alias);
      return alias;
    }
    if (schema.$ref) {
      const name = schema.$ref.slice("#/$defs/".length).replace(/~1/g, "/").replace(/~0/g, "~");
      const definition = contract.definitions[name];
      if (!definition) throw new Error(`Unresolved reference in Architecture reference: ${schema.$ref}`);
      if (definition.properties?.type?.enum?.every((type) => contract.elements[type])) return "element";
      used.add(name);
      return name;
    }
    const parts = [];
    const rendered = new Set();
    if (Object.hasOwn(schema, "const")) {
      parts.push(JSON.stringify(schema.const));
      rendered.add("const");
    } else if (schema.enum) {
      parts.push(schema.enum.map((value) => JSON.stringify(value)).join("|"));
      rendered.add("enum");
    } else if (schema.type === "object" || schema.properties) {
      parts.push(`object{${propertyList(schema.properties ?? {})}}`);
      rendered.add("properties");
    } else if (schema.type === "array") {
      parts.push(schema.items ? `array<${describe(schema.items)}>` : "array");
      rendered.add("items");
    } else if (schema.type) {
      parts.push([schema.type].flat().join("|"));
    }
    rendered.add("type");
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      if (!schema[key]) continue;
      const operator = key === "allOf" ? " & " : key === "oneOf" ? " XOR " : " | ";
      parts.push(`(${schema[key].map((child) => describe(child)).join(operator)})`);
      rendered.add(key);
    }
    for (const [key, value] of Object.entries(schema)) {
      if (rendered.has(key) || annotations.has(key)) continue;
      parts.push(`${key}=${JSON.stringify(schemaValues.has(key) ? assertions(value) : value)}`);
    }
    return parts.join(" ");
  }
  function propertyList(properties) {
    return Object.entries(properties)
      .map(([name, schema]) => `${JSON.stringify(name)}: ${describe(schema)}`).join("; ");
  }
  const lines = [
    "# Architecture DSL v1 authoring reference",
    "",
    "Complete schema-derived fields; optional unless required below. Unknown fields are rejected at every level. Do not invent aliases or CSS.",
    "",
    "## Root",
    `Required: ${JSON.stringify(contract.root.required)}.`,
    propertyList(contract.root.properties),
    "",
    "## Element fields and requirements",
    "fixed = immediate parent has no layout (also root); flow = parent has layout. A group's OWN layout places children; it does NOT waive its fixed box requirements.",
    "",
  ];
  for (const [type, element] of Object.entries(contract.elements)) {
    const conditions = Object.fromEntries(["if", "then", "else", "allOf"]
      .filter((key) => Object.hasOwn(element, key)).map((key) => [key, element[key]]));
    lines.push(
      `### ${type}`,
      `Required fixed: ${JSON.stringify(element.required.fixed)}; flow: ${JSON.stringify(element.required.flow)}.`,
      propertyList(element.properties),
      ...(Object.keys(conditions).length ? [`Conditional constraints: ${describe(conditions)}.`] : []),
      "",
    );
  }
  lines.push("## Shared value schemas");
  // Definitions are discovered transitively from the property descriptors, not a curated list.
  for (const name of used) {
    lines.push(`- ${name}${name === "iconName" ? ' ("builtIn")' : ""}: ${describe(contract.definitions[name], name)}`);
  }
  lines.push(
    "",
    "## Authoring rules",
    'node text uses "text" (\\n separates lines); group headings use "title"; connector annotations use "label". Root "title" names the diagram accessibly. A connector has no "id".',
    "Schema conditional constraints restrict fields by routing/layout mode.",
    'Flow ignores x/y; optional dimensions must fit cells. Node "auto" dimensions resolve numerically without rewriting source. Grid columnWidths: positive ratios, one per column. node.icon: built-in or assets/ path; image.src: asset path, not URL. Only theme tokens adapt to themes.',
    'from/to: ID or {x,y} relative to containing group (canvas at root). Points do not follow referenced nodes. style.autoFit: "none" preserves font size; "shrink" may reduce it. textAlign/verticalAlign/padding place node text.',
    "",
    "## Runtime checks",
    "Beyond schema: parseArchitecture checks unique IDs, referenced endpoints, no self-links, flattened element/connector/text limits, depth and layout fit. Check assets and visual clipping separately. v1 runtime accepts ignored flow x/y and root $schema beyond the stricter authoring schema. Never resolve $schema.",
    "",
    "## Complete minimal example",
    "Two nodes and one connector; paste into an architecture fence:",
    "```architecture",
    JSON.stringify(minimalExample, null, 2),
    "```",
    "",
    "## Details",
    "Offline schema: schema/architecture-v1.schema.json. Layouts, examples and editing: markdstage_guide topic=architecture-dsl; this contract: topic=architecture-schema. schema/README.md covers schema/runtime differences and v1 compatibility.",
  );
  const reference = lines.join("\n");
  const bytes = new TextEncoder().encode(reference).byteLength;
  if (bytes > 8192) {
    throw new RangeError(`Architecture reference is ${bytes} UTF-8 bytes; the complete reference must fit within 8192 bytes.`);
  }
  return reference;
}
