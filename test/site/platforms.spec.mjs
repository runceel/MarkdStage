import {
  expect, expectNoHorizontalOverflow, localeUrl, test,
} from "./fixtures.mjs";

const platforms = ["windows", "node", "copilot"];
const sections = ["install", "author", "deliver", "examples"];
const routes = [
  { basePath: "/", lang: "ja" },
  { basePath: "/MarkdStage/", lang: "en" },
];

const tab = (page, id) => page.locator(`[data-platform-tab='${id}']`);
const panel = (page, id) => page.locator(`[data-platform-panel='${id}']`);

async function expectPlatform(page, selected) {
  await expect.poll(() => page.evaluate(() => ({
    tabs: [...document.querySelectorAll("[data-platform-tab]")].map((element) => ({
      id: element.dataset.platformTab,
      selected: element.getAttribute("aria-selected"),
      tabIndex: element.tabIndex,
    })),
    panels: [...document.querySelectorAll("[data-platform-panel]")].map((element) => ({
      id: element.dataset.platformPanel,
      hidden: element.hidden,
    })),
    remembered: history.state?.markdstagePlatform,
  })), { message: `Only the ${selected} guide should be selected and remembered` }).toEqual({
    tabs: platforms.map((id) => ({ id, selected: String(id === selected), tabIndex: id === selected ? 0 : -1 })),
    panels: platforms.map((id) => ({ id, hidden: id !== selected })),
    remembered: selected,
  });
  await expect(page.locator("[data-platform-panel]:visible")).toHaveCount(1);
  await expect(panel(page, selected)).toBeVisible();
}

async function focusInstant(locator) {
  await locator.evaluate((element) => {
    element.scrollIntoView({ block: "center", behavior: "instant" });
    element.focus({ preventScroll: true });
  });
  await expect(locator).toBeFocused();
  await expect(locator).toBeInViewport({ ratio: 1 });
}

async function followLink(page, locator) {
  await focusInstant(locator);
  await page.keyboard.press("Enter");
}

