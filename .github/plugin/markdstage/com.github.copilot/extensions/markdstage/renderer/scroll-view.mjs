// Scroll preview: every slide stacked in one vertically scrolling column.
//
// The controller owns only outer-page DOM (frames, status strips, overlays); the
// 1280x720 slide surface inside each frame is untouched, so output-equivalent
// pixels never change. Frames mount lazily near the viewport and are disposed
// again when far away, because each frame is a complete renderer document.

const MOUNT_MARGIN = "100% 0px 100% 0px";
const SCROLL_SETTLE_MS = 900;
const SCAN_TIMEOUT_MS = 10000;

export function layoutIssueFrom(diagnostic) {
  if (!diagnostic || diagnostic.pdfClipped !== true) return null;
  return {
    vertical: Math.max(0, Math.round(Number(diagnostic.verticalOverflowPx) || 0)),
    horizontal: Math.max(0, Math.round(Number(diagnostic.horizontalOverflowPx) || 0)),
  };
}

export function issueSeverity(record) {
  if (!record) return "ok";
  if (record.errors?.length) return "error";
  return record.clipped ? "warning" : "ok";
}

export function describeIssue(record) {
  const parts = [];
  for (const message of record?.errors ?? []) parts.push(message);
  if (record?.clipped) {
    const details = [];
    if (record.clipped.vertical > 0) details.push(`vertical ${record.clipped.vertical}px`);
    if (record.clipped.horizontal > 0) details.push(`horizontal ${record.clipped.horizontal}px`);
    parts.push(`PDF layout clips this slide${details.length ? `: ${details.join(", ")}` : ""}.`);
  }
  return parts.join(" ");
}

export function issueIndexes(issues) {
  return [...issues.entries()]
    .filter(([, record]) => issueSeverity(record) !== "ok")
    .map(([index]) => index)
    .sort((a, b) => a - b);
}

/** Next slide index carrying an issue after/before `current`, wrapping around. */
export function adjacentIssueIndex(indexes, current, direction) {
  if (!indexes.length) return -1;
  if (direction >= 0) return indexes.find((index) => index > current) ?? indexes[0];
  return [...indexes].reverse().find((index) => index < current) ?? indexes.at(-1);
}

