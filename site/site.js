const platformTabs = document.querySelector(".platform-tabs");
const tabs = [...document.querySelectorAll("[data-platform-tab]")];
const panels = [...document.querySelectorAll("[data-platform-panel]")];
const languageLinks = [...document.querySelectorAll(".languages a")].map((element) => ({
  element, url: element.href,
}));
let activePlatform;

function hashTarget() {
  return document.getElementById(location.hash.slice(1));
}

function platformFromHash() {
  return hashTarget()?.closest("[data-platform-panel]")?.dataset.platformPanel;
}

function knownPlatform(id) {
  return panels.some((panel) => panel.dataset.platformPanel === id);
}

function updateLanguageLinks() {
  for (const { element, url } of languageLinks) {
    const destination = new URL(url);
    destination.hash = location.hash;
    // Keep the chosen guide even when the current anchor is in shared content.
    if (!platformFromHash() && activePlatform !== tabs[0].dataset.platformTab) {
      destination.searchParams.set("platform", activePlatform);
    }
    element.href = destination.href;
  }
}

function selectPlatform(id) {
  for (const tab of tabs) {
    const selected = tab.dataset.platformTab === id;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of panels) {
    const selected = panel.dataset.platformPanel === id;
    if (!selected && !panel.hidden) {
      for (const video of panel.querySelectorAll("video")) video.pause();
      if (panel.contains(document.activeElement)) {
        tabs.find((tab) => tab.dataset.platformTab === id).focus({ preventScroll: true });
      }
    }
    panel.hidden = !selected;
  }
  activePlatform = id;
  updateLanguageLinks();
}

function revealPlatformFromLocation() {
  const queryPlatform = new URL(location.href).searchParams.get("platform");
  const remembered = history.state?.markdstagePlatform;
  const id = platformFromHash()
    || (knownPlatform(queryPlatform) && queryPlatform)
    || (knownPlatform(remembered) && remembered)
    || activePlatform
    || tabs[0].dataset.platformTab;
  selectPlatform(id);
  history.replaceState({ ...history.state, markdstagePlatform: id }, "", location.href);
  const target = hashTarget();
  if (target?.closest("[data-platform-panel]")) {
    for (let details = target.closest("details"); details; details = details.parentElement.closest("details")) {
      details.open = true;
    }
    target.scrollIntoView({ block: "start", behavior: "instant" });
  }
}

if (platformTabs && tabs.length && panels.length) {
  platformTabs.setAttribute("role", "tablist");
  for (const tab of tabs) {
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `platform-${tab.dataset.platformTab}`);
    tab.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const id = tab.dataset.platformTab;
      const destination = new URL(location.href);
      destination.searchParams.delete("platform");
      destination.hash = `platform-${id}`;
      if (destination.href !== location.href) {
        history.pushState({ ...history.state, markdstagePlatform: id }, "", destination.href);
      }
      selectPlatform(id);
      document.getElementById(`platform-${id}`).scrollIntoView({ block: "start", behavior: "instant" });
    });
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      const next = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key];
      if (next !== undefined) {
        event.preventDefault();
        tabs[next].focus();
        tabs[next].click();
      } else if (event.key === " ") {
        event.preventDefault();
        tab.click();
      }
    });
  }
  for (const panel of panels) {
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `tab-${panel.dataset.platformPanel}`);
    panel.tabIndex = 0;
  }
  revealPlatformFromLocation();
  window.addEventListener("hashchange", revealPlatformFromLocation);
  window.addEventListener("popstate", revealPlatformFromLocation);
}

const controls = document.querySelector(".gallery-controls");
const selectors = [...document.querySelectorAll("[data-example]")];
const examples = [...document.querySelectorAll(".example")];

function selectExample(id) {
  for (const button of selectors) {
    button.setAttribute("aria-pressed", String(button.dataset.example === id));
  }
  for (const example of examples) {
    example.hidden = example.id !== `example-${id}`;
  }
}

if (controls && selectors.length && examples.length) {
  selectExample(selectors[0].dataset.example);
  controls.hidden = false;
  for (const button of selectors) {
    button.addEventListener("click", () => selectExample(button.dataset.example));
  }
}

const status = document.querySelector(".copy-status");
let statusTimeout;
function announce(message) {
  clearTimeout(statusTimeout);
  status.textContent = message;
  statusTimeout = setTimeout(() => { status.textContent = ""; }, 8000);
}

for (const button of document.querySelectorAll("[data-copy]")) {
  button.hidden = false;
  button.addEventListener("click", async () => {
    const source = document.getElementById(button.dataset.copy);
    if (!navigator.clipboard?.writeText) {
      announce(status.dataset.unavailable);
      return;
    }
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(source.textContent);
      announce(status.dataset.copied);
    } catch (error) {
      console.warn("Clipboard write failed:", error);
      announce(status.dataset.failed);
    } finally {
      button.disabled = false;
    }
  });
}