async function expectVisibleFocus(locator) {
  await expect(locator).toBeFocused();
  await expect(locator).toHaveCSS("outline-style", "solid");
  expect(await locator.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
}

async function expectAnchorInView(page, id) {
  const target = page.locator(`#${id}`);
  await expect(target).toBeVisible();
  await expect(target).toBeInViewport();
  await expect.poll(() => target.evaluate((element) => element.getBoundingClientRect().top),
    { message: `The start of #${id} should not be scrolled above the viewport` }).toBeGreaterThanOrEqual(0);
}

async function expectIntroInView(page, id) {
  await expectAnchorInView(page, `platform-${id}`);
  const heading = page.locator(`#platform-${id}-title`);
  await expect(heading).toBeInViewport({ ratio: 1 });
  await expect.poll(() => heading.evaluate((element) =>
    element.getBoundingClientRect().top - document.querySelector(".platform-tabs").getBoundingClientRect().bottom
  ), { message: `The ${id} intro must not be covered by the sticky tabs` }).toBeGreaterThanOrEqual(0);
}

for (const { basePath, lang } of routes) {
  test(`${lang}: peer tab semantics, default Windows, and keyboard navigation at ${basePath}`, async ({ page, site }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: navigator.userAgent.replace(/\([^)]*\)/u, "(Macintosh; Intel Mac OS X 10_15_7)"),
      });
      if (navigator.userAgentData) {
        Object.defineProperty(navigator.userAgentData, "platform", { configurable: true, value: "macOS" });
      }
    });
    const url = localeUrl(site, basePath, lang);
    await page.goto(url);
    await expectPlatform(page, "windows");
    const tablist = page.getByRole("tablist", { name: site[lang].platformTabLabel });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole("tab")).toHaveCount(3);
    await expect(page.getByRole("tabpanel", { includeHidden: true })).toHaveCount(3);
    for (const id of platforms) {
      await expect(tab(page, id)).toHaveAttribute("id", `tab-${id}`);
      await expect(tab(page, id)).toHaveAttribute("href", `#platform-${id}`);
      await expect(tab(page, id)).toHaveAttribute("aria-controls", `platform-${id}`);
      await expect(tab(page, id)).toHaveAccessibleName(site[lang].platformLabels[id]);
      await expect(panel(page, id)).toHaveAttribute("aria-labelledby", `tab-${id}`);
      await expect(panel(page, id)).toHaveAttribute("tabindex", "0");
      expect(await panel(page, id).locator(":scope > [data-platform-section]").evaluateAll((elements) =>
        elements.map((element) => ({ section: element.dataset.platformSection, id: element.id }))
      )).toEqual(sections.map((section) => ({ section, id: `${id}-${section}` })));
    }

    await focusInstant(tab(page, "windows"));
    for (const [key, id] of [
      ["ArrowLeft", "copilot"],
      ["ArrowLeft", "node"],
      ["ArrowRight", "copilot"],
      ["ArrowRight", "windows"],
      ["End", "copilot"],
      ["Home", "windows"],
    ]) {
      await test.step(`${key} activates and focuses ${id}`, async () => {
        await page.keyboard.press(key);
        await expectPlatform(page, id);
        await expect(page).toHaveURL(`${url}#platform-${id}`);
        await expectVisibleFocus(tab(page, id));
      });
    }

    for (const [key, id, previous] of [["Enter", "node", "windows"], ["Space", "copilot", "node"]]) {
      await focusInstant(tab(page, id));
      await expectPlatform(page, previous);
      await page.keyboard.press(key);
      await expectPlatform(page, id);
      await expect(page).toHaveURL(`${url}#platform-${id}`);
      await expectVisibleFocus(tab(page, id));
    }

    for (const [key, id] of [["Home", "windows"], ["ArrowRight", "node"], ["End", "copilot"]]) {
      await page.keyboard.press(key);
      await expectPlatform(page, id);
      await page.keyboard.press("Tab");
      await expectVisibleFocus(panel(page, id));
      await page.keyboard.press("Shift+Tab");
      await expectVisibleFocus(tab(page, id));
    }
  });
}

test("platform clicks remove only the selection query and retain the shared gallery selection", async ({ page, site }) => {
  const url = `${localeUrl(site, "/MarkdStage/", "en")}?platform=windows&utm_source=tabs&tag=one&tag=two`;
  await page.goto(url);
  await page.locator("[data-example='architecture']").click();
  expect(await page.locator("#examples").evaluate((element) => element.closest("[data-platform-panel]"))).toBeNull();

  for (const id of ["node", "copilot", "windows"]) {
    await tab(page, id).click();
    await expectPlatform(page, id);
    const expected = new URL(url);
    expected.searchParams.delete("platform");
    expected.hash = `platform-${id}`;
    await expect(page).toHaveURL(expected.href);
    await expect(page.locator("[data-example='architecture']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#example-architecture")).toBeVisible();
    await expect(page.locator("#example-markdown")).toBeHidden();
  }
});

const entries = [
  { name: "legacy Windows recording", basePath: "/", lang: "ja",
    suffix: "#windows-workflow", selected: "windows", anchor: "windows-workflow" },
  { name: "Windows installation", basePath: "/MarkdStage/", lang: "en",
    suffix: "#windows-install", selected: "windows", anchor: "windows-install" },
  { name: "Copilot examples", basePath: "/", lang: "en",
    suffix: "#copilot-examples", selected: "copilot", anchor: "copilot-examples" },
  { name: "closed CLI disclosure", basePath: "/MarkdStage/", lang: "ja",
    suffix: "#cli-check", selected: "node", anchor: "cli-check", disclosure: ".cli-output" },
  { name: "Node query with a common anchor", basePath: "/", lang: "ja",
    suffix: "?platform=node#examples", selected: "node", anchor: "examples" },
  { name: "Copilot query with a common anchor", basePath: "/MarkdStage/", lang: "en",
    suffix: "?platform=copilot#examples", selected: "copilot", anchor: "examples" },
  { name: "panel hash overriding a conflicting query", basePath: "/MarkdStage/", lang: "ja",
    suffix: "?platform=node#platform-copilot", selected: "copilot", anchor: "platform-copilot" },
  { name: "unknown query and hash", basePath: "/", lang: "en",
    suffix: "?platform=linux#not-a-platform", selected: "windows" },
  { name: "malformed query and hash", basePath: "/MarkdStage/", lang: "ja",
    suffix: "?platform=%E0%A4%A#%E0%A4%A", selected: "windows" },
];

