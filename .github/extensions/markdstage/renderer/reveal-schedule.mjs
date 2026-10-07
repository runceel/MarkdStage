const FENCE_OPEN = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*([^\s`~]*)[ \t]*$/;

function sourceLine(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function revealComment(token) {
  if (token?.type !== "html" || !/^\s*<!--[\s\S]*?-->\s*$/.test(token.raw || "")) {
    return null;
  }
  const comment = token.raw.trim().slice(4, -3).trim();
  if (!/^markdstage\s*:/i.test(comment)) return null;
  const value = comment.replace(/^markdstage\s*:\s*/i, "").trim();
  const list = /^reveal\s*=\s*list-items(?:\s+nested\s*=\s*([^\s]+))?\s*$/i.exec(value);
  if (list) {
    const nested = (list[1] || "together").toLowerCase();
    if (nested !== "together" && nested !== "separate") {
      throw new Error(`MarkdStage reveal at line ${token.__line}: nested must be "together" or "separate".`);
    }
    return { kind: "list", nested };
  }
  const json = /^([\s\S]*)$/.exec(value)?.[1] || "";
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error(`Malformed MarkdStage reveal metadata at line ${token.__line}; expected a list-items directive or JSON steps object.`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some((key) => key !== "steps") ||
      !Array.isArray(data.steps) || data.steps.length === 0 ||
      !data.steps.every((step) => Array.isArray(step) && step.length > 0 &&
        step.every((id) => typeof id === "string" && id.trim()))) {
    throw new Error(`Invalid Architecture reveal at line ${token.__line}; use {"steps":[["element-id"],["another-id"]]} with non-empty target groups.`);
  }
  return { kind: "architecture", steps: data.steps.map((step) => step.map((id) => id.trim())) };
}

function listRecords(list, listIndex) {
  const records = [];
  const visitList = (current, parentTopLevelIndex = null) => {
    current.items.forEach((item, itemIndex) => {
      const containsImage = (tokens) => (tokens || []).some((token) =>
        token.type === "image" ||
        containsImage(token.tokens) ||
        token.type === "list" && token.items.some((nested) => containsImage(nested.tokens)),
      );
      if (containsImage(item.tokens)) {
        throw new Error("MarkdStage list reveals do not support list items containing images; move the image outside the revealed list.");
      }
      const topLevelIndex = parentTopLevelIndex ?? itemIndex;
      const record = { index: records.length, topLevelIndex, item };
      records.push(record);
      for (const child of item.tokens || []) {
        if (child.type === "list") visitList(child, topLevelIndex);
      }
    });
  };
  visitList(list);
  if (records.some(({ item }) => !String(item.text || "").trim())) {
    throw new Error("MarkdStage list reveals do not support empty list items; add item text or remove the empty item.");
  }
  return records;
}

function validateDiagramTargets(token, directive, line) {
  let diagram;
  try {
    diagram = JSON.parse(token.text);
  } catch {
    throw new Error(`Architecture reveal at line ${line} cannot be resolved because the following Architecture block is invalid JSON.`);
  }
  const ids = new Set();
  const elementsById = new Map();
  const parents = new Map();
  const visit = (elements, parent = null) => {
    for (const element of elements || []) {
      if (typeof element.id === "string") {
        if (ids.has(element.id)) throw new Error(`Architecture reveal at line ${line} cannot resolve duplicate id "${element.id}".`);
        ids.add(element.id);
        elementsById.set(element.id, element);
        if (parent) parents.set(element.id, parent);
      }
      if (element.type === "group") visit(element.children, element.id);
    }
  };
  visit(diagram.elements);
  const assigned = new Map();
  for (const [stepIndex, step] of directive.steps.entries()) {
    for (const id of step) {
      if (!ids.has(id)) throw new Error(`Unknown Architecture reveal target "${id}" at line ${line}; use an id from the following diagram.`);
      if (assigned.has(id)) throw new Error(`Architecture reveal target "${id}" is scheduled more than once at line ${line}.`);
      for (let parent = parents.get(id); parent; parent = parents.get(parent)) {
        if (assigned.has(parent)) throw new Error(`Architecture reveal targets "${parent}" and its descendant "${id}" overlap at line ${line}.`);
      }
      for (const [existing] of assigned) {
        for (let parent = parents.get(existing); parent; parent = parents.get(parent)) {
          if (parent === id) throw new Error(`Architecture reveal targets "${id}" and its descendant "${existing}" overlap at line ${line}.`);
        }
      }
      assigned.set(id, stepIndex);
    }
  }
  const descendants = (id, output = []) => {
    output.push(id);
    for (const child of elementsById.get(id)?.children || []) descendants(child.id, output);
    return output;
  };
  const steps = directive.steps.map((targets) =>
    new Set(targets.flatMap((id) => descendants(id))),
  );
  const stepFor = new Map();
  steps.forEach((targets, stepIndex) => {
    for (const id of targets) stepFor.set(id, stepIndex);
  });
  for (const [id, element] of elementsById) {
    if (element.type !== "connector") continue;
    const endpoints = [element.from, element.to].filter((value) => typeof value === "string");
    const endpointStep = Math.max(-1, ...endpoints.map((endpoint) => stepFor.get(endpoint) ?? -1));
    const connectorStep = stepFor.get(id);
    if (connectorStep !== undefined && endpoints.some((endpoint) => (stepFor.get(endpoint) ?? -1) > connectorStep)) {
      throw new Error(`Architecture connector "${id}" is scheduled before one of its endpoints at line ${line}.`);
    }
    if (connectorStep === undefined && endpointStep >= 0) {
      steps[endpointStep].add(id);
      stepFor.set(id, endpointStep);
    }
  }
  return steps.map((targets) => [...targets]);
}

/**
 * Parse block-bound reveal comments and compile a slide-local ordered schedule.
 * The pinned Marked lexer keeps fenced comment examples out of HTML tokens.
 */
export function parseRevealSchedule(markdown, markedApi) {
  if (!markedApi || typeof markedApi.lexer !== "function") {
    throw new TypeError("A Marked lexer is required to parse reveal directives.");
  }
  const source = String(markdown ?? "").replace(/\r\n?/g, "\n");
  const tokens = markedApi.lexer(source, { gfm: true, breaks: false });
  const lists = [];
  const listOrder = [];
  const listParents = [];
  const architectures = [];
  const schedule = [];
  let cursor = 0;

  const walk = (entries, parentListIndex = null) => {
    let pending = null;
    for (const token of entries) {
      const bindsList = pending?.kind === "list" && token.type === "list";
      const start = source.indexOf(token.raw || "", cursor);
      const offset = start < 0 ? cursor : start;
      token.__line = sourceLine(source, offset);
      cursor = Math.max(cursor, offset) + (token.raw || "").length;
      if (token.type === "html" && /^\s*<!--[\s\S]*?-->\s*$/.test(token.raw || "")) {
        const directive = revealComment(token);
        if (directive) {
          if (pending) throw new Error(`Unexpected second MarkdStage reveal directive at line ${token.__line}.`);
          pending = { ...directive, line: token.__line };
        } else if (/<!--\s*markdstage\b/i.test(token.raw || "")) {
          throw new Error(`Malformed MarkdStage directive at line ${token.__line}.`);
        }
        continue;
      }
      if (token.type === "space") continue;
      if (pending) {
        if (pending.kind === "list" && token.type === "list") {
          const listIndex = listOrder.length;
          for (let parent = parentListIndex; parent !== null; parent = listParents[parent] ?? null) {
            if (lists.some((entry) => entry.listIndex === parent)) {
              throw new Error(`Nested list reveal at line ${pending.line} overlaps a previously scheduled ancestor list.`);
            }
          }
          const records = listRecords(token, listIndex);
          const groups = pending.nested === "together"
            ? [...new Set(records.map((record) => record.topLevelIndex))]
                .map((topLevelIndex) => records.filter((record) => record.topLevelIndex === topLevelIndex).map((record) => record.index))
            : records.map((record) => [record.index]);
          const reveal = { kind: "list", listIndex, nested: pending.nested, steps: groups };
          lists.push(reveal);
          listOrder[listIndex] = reveal;
          listParents[listIndex] = parentListIndex;
          groups.forEach((targets) => schedule.push({ kind: "list", listIndex, targets }));
        } else if (pending.kind === "architecture" && token.type === "code" &&
            token.lang?.trim().split(/\s+/)[0].toLowerCase() === "architecture") {
          const blockIndex = architectures.length;
          const steps = validateDiagramTargets(token, pending, pending.line);
          const reveal = { kind: "architecture", blockIndex, steps };
          architectures.push(reveal);
          steps.forEach((targets) => schedule.push({ kind: "architecture", blockIndex, targets }));
        } else {
          const target = pending.kind === "list" ? "a Markdown list" : "an Architecture code block";
          throw new Error(`MarkdStage reveal at line ${pending.line} must be followed immediately by ${target}.`);
        }
        pending = null;
      }
      if (token.type === "list") {
        // Nested lists are visited in source order for stable DOM list indexes.
        const listIndex = bindsList ? listOrder.length - 1 : listOrder.length;
        if (!bindsList) {
          listOrder.push(null);
          listParents[listIndex] = parentListIndex;
        }
        for (const item of token.items || []) walk(item.tokens || [], listIndex);
      } else if (Array.isArray(token.tokens)) {
        walk(token.tokens);
      }
    }
    if (pending) throw new Error(`MarkdStage reveal at line ${pending.line} has no following target.`);
  };

  walk(tokens);
  return { lists, listCount: listOrder.length, architectures, schedule };
}

export function revealCommentLines(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const reserved = new Set();
  let fence = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      const close = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[2][0] === fence[0] && close[2].length >= fence.length) fence = "";
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = open[2];
      continue;
    }
    if (!/^[ \t]{0,3}<!--\s*markdstage\b/i.test(line)) continue;
    for (let end = index; end < lines.length; end += 1) {
      reserved.add(end);
      if (lines[end].includes("-->")) {
        index = end;
        break;
      }
    }
  }
  return reserved;
}
