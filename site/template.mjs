export function escapeHtml(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError("Site template values must be strings or numbers.");
  }
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

const arrow = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
const external = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg>';
const github = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.15-1.11-1.46-1.11-1.46-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.64.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03A9.58 9.58 0 0 1 12 6.83c.85 0 1.7.11 2.5.34 1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>';

export function renderPage({ copy: c, product, sources, siteUrl }) {
  const e = escapeHtml;
  const prefix = c.lang === "en" ? "../" : "./";
  const asset = (name) => `${prefix}assets/${name}`;
  const pageUrl = new URL(c.lang === "en" ? "en/" : "./", siteUrl).href;
  const docs = `${product.repository}/blob/main/docs/user-guide/${c.lang === "ja" ? "ja/" : ""}`;
  const installUrl = `${product.repository}/tree/${product.releaseTag}/.github/extensions/markdstage`;
  const prompt = `${c.canvasPrompt}\n\n${installUrl}`;
  const heading = (text) => e(text).replaceAll("\n", "<br>");
  const link = (url, text, className = "text-link") =>
    `<a class="${className}" href="${e(url)}">${e(text)}${external}</a>`;
  const copyButton = (id) =>
    `<button class="copy-button" type="button" data-copy="${id}" hidden>${e(c.copy)}</button>`;
  const terminal = (id, command) => `
    <div class="terminal">
      <div class="terminal-bar"><span>Terminal</span>${copyButton(id)}</div>
      <pre tabindex="0" aria-label="CLI"><code id="${id}">${e(command)}</code></pre>
    </div>`;
  const request = (id, text) => `
    <div class="prompt-example">
      <p class="prompt-label">${e(c.promptExample)}</p>
      <div class="prompt-box">
        <pre tabindex="0" aria-label="${e(c.promptExample)}"><code id="${id}">${e(text)}</code></pre>
        ${copyButton(id)}
      </div>
    </div>`;
  const screenshot = (file, alt, caption, width = 1920, height = 1200) => `
    <figure class="platform-screenshot">
      <img src="${asset(file)}" width="${width}" height="${height}" loading="lazy" decoding="async" alt="${e(alt)}">
      <figcaption>${e(caption)} ${link(asset(file), c.openImage)}</figcaption>
    </figure>`;
  const sample = () =>
    `<a class="text-link" href="${prefix}examples/service-review.md" download>${e(c.downloadSample)}${arrow}</a>`;
  const platformIds = ["windows", "node", "copilot"];
  const platformSection = (platform, section, body) => `
    <section class="platform-section" data-platform-section="${section}" id="${platform}-${section}" aria-labelledby="${platform}-${section}-title">
      <h4 id="${platform}-${section}-title">${e(c.platformSections[section])}</h4>
      <div class="platform-section-body">${body}</div>
    </section>`;
  const platformPanel = (id, title, description, requirements, body) => `
    <section class="platform-panel" id="platform-${id}" data-platform-panel="${id}" aria-labelledby="platform-${id}-title">
      <header class="platform-intro">
        <h3 id="platform-${id}-title">${e(title)}</h3>
        <p>${e(description)}</p>
        <p class="requirements">${e(requirements)}</p>
      </header>
      ${body}
    </section>`;
  const example = (id, alt, description) => `
    <section class="example" id="example-${id}" aria-labelledby="example-title-${id}">
      <div class="example-output">
        <div class="output-bar"><h3 id="example-title-${id}">${e(id === "markdown" ? c.markdownLabel : c.architectureLabel)}</h3><span>1280 × 720</span></div>
        <img src="${asset(`examples/${id}.png`)}" alt="${e(alt)}" width="1280" height="720" loading="lazy" decoding="async">
      </div>
      <div class="example-detail">
        <p>${e(description)}</p>
        <details class="source-disclosure">
          <summary>${e(c.sourceLabel)} <span aria-hidden="true">+</span></summary>
          <pre tabindex="0" aria-label="${e(id + ".md")}"><code>${e(sources[id])}</code></pre>
        </details>
        <a class="text-link" href="${prefix}examples/${id}.md" download>${e(c.downloadSource)}${arrow}</a>
      </div>
    </section>`;
  const windows = platformPanel("windows", c.desktopTitle, c.desktopDescription, c.desktopDetail, `
    ${platformSection("windows", "install", `
      <div class="platform-grid">
        <div>
          ${link(product.storeUrl, c.desktopLink, "button")}
          <ol class="windows-steps">
            ${c.windowsSteps.map((step) => `<li><h5>${e(step.title)}</h5><p>${e(step.body)}</p></li>`).join("")}
          </ol>
          ${link(`${docs}installation.md`, c.cliInstallLink)}
        </div>
        <div>
          ${screenshot("windows-workspace.png", c.workspaceAlt, c.workspaceCaption)}
          <details class="skills-example">
            <summary>${e(c.skillsCaption)}</summary>
            ${screenshot("windows-skills.png", c.skillsAlt, c.skillsCaption)}
          </details>
        </div>
      </div>
    `)}
    ${platformSection("windows", "author", `
      <p>${e(c.windowsAuthorDescription)}</p>
      ${request("windows-author-prompt", c.authorPrompt)}
      <div class="platform-grid">
        <div>
          <h5 id="editor-title">${e(c.editorTitle)}</h5>
          <p>${e(c.editorDescription)}</p>
          ${link(`${docs}diagrams-and-media.md`, c.editorLink)}
        </div>
        ${screenshot("architecture-editor.png", c.editorAlt, c.editorCaption)}
      </div>
    `)}
    ${platformSection("windows", "deliver", `
      <h5>${e(c.reviewTitle)}</h5>
      <p>${e(c.windowsReview)}</p>
      <h5>${e(c.presentTitle)}</h5>
      <p>${e(c.windowsPresent)}</p>
      <h5>${e(c.exportTitle)}</h5>
      <p>${e(c.windowsExport)}</p>
      ${link(`${docs}presenting-and-export.md`, c.shareLink)}
    `)}
    ${platformSection("windows", "examples", `
      <div class="recording-section" id="windows-workflow" aria-labelledby="recording-title">
        <h5 id="recording-title">${e(c.windowsWorkflowTitle)}</h5>
        <p>${e(c.windowsWorkflowDescription)}</p>
        <div class="recording-links">
          ${link(`${docs}windows-walkthrough.md`, c.windowsWalkthroughLink)}
          ${sample()}
        </div>
        <figure class="recording">
          <video controls playsinline preload="none" width="1920" height="1080" poster="${asset("windows-workspace.png")}"
            aria-label="${e(c.recordingLabel)}" aria-describedby="recording-note">
            <source src="${asset("windows-workflow.mp4")}" type="video/mp4">
            <track kind="captions" src="${asset("windows-workflow.en.vtt")}" srclang="en" label="English"${c.lang === "en" ? " default" : ""}>
            <track kind="captions" src="${asset("windows-workflow.ja.vtt")}" srclang="ja" label="日本語"${c.lang === "ja" ? " default" : ""}>
            <a href="${asset("windows-workflow.mp4")}">${e(c.downloadRecording)}</a>
          </video>
          <figcaption id="recording-note">${e(c.recordingNote)}</figcaption>
        </figure>
        <a class="text-link" href="${asset("windows-workflow.mp4")}" download>${e(c.downloadRecording)}${arrow}</a>
        <details class="recording-transcript">
          <summary>${e(c.recordingTranscript)}</summary>
          <ol>${c.recordingSteps.map((step) => `<li>${e(step)}</li>`).join("")}</ol>
        </details>
      </div>
      ${link(`${docs}desktop.md`, c.desktopGuide)}
      ${link(`${docs}cli.md`, c.cliLink)}
    `)}
  `);
  const node = platformPanel("node", c.cliTitle, c.cliDescription, c.cliRequirements, `
    ${platformSection("node", "install", `
      <p>${e(c.cliInstallDescription)}</p>
      ${terminal("cli-setup", product.cliSetupCommand)}
      <p class="requirements">${e(c.cliResolutionNote)}</p>
      <details class="skill-setup">
        <summary>${e(c.cliSkillTitle)}</summary>
        <p>${e(c.cliSkillDescription)}</p>
        ${terminal("cli-skill", product.cliSkillCommand)}
        <p class="install-next">${e(c.cliAlternative)}</p>
        <pre class="alternative-command" tabindex="0" aria-label="Codex"><code>${e(product.cliAlternativeCommand)}</code></pre>
      </details>
      ${link(`${docs}installation.md`, c.cliInstallLink)}
    `)}
    ${platformSection("node", "author", `
      <p>${e(c.cliAuthorDescription)}</p>
      ${request("node-author-prompt", c.authorPrompt)}
      <h5>${e(c.cliPreviewTitle)}</h5>
      <p>${e(c.cliPreviewDescription)}</p>
      ${terminal("cli-preview", product.cliPreviewCommand)}
      <p class="install-next">${e(c.cliSessionNote)}</p>
      ${request("node-refine-prompt", c.refinePrompt)}
      ${link(`${docs}cli.md#architecture-editing-in-watch-mode`, c.editorLink)}
    `)}
    ${platformSection("node", "deliver", `
      <h5>${e(c.reviewTitle)}</h5>
      <p>${e(c.cliInspectDescription)}</p>
      ${request("node-inspect-prompt", c.inspectPrompt)}
      <details class="cli-output">
        <summary>${e(c.cliOutputTitle)}</summary>
        <p>${e(c.cliCheckDescription)}</p>
        ${terminal("cli-check", product.cliCheckCommand)}
      </details>
      <h5>${e(c.presentTitle)}</h5>
      ${terminal("cli-command", product.cliCommand)}
      <p class="install-next">${e(c.cliNext)}</p>
      <h5>${e(c.exportTitle)}</h5>
      <p>${e(c.cliDeliveryDescription)}</p>
      ${terminal("cli-export", product.cliExportCommand)}
      ${link(`${docs}presenting-and-export.md`, c.shareLink)}
    `)}
    ${platformSection("node", "examples", `
      <h5>${e(c.sampleTitle)}</h5>
      <p>${e(c.nodeExampleDescription)}</p>
      ${sample()}
      <ol class="walkthrough-steps">${c.nodeExampleSteps.map((step) => `<li>${e(step)}</li>`).join("")}</ol>
      ${screenshot("node-preview.png", c.nodePreviewAlt, c.nodePreviewCaption, 1440, 900)}
      ${link(`${docs}cli.md`, c.cliLink)}
      ${link(`${docs}ai-assisted-authoring.md`, c.authoringGuide)}
    `)}
  `);
  const copilot = platformPanel("copilot", c.canvasTitle, c.canvasDescription, c.canvasRequirements, `
    ${platformSection("copilot", "install", `
      <p>${e(c.canvasInstructions)}</p>
      ${request("canvas-prompt", prompt)}
      <p class="requirements">${e(c.canvasWarning)}</p>
      ${link(`${docs}installation.md`, c.canvasLink)}
    `)}
    ${platformSection("copilot", "author", `
      <p>${e(c.canvasNext)}</p>
      ${request("canvas-author-prompt", c.canvasAuthorPrompt)}
      <h5>${e(c.editorTitle)}</h5>
      <p>${e(c.canvasEdit)}</p>
      <p>${e(c.canvasDirect)}</p>
      ${link(`${docs}diagrams-and-media.md`, c.editorLink)}
    `)}
    ${platformSection("copilot", "deliver", `
      <h5>${e(c.reviewTitle)}</h5>
      <p>${e(c.canvasReview)}</p>
      ${request("canvas-inspect-prompt", c.inspectPrompt)}
      <h5>${e(c.presentTitle)}</h5>
      <p>${e(c.canvasPresent)}</p>
      <h5>${e(c.exportTitle)}</h5>
      <p>${e(c.canvasExport)}</p>
      ${request("canvas-export-prompt", c.canvasExportPrompt)}
      ${link(`${docs}presenting-and-export.md`, c.shareLink)}
    `)}
    ${platformSection("copilot", "examples", `
      <h5>${e(c.sampleTitle)}</h5>
      <p>${e(c.canvasExampleDescription)}</p>
      ${sample()}
      ${request("canvas-open-prompt", c.canvasOpenPrompt)}
      ${request("canvas-refine-prompt", c.canvasRefinePrompt)}
      ${screenshot("examples/architecture.png", c.architectureAlt, c.canvasExampleCaption, 1280, 720)}
      ${link(`${docs}copilot-hands-on.md`, c.canvasWalkthroughLink)}
      ${link(`${docs}canvas-extension.md`, c.canvasGuide)}
    `)}
  `);
  return `<!doctype html>
<html lang="${e(c.lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${e(c.title)}</title>
  <meta name="description" content="${e(c.description)}">
  <link rel="canonical" href="${e(pageUrl)}">
  <link rel="alternate" hreflang="ja" href="${e(siteUrl)}">
  <link rel="alternate" hreflang="en" href="${e(new URL("en/", siteUrl).href)}">
  <link rel="alternate" hreflang="x-default" href="${e(siteUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="MarkdStage">
  <meta property="og:title" content="${e(c.title)}">
  <meta property="og:description" content="${e(c.description)}">
  <meta property="og:url" content="${e(pageUrl)}">
  <meta property="og:locale" content="${e(c.locale)}">
  <meta property="og:image" content="${e(new URL("assets/examples/architecture.png", siteUrl).href)}">
  <meta property="og:image:width" content="1280">
  <meta property="og:image:height" content="720">
  <meta property="og:image:alt" content="${e(c.heroAlt)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="${asset("mark.svg")}" type="image/svg+xml">
  <link rel="preload" href="${asset("examples/architecture.png")}" as="image">
  <link rel="stylesheet" href="${asset("site.css")}">
  <script src="${asset("site.js")}" defer></script>
</head>
<body>
  <!--
  THESIS: Equal platform guides, not a Windows-first installation funnel.
  OWN-WORLD: Existing Midnight Ink, Paper, Spotlight Amber, and Segoe UI.
  STORY: Review common output examples, choose an environment, then install,
  create/edit, review/present/export, and follow its examples.
  FIRST VIEWPORT: Product title and description above a real rendered slide;
  the primary action leads to the platform selector.
  FORM: User-specified extension of the existing page: three peer tabs with
  matching guide sections. Without JavaScript, every guide remains readable.
  -->
  <a class="skip-link" href="#main">${e(c.skip)}</a>
  <header class="header wrap">
    <a class="wordmark" href="./" aria-label="MarkdStage">
      <img src="${asset("mark.svg")}" alt="" width="38" height="38">
      <span>Markd<span class="wordmark-accent">Stage</span></span>
    </a>
    <nav class="main-nav" aria-label="${e(c.navLabel)}">
      <a href="#examples">${e(c.examplesNav)}</a>
      <a href="#get-started">${e(c.startNav)}</a>
      <div class="languages" role="group" aria-label="${e(c.languageLabel)}">
        <a href="${prefix}" lang="ja" hreflang="ja"${c.lang === "ja" ? ' aria-current="page"' : ""}>日本語</a>
        <span aria-hidden="true">/</span>
        <a href="${prefix}en/" lang="en" hreflang="en"${c.lang === "en" ? ' aria-current="page"' : ""}>EN</a>
      </div>
      <a class="github-icon" href="${e(product.repository)}" aria-label="GitHub">${github}</a>
    </nav>
  </header>
  <main id="main">
    <section class="hero wrap" aria-labelledby="hero-title">
      <div class="hero-copy">
        <h1 id="hero-title" lang="${e(c.heroLang)}">${e(c.heroLine1)}<br><span>${e(c.heroLine2)}</span></h1>
        <div class="hero-intro">
          <p>${e(c.heroDescription)}</p>
          <div class="hero-actions">
            <a class="button" href="#get-started">${e(c.start)}${arrow}</a>
            <a class="quiet-link" href="${e(product.repository)}">${e(c.viewGithub)}${external}</a>
          </div>
        </div>
      </div>
      <div class="stage">
        <figure class="hero-slide">
          <img src="${asset("examples/architecture.png")}" width="1280" height="720" alt="${e(c.heroAlt)}" fetchpriority="high">
          <figcaption>${e(c.heroCaption)}<a class="screenshot-link" href="${asset("examples/architecture.png")}">${e(c.openImage)}</a></figcaption>
        </figure>
        <p class="stage-note">${e(c.heroNote)}</p>
      </div>
      <ul class="surfaces" aria-label="${e(c.surfacesLabel)}">
        ${platformIds.map((id) => `<li><a href="#platform-${id}">${e(c.platformLabels[id])}${arrow}</a></li>`).join("")}
      </ul>
    </section>

    <section class="needs-section wrap section" aria-labelledby="needs-title">
      <h2 id="needs-title">${e(c.needsTitle)}</h2>
      <dl class="needs-list">
        ${c.needs.map((need) => `<div><dt>${e(need.title)}</dt><dd>${e(need.body)}</dd></div>`).join("")}
      </dl>
    </section>

    <section class="workflow wrap section" aria-labelledby="workflow-title">
      <h2 id="workflow-title">${heading(c.workflowTitle)}</h2>
      <ol class="workflow-steps">
        ${c.steps.map((step, index) => `<li>
          <span class="step-number" aria-hidden="true">${index + 1}</span>
          <div><h3>${e(step.title)}</h3><p>${e(step.body)}</p><p class="step-detail">${e(step.detail)}</p></div>
        </li>`).join("")}
      </ol>
    </section>

    <section class="examples-section wrap section" id="examples" aria-labelledby="examples-title">
      <div class="section-intro">
        <h2 id="examples-title">${heading(c.examplesTitle)}</h2>
        <p>${e(c.examplesDescription)}</p>
      </div>
      <div class="gallery-controls" role="group" aria-label="${e(c.galleryLabel)}" hidden>
        <button type="button" data-example="markdown" aria-controls="example-markdown" aria-pressed="true">${e(c.markdownLabel)}</button>
        <button type="button" data-example="architecture" aria-controls="example-architecture" aria-pressed="false">${e(c.architectureLabel)}</button>
      </div>
      <div class="gallery">
        ${example("markdown", c.markdownAlt, c.markdownDescription)}
        ${example("architecture", c.architectureAlt, c.architectureDescription)}
      </div>
    </section>

    <section class="sharing wrap section" aria-labelledby="share-title">
      <div class="section-intro">
        <h2 id="share-title">${e(c.shareTitle)}</h2>
        <p>${e(c.shareDescription)}</p>
      </div>
      <div class="share-formats">
        <div><h3>${e(c.pdfTitle)}</h3><p>${e(c.pdfDescription)}</p></div>
        <div><h3>${e(c.pptxTitle)}</h3><p>${e(c.pptxDescription)}</p></div>
      </div>
      ${link(`${docs}presenting-and-export.md`, c.shareLink)}
    </section>

    <section class="start-section section" id="get-started" aria-labelledby="start-title">
      <div class="wrap">
        <div class="section-intro">
          <h2 id="start-title">${heading(c.startTitle)}</h2>
          <p>${e(c.startDescription)}</p>
        </div>
        <div class="platform-tabs" role="group" aria-label="${e(c.platformTabLabel)}">
          ${platformIds.map((id) => `<a id="tab-${id}" href="#platform-${id}" data-platform-tab="${id}">${e(c.platformLabels[id])}</a>`).join("")}
        </div>
        ${windows}
        ${node}
        ${copilot}
        <p class="mac-note">${e(c.macDescription)} ${link(product.macUrl, c.macLink)} <span>${e(c.macNote)}</span></p>
      </div>
    </section>
  </main>
  <footer class="footer wrap">
    <div class="footer-promise"><img src="${asset("mark.svg")}" alt="" width="54" height="54"><div><h2>${e(c.footerTitle)}</h2><p>${e(c.footerDescription)}</p></div></div>
    <nav aria-label="${e(c.footerNavLabel)}">
      <a href="${e(product.repository)}">GitHub</a>
      <a href="${e(`${docs}README.md`)}">${e(c.docs)}</a>
      <a href="${e(`${product.repository}/releases`)}">${e(c.releases)}</a>
      <a href="${e(`${product.repository}/blob/main/LICENSE`)}">MIT License</a>
    </nav>
    <p class="footer-note">${e(c.footerNote)}</p>
  </footer>
  <p class="copy-status" role="status" aria-live="polite" data-copied="${e(c.copied)}" data-failed="${e(c.copyFailed)}" data-unavailable="${e(c.copyUnavailable)}"></p>
</body>
</html>
`;
}
