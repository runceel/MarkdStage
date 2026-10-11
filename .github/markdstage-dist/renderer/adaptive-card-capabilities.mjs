import {
  adaptiveCardSchemaEnvelope, ADAPTIVE_CARDS_SDK_VERSION,
  ADAPTIVE_CARD_SCHEMA_VERSION, ADAPTIVE_CARD_HOST_CONFIG_VERSION,
} from "./adaptive-card-validation.mjs";

export const ADAPTIVE_CARD_CAPABILITY_REVISION = 1;

// These are presentation contracts, not validators or a replacement SDK schema.
// Every key is reconciled with the validator's envelope by the generator/tests.
const typeContracts = {
  AdaptiveCard: ["Pinned SDK layout; transparent owned HostConfig.", "native children; bounded raster error/safety panel when validation or correlation fails"],
  TextBlock: ["Sanitized Marked paragraphs, inline formatting and lists.", "native measured fragments; bounded raster for lists, RTL, fragmentation, ellipsis or clipping"],
  RichTextBlock: ["Typed TextRuns and string shorthand.", "native measured runs/highlights; bounded raster if their text is unrepresentable"],
  TextRun: ["Typed styling; underline overrides strike when both flags are true in SDK 3.0.6.", "native fragments and safe text-label links; same decoration precedence"],
  Container: ["Default/emphasis container and SDK child layout.", "native measured fill/children; shared opacity/filter context captured once as bounded raster"],
  ColumnSet: ["SDK auto/stretch/weighted/pixel column layout.", "native measured fills/children; no independent relayout"],
  Column: ["SDK column size, padding and child layout.", "native measured fills/children; local unrepresentable descendants remain bounded raster"],
  Image: ["Only approved immutable local/scoped/data bytes; failures show Image unavailable.", "native rectangular image; bounded raster for Person style or clipping"],
  ImageSet: ["SDK image sizing and wrapping; same asset gate for each image.", "native individual images subject to Image conditions"],
  FactSet: ["SDK aggregate FactSet region and sanitized field Markdown.", "native two-column LTR table only when nonempty fields correlate unambiguously to aggregate Ranges; otherwise bounded raster"],
  Table: ["SDK rows/cells/columns.", "native non-merged LTR grid only with one nonempty supported TextBlock per cell, measured grid-filling columns/rows, no highlight or clipping; otherwise bounded raster"],
  TableRow: ["Typed row within Table only.", "owned by native Table or its bounded raster; no separate row object"],
  TableCell: ["Typed container within TableRow only.", "owned by native Table; unsupported child layout rasterizes that Table"],
  "Input.Text": ["Static label and initial value/placeholder; password masks authored value.", "static approximation (editable text/fill where representable); no control"],
  "Input.Number": ["Static label and initial value/placeholder.", "static approximation; no input validation"],
  "Input.Date": ["Static label and resolved initial date/placeholder.", "static approximation; no date picker"],
  "Input.Time": ["Static label and initial time/placeholder.", "static approximation; no time picker"],
  "Input.Toggle": ["Static label/title and On/Off/authored value.", "static approximation; no toggle"],
  "Input.ChoiceSet": ["Static selected choice titles (unknown selections retain their value) or placeholder.", "static approximation; no selection control"],
  Media: ["Approved poster and static label only; sources never fetched.", "static approximation with editable approved image/text where representable; no player"],
  ActionSet: ["Owned vertical static action labels; no SDK interactions.", "static approximation; no executable actions"],
  "Action.OpenUrl": ["Non-clickable label; disabled/unsafe URLs retain label only.", "static approximation; approved HTTP(S)/mailto/tel text-label hyperlink only"],
  "Action.Submit": ["Static label, never collects or submits inputs/data.", "static approximation; no callback or submission"],
  "Action.Execute": ["Static label, never executes verb/data.", "static approximation; no callback or execution"],
  "Action.ShowCard": ["Collapsed static label; embedded tree validated, never displayed or fetched.", "static approximation; no expanded embedded content"],
  Fact: ["String title/value inside aggregate FactSet; no individual rendered element.", "part of correlated native FactSet table or its bounded raster"],
  Choice: ["Title/value used only to resolve static selected titles.", "part of static input approximation; unselected choices not displayed"],
  MediaSource: ["MIME/URL metadata validated; never fetched or played.", "static-media diagnostic; no source/media object"],
  TableColumnDefinition: ["SDK numeric weight or pixel width and cell alignment.", "native measured columns if the Table meets all representability conditions; otherwise bounded raster"],
};