export function createScrollView(host, options) {
  const {
    createViewport,
    onCurrentChange,
    onIssuesChange,
    scan = true,
    documentRef = document,
  } = options;
  const container = documentRef.createElement("div");
  container.className = "scroll-view";
  container.tabIndex = 0;
  container.setAttribute("role", "list");
  container.setAttribute("aria-label", "Slides");
  const scanHost = documentRef.createElement("div");
  scanHost.className = "scroll-scan";
  scanHost.setAttribute("aria-hidden", "true");
  host.replaceChildren(container, scanHost);

  const items = [];
  const issues = new Map();
  let getState = () => null;
  let currentIndex = -1;
  let ignoreScrollUntil = 0;
  let userChangeUntil = 0;
  let scrollFrame = 0;
  let scanning = false;
  let scanTimer = 0;
  let disposed = false;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const item = items[Number(entry.target.dataset.index)];
        if (!item) continue;
        if (entry.isIntersecting) mount(item);
        else unmount(item);
      }
    },
    { root: container, rootMargin: MOUNT_MARGIN },
  );

  function record(index) {
    let value = issues.get(index);
    if (!value) {
      value = { errors: [], clipped: null, scanned: false, key: "" };
      issues.set(index, value);
    }
    return value;
  }

  function emitIssues() {
    onIssuesChange?.(issues);
  }

  function paint(item) {
    const value = issues.get(item.index);
    const severity = issueSeverity(value);
    item.el.dataset.state = severity;
    const message = describeIssue(value);
    item.badge.hidden = severity === "ok";
    item.badge.dataset.severity = severity;
    item.badge.textContent = severity === "ok"
      ? ""
      : `${severity === "error" ? "\u2716 Error" : "\u26A0 Warning"}: ${message}`;
    item.overlay.hidden = severity !== "error";
    item.overlay.textContent = severity === "error" ? message : "";
  }

  function report(index, patch) {
    const value = record(index);
    const item = items[index];
    if (item) value.key = item.key;
    if ("layout" in patch) {
      value.clipped = layoutIssueFrom(patch.layout);
      value.scanned = true;
    }
    if (patch.error && !value.errors.includes(patch.error)) value.errors.push(patch.error);
    if (item) paint(item);
    emitIssues();
  }

  function mount(item) {
    if (item.viewport || disposed) return;
    const state = getState(item.index);
    if (!state) return;
    item.el.classList.add("mounted");
    item.viewport = createViewport(item.frame, item.index, {
      onLayout: (diagnostic) => report(item.index, { layout: diagnostic }),
      onError: (message) => report(item.index, { error: message }),
    });
    item.viewport.setState(state);
  }

  function unmount(item) {
    if (!item.viewport) return;
    item.viewport.dispose();
    item.viewport = null;
    item.el.classList.remove("mounted");
  }

  function createItem(index) {
    const el = documentRef.createElement("section");
    el.className = "scroll-item";
    el.dataset.index = String(index);
    el.setAttribute("role", "listitem");
    const head = documentRef.createElement("header");
    head.className = "scroll-item-head";
    const number = documentRef.createElement("span");
    number.className = "scroll-item-number";
    const title = documentRef.createElement("span");
    title.className = "scroll-item-title";
    const badge = documentRef.createElement("span");
    badge.className = "scroll-item-badge";
    badge.hidden = true;
    head.append(number, title, badge);
    const frame = documentRef.createElement("div");
    frame.className = "scroll-item-frame slide-viewport";
    frame.dataset.index = String(index);
    const overlay = documentRef.createElement("div");
    overlay.className = "scroll-item-error";
    overlay.setAttribute("role", "alert");
    overlay.hidden = true;
    el.append(head, frame, overlay);
    container.appendChild(el);
    observer.observe(frame);
    return { index, el, frame, number, title, badge, overlay, viewport: null, key: "" };
  }

  function removeItem(item) {
    observer.unobserve(item.frame);
    unmount(item);
    item.el.remove();
  }

  function visibleIndex() {
    const box = container.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    let best = -1;
    let bestDistance = Infinity;
    for (const item of items) {
      const rect = item.el.getBoundingClientRect();
      const distance = rect.top <= middle && rect.bottom >= middle
        ? 0
        : Math.min(Math.abs(rect.top - middle), Math.abs(rect.bottom - middle));
      if (distance < bestDistance) {
        best = item.index;
        bestDistance = distance;
      }
    }
    return best;
  }

  container.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (performance.now() < ignoreScrollUntil) return;
      const index = visibleIndex();
      if (index >= 0 && index !== currentIndex) {
        // A slower /state response may still carry the previous slide; keep the
        // user's position until the server has caught up.
        userChangeUntil = performance.now() + 1500;
        setCurrent(index);
        onCurrentChange?.(index);
      }
    });
  }, { passive: true });

  function setCurrent(index) {
    currentIndex = index;
    for (const item of items) {
      if (item.index === index) item.el.setAttribute("aria-current", "true");
      else item.el.removeAttribute("aria-current");
      item.el.dataset.current = item.index === index ? "true" : "false";
    }
  }

  function scrollToItem(index, { smooth = false } = {}) {
    const item = items[index];
    if (!item) return;
    setCurrent(index);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    ignoreScrollUntil = performance.now() + (smooth && !reduced ? SCROLL_SETTLE_MS : 200);
    item.el.scrollIntoView({ block: "center", behavior: smooth && !reduced ? "smooth" : "instant" });
  }

  function scheduleScan() {
    if (!scan || scanning || disposed) return;
    const next = items.find((item) => {
      const value = issues.get(item.index);
      return !item.viewport && !(value?.scanned && value.key === item.key);
    });
    if (!next) return;
    scanning = true;
    const state = getState(next.index);
    if (!state) {
      scanning = false;
      return;
    }
    let finished = false;
    let viewport = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(scanTimer);
      viewport?.dispose();
      scanning = false;
      setTimeout(scheduleScan, 50);
    };
    const record_ = (patch) => {
      report(next.index, patch);
      if ("layout" in patch) finish();
    };
    viewport = createViewport(scanHost, next.index, {
      onLayout: (diagnostic) => record_({ layout: diagnostic }),
      onError: (message) => record_({ error: message }),
      scan: true,
    });
    viewport.setState(state);
    scanTimer = setTimeout(() => {
      const value = record(next.index);
      value.scanned = true;
      value.key = next.key;
      finish();
    }, SCAN_TIMEOUT_MS);
  }

  return {
    element: container,
    get currentIndex() {
      return currentIndex;
    },
    /**
     * Reconcile the column with the deck. `slides` and `titles` are parallel
     * arrays; `state(index)` returns the viewport state for one slide, or null.
     */
    update({ slides, titles, index, state }) {
      getState = state;
      while (items.length > slides.length) {
        const item = items.pop();
        issues.delete(item.index);
        removeItem(item);
      }
      while (items.length < slides.length) items.push(createItem(items.length));
      for (const item of items) {
        const key = JSON.stringify(state(item.index));
        item.number.textContent = String(item.index + 1);
        item.title.textContent = titles[item.index] || "";
        if (key !== item.key) {
          item.key = key;
          const value = issues.get(item.index);
          if (value) {
            value.errors = [];
            value.clipped = null;
            value.scanned = false;
          }
          if (item.viewport) item.viewport.setState(state(item.index));
        }
        paint(item);
      }
      emitIssues();
      if (currentIndex === index) userChangeUntil = 0;
      else if (performance.now() >= userChangeUntil) scrollToItem(index, { smooth: currentIndex >= 0 });
      if (scan) setTimeout(scheduleScan, 300);
    },
    /** Scroll on behalf of the user; hold off stale /state echoes for a moment. */
    scrollToIndex(index, options) {
      userChangeUntil = performance.now() + 1500;
      scrollToItem(index, options);
    },
    issues,
    dispose() {
      disposed = true;
      clearTimeout(scanTimer);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      observer.disconnect();
      for (const item of items) unmount(item);
      items.length = 0;
      host.replaceChildren();
    },
  };
}
