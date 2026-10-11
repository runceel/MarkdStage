import { spawn } from "node:child_process";

export function externalHttpUrl(value, origin) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) ||
        url.username || url.password || url.origin === origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function openExternalUrl(url, spawnProcess = spawn, platform = process.platform) {
  const [command, args] = platform === "win32"
    ? ["explorer.exe", [url]]
    : platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  const child = spawnProcess(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}