const rule = (properties, browser, pptx) => ({ properties: properties.split(" "), browser, pptx });
export const ADAPTIVE_CARD_PROPERTY_CONTRACTS = [
  rule("type", "Explicit typed identity; unsupported types need authored fallback or error.", "Typed source identity retained in reports, never inferred from HTML."),
  rule("id", "Unique authored identity; DOM ids are intentionally stripped for isolation.", "Report uses authored JSON path; no interactive/DOM id contract."),
  rule("$schema", "Metadata only; never downloaded or used to choose another schema.", "No visible object."),
  rule("version", 'Authored root must be exactly "1.5"; nested cards may omit, but cannot specify another version.', "Other versions produce a bounded error panel, not a compatibility downgrade."),
  rule("requires", 'Only adaptiveCards at or below 1.5 or "*" succeeds. All entries validated before fallback.', "requires-not-met and substitution/drop diagnostics retain authored paths."),
  rule("fallback", 'Only unsupported types/unmet requires may use typed replacement or "drop"; fatal properties cannot be rescued.', "Replacement follows its own contract; omitted content has fallback-dropped, never a hidden success."),
  rule("body items columns rows cells images inlines facts", "Typed collections/records with the roles declared below; RichTextBlock also accepts string inlines.", "Ordered typed content; each child's type/representability contract applies."),
  rule("isVisible", "False is authored non-display, not an unsupported-feature drop.", "No native object/artwork for hidden content."),
  rule("spacing separator height minHeight bleed verticalContentAlignment horizontalAlignment", "Owned spacing/separator and SDK measured size/alignment; no slide-wide CSS inference.", "Native measured geometry/lines/fills; clipped text/images/tables use bounded raster."),
  rule("size weight color isSubtle fontType", "Owned font sizes/weights/palette: accent/good/warning/attention map to the primary/success/warning/danger semantic roles; other roles use fg, subtle uses muted.", "Native equivalent font/paint, not guaranteed pixel-identical Office text."),
  rule("style", "TextBlock default/heading; container default/emphasis/success/info/warning/danger; Image default/Person; static input/action exceptions below.", "Native supported styling; Image Person is bounded raster. Not a host preset."),
  rule("text", "TextBlock/Fact uses sanitized Markdown; TextRun is plain text.", "Native supported inline formatting; lists/RTL or uncorrelated text use bounded raster."),
  rule("wrap maxLines", "SDK wrapping/maxLines; authored clipping/ellipsis is retained.", "Native only when complete text can be measured; otherwise bounded raster (no Office rewrap)."),
  rule("italic underline strikethrough highlight", "Typed TextRun formatting. Underline replaces strike when both true; italic is independent.", "Native fragments/highlight rectangles; Markdown can independently retain both decorations."),
  rule("width", "Column: positive weight/auto/stretch/pixels. Image: pixels. Table column: positive weight/pixels.", "Native measured size, subject to Image/Table limits."),
  rule("url", "Image URLs must pass the asset gate; OpenUrl and MediaSource use their distinct exceptions below.", "Native approved image or placeholder; never an unvalidated second fetch."),
  rule("altText", "Image accessible description; Media also uses it in its static visible label.", "Image alt text retained; Media label is a static approximation."),
  rule("backgroundColor imageSize", "Image background and ImageSet small/medium/large sizes.", "Native fill/approved images subject to rectangular unclipped image contract."),
  rule("rtl", "SDK direction is honored, including inherited direction.", "RTL/bidirectional text and tables use explicit bounded raster; representable neighbors stay native."),
  rule("lang", "SDK language metadata; no date/time macros or templating.", "No independent PPTX language/locale behavior; measured visible text is preserved."),
  rule("firstRowAsHeaders showGridLines gridStyle horizontalCellContentAlignment verticalCellContentAlignment", "SDK header, grid, and alignment. Only default/emphasis grid style.", "Native conditional Table; disabled grid/cell spacing, RTL, highlight, clipping or complex cells use bounded raster."),
  rule("label value placeholder title valueOn valueOff choices isMultiSelect", "Static input labels/initial values/choice mapping and action titles; Fact/Choice exceptions below.", "Static approximation; plain generated text, not executable Markdown/control state."),
  rule("isRequired errorMessage min max maxLength regex isMultiline", "Validated metadata only; not enforced or displayed as live controls (static-input diagnostic).", "No input validation behavior; initial value/placeholder approximation only."),
  rule("actions inlineAction selectAction", "Supported action roles below; static labels or selection metadata only, never browser execution.", "Static approximation or safe text-label links; not a whole-chip/whole-image action."),
  rule("iconUrl", "URL syntax checked, icon ignored and never fetched (static-action-icon diagnostic).", "No icon object; static text label only."),
  rule("mode tooltip", "Validated but ignored by static projection (static-action/static-link diagnostic).", "No action overflow menu or hover tooltip."),
  rule("isEnabled", "False retains disabled static action label and prevents hyperlink creation.", "Static approximation without a link when disabled."),
  rule("data associatedInputs verb", "Opaque validated action data; never executed, collected or submitted (static-action diagnostic).", "No payload/verb/input behavior or embedded executable data."),
  rule("card", "ShowCard tree validated even when collapsed; image bytes in collapsed tree are not fetched.", "Static collapsed label, embedded content omitted with static-action diagnostic."),
  rule("poster", "Media poster uses exactly the Image asset gate.", "Static approximation with native approved image, or diagnosed placeholder."),
  rule("sources mimeType", "Media source metadata only; custom host protocols rejected, no media fetch.", "static-media diagnostic; no video/audio output."),
  rule("orientation", "ActionSet orientation ignored by owned vertical projection (static-property-ignored).", "Static approximation, not authored action layout."),
];