for (const entry of entries) {
  test(`direct entry and reload: ${entry.name}`, async ({ page, site }) => {
    const url = `${localeUrl(site, entry.basePath, entry.lang)}${entry.suffix}`;
    await page.goto(url);
    for (const phase of ["entry", "reload"]) {
      await test.step(phase, async () => {
        if (phase === "reload") await page.reload();
        await expect(page).toHaveURL(url);
        await expectPlatform(page, entry.selected);
        if (entry.disclosure) await expect(page.locator(entry.disclosure)).toHaveJSProperty("open", true);
        if (entry.anchor) await expectAnchorInView(page, entry.anchor);
      });
    }
  });
}

test("hash changes reveal and scroll to every platform stage", async ({ page, site }) => {
  const url = localeUrl(site, "/MarkdStage/", "en");
  await page.goto(`${url}#platform-copilot`);
  await expectPlatform(page, "copilot");
  for (const section of sections) {
    for (const id of platforms) {
      const anchor = `${id}-${section}`;
      await test.step(anchor, async () => {
        await page.evaluate((hash) => { location.hash = hash; }, anchor);
        await expect(page).toHaveURL(`${url}#${anchor}`);
        await expectPlatform(page, id);
        await expectAnchorInView(page, anchor);
      });
    }
  }

  await page.evaluate(() => { location.hash = "cli-check"; });
  await expectPlatform(page, "node");
  await expect(page.locator(".cli-output")).toHaveJSProperty("open", true);
  await expectAnchorInView(page, "cli-check");
});

test("back and forward restore common-anchor choices and the original default entry", async ({ page, site }) => {
  const url = `${localeUrl(site, "/", "ja")}?utm_source=history`;
  await page.goto(url);
  await expectPlatform(page, "windows");
  const history = [{ suffix: "", selected: "windows" }];
  for (const selected of ["node", "copilot"]) {
    await tab(page, selected).click();
    await expectPlatform(page, selected);
    history.push({ suffix: `#platform-${selected}`, selected });
    await tab(page, selected).click();
    await followLink(page, page.locator(".main-nav a[href='#examples']"));
    await expect(page).toHaveURL(`${url}#examples`);
    await expectPlatform(page, selected);
    history.push({ suffix: "#examples", selected });
  }
  await tab(page, "windows").click();
  await expectPlatform(page, "windows");
  history.push({ suffix: "#platform-windows", selected: "windows" });

  for (const entry of history.slice(0, -1).reverse()) {
    await page.goBack();
    await expect(page).toHaveURL(`${url}${entry.suffix}`);
    await expectPlatform(page, entry.selected);
  }
  for (const entry of history.slice(1)) {
    await page.goForward();
    await expect(page).toHaveURL(`${url}${entry.suffix}`);
    await expectPlatform(page, entry.selected);
  }
});

test("native fragment focus and tab activation never leave focus in a hidden panel", async ({ page, site }) => {
  await page.goto(`${localeUrl(site, "/MarkdStage/", "en")}#cli-check`);
  await expectPlatform(page, "node");
  await focusInstant(page.locator(".cli-output summary"));
  await page.evaluate(() => { location.hash = "platform-copilot"; });
  await expectPlatform(page, "copilot");
  await expect(panel(page, "copilot")).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expectVisibleFocus(tab(page, "copilot"));
  await page.keyboard.press("Tab");
  await expectVisibleFocus(panel(page, "copilot"));
  // Programmatic activation leaves focus in the panel being hidden, unlike a pointer click.
  await tab(page, "windows").evaluate((element) => element.click());
  await expectPlatform(page, "windows");
  await expect(tab(page, "windows")).toBeFocused();
  await expect(page.locator("[data-platform-panel][hidden] :focus")).toHaveCount(0);
});

