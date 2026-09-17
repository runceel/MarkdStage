import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { DEFAULT_SITE_URL, normalizeSiteUrl, OUTPUT_DIR } from "./build-site.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function parseByteRange(value, length) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), length - 1) : length - 1;
  return Number.isSafeInteger(start) && start >= 0 && start < length && end >= start
    ? { start, end } : null;
}

export async function startSiteServer({ root = OUTPUT_DIR, basePath = "/MarkdStage/", port = 4173 } = {}) {
  if (!basePath.startsWith("/") || !basePath.endsWith("/") || basePath.includes("..")) {
    throw new Error("The preview base path must start and end with / and contain no traversal.");
  }
  const directory = await realpath(root);
  const server = createServer(async (request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch (error) {
      if (!(error instanceof URIError) && !(error instanceof TypeError)) throw error;
      response.writeHead(400).end("Invalid URL");
      return;
    }
    if (basePath !== "/" && pathname === basePath.slice(0, -1)) {
      response.writeHead(308, { Location: basePath }).end();
      return;
    }
    if (!pathname.startsWith(basePath) || pathname.includes("\\") || pathname.includes("\0")) {
      response.writeHead(404).end("Not found");
      return;
    }
    let file = pathname.slice(basePath.length);
    if (!file || file.endsWith("/")) file += "index.html";
    const target = resolve(directory, file);
    const withinRoot = (path) => {
      const value = relative(directory, path);
      return value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
    };
    if (!withinRoot(target)) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const actual = await realpath(target);
      if (!withinRoot(actual)) {
        response.writeHead(404).end("Not found");
        return;
      }
      const data = await readFile(actual);
      const headers = {
        "Content-Type": MIME[extname(actual)] || "application/octet-stream",
        "Content-Length": data.length,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      };
      // Native video seeking needs partial responses. There are no validators for If-Range.
      if (request.method === "GET" && /^bytes=/i.test(request.headers.range ?? "") && !request.headers["if-range"]) {
        const range = parseByteRange(request.headers.range, data.length);
        if (!range) {
          response.writeHead(416, {
            ...headers, "Content-Range": `bytes */${data.length}`, "Content-Length": 0,
          }).end();
          return;
        }
        response.writeHead(206, {
          ...headers,
          "Content-Range": `bytes ${range.start}-${range.end}/${data.length}`,
          "Content-Length": range.end - range.start + 1,
        }).end(data.subarray(range.start, range.end + 1));
        return;
      }
      response.writeHead(200, headers);
      response.end(request.method === "HEAD" ? undefined : data);
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code)) {
        response.writeHead(404).end("Not found");
      } else {
        console.error("Site preview failed:", error);
        response.writeHead(500).end("Could not read the site file");
      }
    }
  });
  await new Promise((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListening);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${basePath}`,
    close: () => new Promise((resolveClosed, reject) => {
      server.close((error) => error ? reject(error) : resolveClosed());
      server.closeAllConnections();
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const siteUrl = normalizeSiteUrl(process.env.SITE_URL || DEFAULT_SITE_URL);
  const preview = await startSiteServer({ basePath: new URL(siteUrl).pathname, port: Number(process.env.PORT || 4173) });
  console.log(`MarkdStage site preview: ${preview.url}\nPress Ctrl+C to stop.`);
}