export const ADAPTIVE_CARD_PROPERTY_OVERRIDES = [
  { types: ["Action.OpenUrl"], ...rule("url", "Safe HTTP(S)/mailto/tel only, no credentials/controls; no browser navigation. Unsafe URL gets blocked-link; custom protocols error.",
    "Approved text-label hyperlink only; disabled/blocked link has static label without hyperlink.") },
  { types: ["MediaSource"], ...rule("url", "Validated metadata; custom protocols error. Never fetched (even an HTTP(S) URL).",
    "No playable content; covered by static-media diagnostic.") },
  { types: ["Fact"], ...rule("title value", "Required strings; sanitized Markdown inside the aggregate FactSet.",
    "Native table fields only with unambiguous Range correlation; otherwise bounded FactSet raster.") },
  { types: ["Choice"], ...rule("title value", "Required strings for static selection mapping; no live choices.",
    "Selected titles only, plain text; unselected options are not displayed (static-input).") },
  { types: ["Input.Text", "Input.ChoiceSet"], ...rule("style", "Validated input style; Text password masks value; otherwise control appearance is not reproduced (static-input).",
    "Static approximation only; no text control or dropdown.") },
  { types: ["Action.OpenUrl", "Action.Submit", "Action.Execute", "Action.ShowCard"], ...rule("style", "Validated action style ignored by owned emphasis labels (static-action/static-link).",
    "Static approximation, not positive/destructive host action appearance.") },
  { types: ["Input.Toggle", "Input.ChoiceSet"], ...rule("wrap", "Validated, but projection uses owned static text layout (static-input).",
    "Static approximation; no input-control wrapping contract.") },
];

export function adaptiveCardCapabilities() {
  const envelope = adaptiveCardSchemaEnvelope();
  if (Object.keys(typeContracts).some((type) => !Object.hasOwn(envelope, type))) throw new Error("Stale card type contract.");
  const defaults = new Map();
  for (const entry of ADAPTIVE_CARD_PROPERTY_CONTRACTS) for (const property of entry.properties) {
    if (defaults.has(property)) throw new Error(`Duplicate card property contract: ${property}`);
    defaults.set(property, entry);
  }
  const types = Object.fromEntries(Object.entries(envelope).map(([type, schema]) => {
    if (!typeContracts[type]) throw new Error(`Undocumented card type: ${type}`);
    const names = [...schema.properties, ...Object.keys(schema.collections), ...Object.keys(schema.children),
      ...Object.keys(schema.records), ...schema.capabilityProperties];
    const properties = Object.fromEntries(names.map((property) => {
      const contract = ADAPTIVE_CARD_PROPERTY_OVERRIDES.find((entry) => entry.types.includes(type) && entry.properties.includes(property))
        || defaults.get(property);
      if (!contract) throw new Error(`Undocumented card property: ${type}.${property}`);
      return [property, { browser: contract.browser, pptx: contract.pptx }];
    }));
    return [type, { browser: typeContracts[type][0], pptx: typeContracts[type][1], ...schema, properties }];
  }));
  for (const entry of ADAPTIVE_CARD_PROPERTY_OVERRIDES) for (const type of entry.types) for (const property of entry.properties) {
    if (!types[type]?.properties[property]) throw new Error(`Stale card property override: ${type}.${property}`);
  }
  for (const property of defaults.keys()) {
    if (!Object.values(types).some((type) => Object.hasOwn(type.properties, property))) throw new Error(`Stale card property contract: ${property}`);
  }
  return {
    revision: ADAPTIVE_CARD_CAPABILITY_REVISION, sdkVersion: ADAPTIVE_CARDS_SDK_VERSION,
    schemaVersion: ADAPTIVE_CARD_SCHEMA_VERSION, hostConfigVersion: ADAPTIVE_CARD_HOST_CONFIG_VERSION,
    supportsInteractivity: false, types,
  };
}
