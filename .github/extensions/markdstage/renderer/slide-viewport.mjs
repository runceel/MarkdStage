export const OUTPUT_WIDTH = 1280;
export const OUTPUT_HEIGHT = 720;

// Scale the browsing context, not its contents: SVG text measurement and viewport
// units must see the same untransformed geometry at every display size.
export function createSlideViewport(host, { id, title, onNavigate, onKey, onPointer, onLayout, onError }) {
  const frame = document.createElement("iframe");
  frame.id = id;
  frame.title = title;
  frame.className = "slide-viewport-frame";
  frame.width = OUTPUT_WIDTH;
  frame.height = OUTPUT_HEIGHT;
  frame.src = "./?surface=1";
  let state = null;
  let loaded = false;
  const render = () => {
    if (loaded && state) frame.contentWindow.__markdstageSurface.render(state);
  };
  frame.addEventListener("load", () => {
    loaded = true;
    render();
  });
  frame.addEventListener("slide-navigate", (event) => onNavigate?.(event.detail));
  frame.addEventListener("slide-key", (event) => onKey?.(event.detail));
  frame.addEventListener("slide-pointer", () => onPointer?.());
  frame.addEventListener("slide-layout", (event) => onLayout?.(event.detail));
  frame.addEventListener("slide-error", (event) => onError?.(event.detail));
  const resize = () => {
    const scale = Math.min(host.clientWidth / OUTPUT_WIDTH, host.clientHeight / OUTPUT_HEIGHT);
    frame.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  const observer = new ResizeObserver(resize);
  host.appendChild(frame);
  observer.observe(host);
  resize();
  return {
    setState(next) {
      state = next;
      frame.tabIndex = next.navigationEnabled ? 0 : -1;
      render();
    },
    dispose() {
      observer.disconnect();
      frame.remove();
      state = null;
    },
  };
}
