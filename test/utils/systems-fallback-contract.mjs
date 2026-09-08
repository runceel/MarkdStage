import assert from "node:assert/strict";
import { posix } from "node:path";

// Runs in the renderer. Identities come from the six pinned systems fixtures,
// never from the mask attributes whose selection/ownership we are testing.
export function systemsIsolationContract() {
  const decks = [...document.querySelectorAll(".deck")];
  const roots = decks.slice(1, 7).map((deck) => deck.querySelector("pre.mermaid > svg"));
  const require = (value, message) => { if (!value) throw new Error(message); return value; };
  const one = (root, selector) => {
    const elements = [...root.querySelectorAll(selector)];
    require(elements.length === 1, `fixture identity: ${selector} (${elements.length})`);
    return elements[0];
  };
  const group = (label) => require([...roots[1].querySelectorAll("g.person-man")]
    .find((element) => element.textContent.includes(label)), `fixture group: ${label}`);
  const paths = (label) => {
    const elements = [...group(label).querySelectorAll(":scope > path")];
    require(elements.length === 2, `fixture paths: ${label}`);
    return elements;
  };
  const [dbBody, dbRim] = paths("Database");
  const [queueBody, queueTail] = paths("Queue");
  const specs = [
    ["c4-person", 2, one(roots[1], "g.person-man > image")],
    ["c4-database-body", 2, dbBody],
    ["c4-database-rim", 2, dbRim],
    ["c4-queue-body", 2, queueBody],
    ["c4-queue-tail", 2, queueTail],
    ["architecture-database", 4, one(roots[3], ".architecture-service[id$='-service-db'] svg")],
    ["architecture-server", 4, one(roots[3], ".architecture-service[id$='-service-api'] svg")],
    ["architecture-cloud", 4, one(roots[3], ".architecture-groups svg")],
    ["eventmodeling-html", 6, one(roots[5], "foreignObject:has(u)")],
  ];
  require(/入力\s*\/\s*Input/.test(specs[8][2].textContent) && specs[8][2].querySelector("u"),
    `fixture HTML content: ${specs[8][2].textContent}`);
  const all = (element) => [element, ...element.querySelectorAll("*")];
  const geometry = (element, deck) => {
    const box = element.getBoundingClientRect(), origin = deck.getBoundingClientRect();
    const matrix = element.getScreenCTM?.();
    return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height,
      matrix: matrix && [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] };
  };
  const content = (element) => {
    const clone = element.cloneNode(true);
    for (const part of all(clone)) {
      part.removeAttribute("data-pptx-native");
      part.removeAttribute("data-pptx-fallback-ids");
      part.classList.remove("pptx-fallback-hidden");
      if (!part.getAttribute("class")) part.removeAttribute("class");
    }
    return clone.outerHTML;
  };
  const visible = (element) => {
    if (!element.isConnected || ["hidden", "collapse"].includes(getComputedStyle(element).visibility)) return false;
    for (let part = element; part; part = part.parentElement) {
      const css = getComputedStyle(part);
      if (css.display === "none" || Number(css.opacity) === 0) return false;
    }
    return !element.closest("defs,marker,symbol,clipPath,mask,pattern");
  };
  const color = (value) => value && value !== "none" && value !== "transparent" &&
    !/rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(value);
  const paint = (element) => {
    if (!visible(element)) return [];
    const css = getComputedStyle(element), result = [];
    const add = (key, enabled = true) => { if (enabled && color(css[key])) result.push([key, css[key]]); };
    const tag = element.localName;
    if (["rect", "image", "foreignObject"].includes(tag) &&
        (!(element.width.baseVal.value > 0) || !(element.height.baseVal.value > 0))) return [];
    if (/^(path|line|rect|circle|ellipse|polygon|polyline|text|tspan)$/.test(tag)) {
      add("fill", tag !== "line" && Number(css.fillOpacity) > 0);
      add("stroke", Number.parseFloat(css.strokeWidth) > 0 && Number(css.strokeOpacity) > 0);
      for (const key of ["markerStart", "markerMid", "markerEnd"]) add(key);
      if (["text", "tspan"].includes(tag)) add("textDecorationColor", css.textDecorationLine !== "none");
    }
    if (element.namespaceURI !== "http://www.w3.org/2000/svg") {
      add("backgroundColor");
      for (const side of ["Top", "Right", "Bottom", "Left"]) {
        add(`border${side}Color`, Number.parseFloat(css[`border${side}Width`]) > 0 &&
          !["none", "hidden"].includes(css[`border${side}Style`]));
      }
      if ([...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) {
        add("webkitTextFillColor");
      }
      add("textDecorationColor", css.textDecorationLine !== "none");
    }
    if (["image", "img"].includes(tag)) result.push(["image", element.getAttribute("href") ||
      element.getAttribute("xlink:href") || element.getAttribute("src")]);
    return result;
  };
  const appearance = (element) => {
    const css = getComputedStyle(element);
    return { paint: paint(element), properties: ["fillOpacity", "strokeOpacity", "strokeWidth",
      "strokeDasharray", "strokeLinecap", "strokeLinejoin", "strokeMiterlimit", "filter", "clipPath",
      "maskImage", "mixBlendMode", "textDecorationLine"].map((key) => [key, css[key]]),
    ancestors: (() => {
      const result = [];
      for (let part = element; part; part = part.parentElement) {
        const style = getComputedStyle(part);
        result.push([style.opacity, style.display, style.filter, style.clipPath, style.maskImage]);
      }
      return result;
    })() };
  };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const entries = specs.map(([id, slideIndex, target]) => {
    const deck = decks[slideIndex], box = geometry(target, deck);
    const scale = target.getScreenCTM().a;
    // These fixtures use uniform scaling, .5px C4 strokes, and no markers on
    // fallback paths. Their crops include one transformed unit around a path.
    const padding = target.localName === "path" ? scale : 0;
    const crop = { x: box.x - padding, y: box.y - padding,
      width: box.width + padding * 2, height: box.height + padding * 2 };
    const parts = all(target);
    require(parts.some((part) => paint(part).length), `fixture has no paint: ${id}`);
    const fallbacks = window.__presentationPptxModel.slides[slideIndex].fallbacks;
    const localIndex = specs.filter((spec) => spec[1] === slideIndex).findIndex((spec) => spec[0] === id);
    const fallbackIndex = fallbacks.map((fallback, index) => ({ fallback, index }))
      .filter(({ fallback }) => fallback.type === "mermaid")[localIndex]?.index;
    require(Number.isInteger(fallbackIndex), `missing model fallback: ${id}`);
    return { id, slideIndex, target, deck, fallbackIndex, crop, parts,
      content: content(target), geometry: parts.map((part) => geometry(part, deck)),
      appearance: parts.map(appearance) };
  });
  const native = roots.flatMap((root) => [...root.querySelectorAll(
    "path,line,rect,circle,ellipse,polygon,polyline,text,tspan,image,foreignObject,foreignObject *")]
    .filter((part) => !part.closest("defs,marker,symbol,clipPath,mask,pattern") &&
      !entries.some(({ target }) => target.contains(part))));
  require(native.length > 50, "fixture native neighbors missing");
  const inspect = (index) => {
    const expected = entries[index], errors = [];
    const fail = (code, detail) => errors.push(`${code}: ${detail}`);
    for (const [currentIndex, entry] of entries.entries()) {
      const { target, id, slideIndex, fallbackIndex } = entry;
      const fallback = window.__presentationPptxModel.slides[slideIndex].fallbacks[fallbackIndex];
      const owners = [...document.querySelectorAll("[data-pptx-fallback-ids]")].filter((part) =>
        part.getAttribute("data-pptx-fallback-ids").split(/\s+/).includes(fallback.captureId));
      if (owners.length !== 1 || owners[0] !== target ||
          target.closest("[data-pptx-native]") || target.querySelector("[data-pptx-native]")) fail("ownership", id);
      if (!target.isConnected || content(target) !== entry.content) fail("content", id);
      if (!equal(all(target).map((part) => geometry(part, entry.deck)), entry.geometry)) fail("geometry", id);
      for (const key of ["x", "y", "width", "height"]) {
        // The existing scene contract stores geometry to one decimal place.
        if (!Number.isFinite(fallback[key]) || Math.abs(fallback[key] - entry.crop[key]) > .11) fail("crop", `${id} ${key}`);
      }
      if (currentIndex === index) {
        if (!entry.parts.some((part) => paint(part).length)) fail("missing-artwork", id);
        if (!equal(entry.parts.map(appearance), entry.appearance)) fail("target-paint", id);
      } else if (entry.parts.some((part) => paint(part).length || visible(part))) {
        fail("other-artwork", id);
      }
    }
    for (const part of native) {
      if (paint(part).length) fail("native-paint", `${part.outerHTML.slice(0, 200)} ${JSON.stringify(paint(part))}`);
    }
    return { id: expected.id, slideIndex: expected.slideIndex, fallbackIndex: expected.fallbackIndex, errors };
  };
  return { entries, inspect, manifest: entries.map(({ id, slideIndex, fallbackIndex, crop }) =>
    ({ id, slideIndex, fallbackIndex, crop })) };
}