test("keyboard switching from the end of a guide returns to the new intro", async ({ page, site }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const url = localeUrl(site, "/MarkdStage/", "en");
  await page.goto(url);
  await focusInstant(tab(page, "windows"));
  for (const [key, previous, selected] of [
    ["ArrowRight", "windows", "node"],
    ["End", "node", "copilot"],
    ["Home", "copilot", "windows"],
  ]) {
    await page.locator(`#${previous}-examples`).evaluate((element) =>
      element.scrollIntoView({ block: "start", behavior: "instant" })
    );
    await expect(tab(page, previous)).toBeFocused();
    await expect(tab(page, previous)).toBeInViewport({ ratio: 1 });
    await expect(page.locator(`#platform-${previous}-title`)).not.toBeInViewport();
    await page.keyboard.press(key);
    await expectPlatform(page, selected);
    await expect(page).toHaveURL(`${url}#platform-${selected}`);
    await expectVisibleFocus(tab(page, selected));
    await expectIntroInView(page, selected);
  }
});

for (const { basePath, lang } of routes) {
  test(`${lang}: language links preserve guide choices with no hash, common anchors, and deep links at ${basePath}`, async ({ page, site }) => {
    const alternate = lang === "ja" ? "en" : "ja";
    await page.goto(`${localeUrl(site, basePath, lang)}?platform=node`);
    await expectPlatform(page, "node");

    const changeLanguage = async (destination, suffix, selected) => {
      const link = page.locator(`.languages a[lang='${destination}']`);
      const url = `${localeUrl(site, basePath, destination)}${suffix}`;
      await expect(link).toHaveAttribute("href", url);
      await followLink(page, link);
      await expect(page).toHaveURL(url);
      await expect(page.locator("html")).toHaveAttribute("lang", destination);
      await expectPlatform(page, selected);
    };

    await changeLanguage(alternate, "?platform=node", "node");
    await tab(page, "copilot").click();
    await followLink(page, page.locator(".main-nav a[href='#examples']"));
    await expectPlatform(page, "copilot");
    await changeLanguage(lang, "?platform=copilot#examples", "copilot");

    await page.evaluate(() => { location.hash = "cli-check"; });
    await expectPlatform(page, "node");
    await changeLanguage(alternate, "#cli-check", "node");
    await expect(page.locator(".cli-output")).toHaveJSProperty("open", true);
    await expectAnchorInView(page, "cli-check");

    await tab(page, "windows").click();
    await followLink(page, page.locator(".main-nav a[href='#examples']"));
    await expectPlatform(page, "windows");
    await changeLanguage(lang, "#examples", "windows");
  });

  test(`${lang}: sticky peer tabs and all guides fit 320px without panel animation at ${basePath}`, async ({ page, site }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(localeUrl(site, basePath, lang));
    const tablist = page.locator(".platform-tabs");
    await expect(tablist).toHaveCSS("position", "sticky");
    await expectNoHorizontalOverflow(page);

    for (const id of [...platforms, "windows"]) {
      await tab(page, id).click();
      await expectPlatform(page, id);
      await expectIntroInView(page, id);
      await expect(panel(page, id)).toHaveCSS("animation-name", "none");
      await expect(panel(page, id)).toHaveCSS("transition-duration", "0s");
      await page.locator(`#${id}-examples`).evaluate((element) =>
        element.scrollIntoView({ block: "start", behavior: "instant" })
      );
      await expect(page.locator(`#platform-${id}-title`)).not.toBeInViewport();
      await expect.poll(() => tablist.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(0, 0);
      await expect(tablist).toBeInViewport({ ratio: 1 });
      const widths = [];
      for (const platform of platforms) {
        const control = tab(page, platform);
        await expect(control).toBeInViewport({ ratio: 1 });
        const box = await control.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        widths.push(box.width);
        expect(await control.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
      await expectNoHorizontalOverflow(page);
    }
  });
}

test("forced colors keep a selected-tab indicator distinct from keyboard focus", async ({ page, site }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto(localeUrl(site, "/MarkdStage/", "en"));
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  for (const id of ["copilot", "node"]) {
    await followLink(page, tab(page, id));
    await expectPlatform(page, id);
    await page.keyboard.press("Tab");
    await expectVisibleFocus(panel(page, id));
    await expect(tab(page, id)).not.toBeFocused();
    await expect(tab(page, id)).toHaveCSS("outline-style", "solid");
    expect(await tab(page, id).evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
    for (const other of platforms.filter((platform) => platform !== id)) {
      await expect(tab(page, other)).toHaveCSS("outline-style", "none");
    }
  }
});

test("hiding the Windows guide pauses its recording without resetting or resuming it", async ({ page, site }) => {
  await page.goto(`${localeUrl(site, "/MarkdStage/", "en")}#windows-workflow`);
  const video = panel(page, "windows").locator("#windows-workflow video");
  await expect(page.locator("[data-platform-panel]:not([data-platform-panel='windows']) video")).toHaveCount(0);
  await video.evaluate((element) => {
    element.muted = true;
    return element.play();
  });
  await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(0);
  await focusInstant(tab(page, "node"));
  await expect(video).toHaveJSProperty("paused", false);
  const playingAt = await video.evaluate((element) => element.currentTime);
  await page.keyboard.press("Enter");
  await expectPlatform(page, "node");
  await expect(video).toBeHidden();
  await expect(video).toHaveJSProperty("paused", true);
  const pausedAt = await video.evaluate((element) => element.currentTime);
  expect(pausedAt).toBeGreaterThanOrEqual(playingAt);
  expect(pausedAt).toBeGreaterThan(0);

  for (const id of ["copilot", "windows", "node", "windows"]) {
    await tab(page, id).click();
    await expectPlatform(page, id);
    await expect(video).toHaveJSProperty("paused", true);
    await expect(video).toHaveJSProperty("currentTime", pausedAt);
  }
  await expect(video).toBeVisible();
});

test.describe("platform guides without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  for (const { basePath, lang } of routes) {
    test(`${lang}: all guides remain visible and tabs remain native anchor links at ${basePath}`, async ({ page, site }) => {
      await page.setViewportSize({ width: 320, height: 844 });
      const url = localeUrl(site, basePath, lang);
      await page.goto(url);
      await expect(page.locator(".platform-tabs")).toHaveAttribute("role", "group");
      await expect(page.getByRole("tab")).toHaveCount(0);
      await expect(page.getByRole("tabpanel")).toHaveCount(0);
      await expect(page.locator("[data-platform-panel]:visible")).toHaveCount(3);
      for (const id of platforms) {
        await expect(tab(page, id)).toHaveAttribute("href", `#platform-${id}`);
        await expect(tab(page, id)).not.toHaveAttribute("aria-selected", /.+/u);
        await expect(panel(page, id)).toHaveJSProperty("hidden", false);
        await followLink(page, tab(page, id));
        await expect(page).toHaveURL(`${url}#platform-${id}`);
        await expectAnchorInView(page, `platform-${id}`);
        await expect(page.locator("[data-platform-panel]:visible")).toHaveCount(3);
        await expectNoHorizontalOverflow(page);
      }
      await page.reload();
      await expect(page).toHaveURL(`${url}#platform-copilot`);
      await expect(page.locator("[data-platform-panel]:visible")).toHaveCount(3);
      await expectAnchorInView(page, "platform-copilot");
    });
  }
});