// The writer uses stored ZIP members. Read the actual relationship and picture
// parts instead of searching for PNG bytes anywhere in the archive.
export function readSystemsPackage(buffer) {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    assert.equal(buffer.readUInt16LE(cursor + 10), 0);
    const size = buffer.readUInt32LE(cursor + 24), nameLength = buffer.readUInt16LE(cursor + 28);
    const local = buffer.readUInt32LE(cursor + 42);
    assert.equal(buffer.readUInt32LE(local), 0x04034b50);
    assert.equal(buffer.readUInt16LE(local + 8), 0);
    const offset = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    assert.ok(!files.has(name), `duplicate member ${name}`);
    files.set(name, Buffer.from(buffer.subarray(offset, offset + size)));
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  assert.equal(cursor, end);
  return files;
}

export function assertSystemsPackage(files, model, captures) {
  const associations = [];
  for (let slideIndex = 1; slideIndex <= 6; slideIndex++) {
    const slide = model.slides[slideIndex];
    const xml = files.get(`ppt/slides/slide${slideIndex + 1}.xml`).toString("utf8");
    const relsName = `ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`;
    const rels = files.get(relsName).toString("utf8");
    const objects = [...xml.matchAll(/<p:(sp|pic|cxnSp)>[\s\S]*?<\/p:\1>/g)];
    const expected = [...slide.elements, ...slide.fallbacks.filter((fallback) => fallback.artwork !== false)]
      .sort((a, b) => a.zOrder - b.zOrder).flatMap((element) => Array(
        slide.fallbacks.includes(element) ? 1 : element.points ? element.points.length - 1 : 1).fill(element));
    assert.deepEqual(objects.map((object) => object[1]),
      expected.map((element) => slide.fallbacks.includes(element) ? "pic" : "sp"), "native/fallback paint order");
    for (const capture of captures[slideIndex]) {
      const fallback = slide.fallbacks[capture.fallbackIndex];
      if (fallback.type !== "mermaid") continue;
      assert.ok(!slide.elements.some((element) => element.path === fallback.path), "exclusive native/fallback ownership");
      const picture = objects[expected.indexOf(fallback)][0];
      const relationship = picture.match(/<a:blip r:embed="([^"]+)"/)?.[1];
      assert.ok(relationship, "picture relationship");
      const matches = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map((match) => match[0])
        .filter((relation) => relation.includes(`Id="${relationship}"`));
      assert.equal(matches.length, 1, "exactly one picture relationship");
      assert.match(matches[0], /Type="[^"]*\/image"/);
      const target = matches[0].match(/Target="([^"]+)"/)[1];
      const media = posix.normalize(posix.join("ppt/slides", target));
      assert.ok(files.get(media)?.equals(capture.data), `captured media integrity: ${slideIndex}:${capture.fallbackIndex}`);
      assert.equal([...files].filter(([name, data]) => name.startsWith("ppt/media/") && data.equals(capture.data)).length,
        1, "exactly-once media embedding");
      assert.equal(objects.filter((object) => object[0].includes(`r:embed="${relationship}"`)).length,
        1, "exactly-once picture association");
      assert.ok(picture.includes(`<a:off x="${Math.round(capture.x * 9525)}" y="${Math.round(capture.y * 9525)}"/>`),
        "picture position");
      assert.ok(picture.includes(`<a:ext cx="${Math.round(capture.width * 9525)}" cy="${Math.round(capture.height * 9525)}"/>`),
        "picture extent");
      associations.push({ slideIndex, fallbackIndex: capture.fallbackIndex, relsName, relationship, target, media });
    }
  }
  assert.equal(associations.length, 9, "all nine local images");
  assert.equal(new Set(associations.map(({ media }) => media)).size, 9, "distinct artwork associations");
  return associations;
}
