export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_REFERENCE_LENGTH = 8192;
const MAX_DATA_HEADER_LENGTH = 256;
const MAX_ENCODED_IMAGE_LENGTH = MAX_IMAGE_BYTES * 3 + MAX_DATA_HEADER_LENGTH + 1;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/svg+xml"]);

export class ImageSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImageSourceError";
  }
}

function fail(label, message) {
  throw new ImageSourceError(`${label}: ${message}`);
}

export function checkImageBytes(byteLength, label, currentTotal = 0) {
  if (byteLength > MAX_IMAGE_BYTES) {
    fail(label, `image is ${byteLength} bytes (${(byteLength / 1024 / 1024).toFixed(2)} MiB); limit is 10 MiB`);
  }
  if (currentTotal + byteLength > MAX_TOTAL_IMAGE_BYTES) {
    fail(label, `image assets total ${currentTotal + byteLength} bytes; limit is 100 MiB`);
  }
}

function percentByteLength(payload, label) {
  let bytes = 0;
  for (let index = 0; index < payload.length; index++) {
    const code = payload.charCodeAt(index);
    if (code === 37) {
      if (!/^[0-9a-f]{2}$/i.test(payload.slice(index + 1, index + 3))) {
        fail(label, "image data URL contains an invalid percent escape");
      }
      bytes++;
      index += 2;
    } else if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const low = payload.charCodeAt(++index);
      if (!(low >= 0xdc00 && low <= 0xdfff)) fail(label, "image data URL contains invalid Unicode");
      bytes += 4;
    } else {
      if (code >= 0xdc00 && code <= 0xdfff) fail(label, "image data URL contains invalid Unicode");
      bytes += 3;
    }
  }
  return bytes;
}

// Count decoded bytes before allocating an image buffer. Ordinary URLs retain
// their small string limit; only supported, bounded image data URLs bypass it.
export function inspectImageSource(source, label = "Image") {
  if (typeof source !== "string" || !source) fail(label, "image source must be a non-empty string");
  if (!/^data:/i.test(source)) {
    if (source.length > MAX_IMAGE_REFERENCE_LENGTH) {
      fail(label, `image reference exceeds ${MAX_IMAGE_REFERENCE_LENGTH} characters`);
    }
    return null;
  }
  if (source.length > MAX_ENCODED_IMAGE_LENGTH) {
    fail(label, "encoded image exceeds the maximum length for a 10 MiB image");
  }
  const comma = source.indexOf(",");
  if (comma < 0 || comma > MAX_DATA_HEADER_LENGTH) fail(label, "image data URL header is invalid");
  const [contentType, ...parameters] = source.slice(5, comma).toLowerCase().split(";");
  if (!IMAGE_TYPES.has(contentType)) fail(label, "only PNG, JPEG, GIF, or SVG image data URLs are supported");
  let base64 = false;
  for (const parameter of parameters) {
    if (parameter === "base64" && !base64) base64 = true;
    else if (!/^charset=(?:utf-8|us-ascii)$/.test(parameter)) {
      fail(label, "image data URL encoding is unsupported");
    }
  }
  const payload = source.slice(comma + 1);
  if (!payload) fail(label, "image data URL is empty");
  let byteLength;
  if (base64) {
    const paddingStart = payload.indexOf("=");
    const length = paddingStart < 0 ? payload.length : paddingStart;
    const padding = payload.length - length;
    byteLength = Math.floor(length * 3 / 4);
    checkImageBytes(byteLength, label);
    if (length % 4 === 1 || padding > 2 ||
        (padding > 0 && (payload.length % 4 !== 0 || !/^={1,2}$/.test(payload.slice(length)))) ||
        /[^A-Za-z0-9+/]/.test(payload.slice(0, length))) {
      fail(label, "image data URL contains invalid base64");
    }
  } else {
    byteLength = percentByteLength(payload, label);
    checkImageBytes(byteLength, label);
  }
  return { contentType, base64, payload, byteLength };
}

export function decodePercentImageData({ payload, byteLength }) {
  const data = new Uint8Array(byteLength);
  const encoder = new TextEncoder();
  let offset = 0;
  let start = 0;
  while (start < payload.length) {
    const percent = payload.indexOf("%", start);
    const end = percent < 0 ? payload.length : percent;
    const literal = encoder.encode(payload.slice(start, end));
    data.set(literal, offset);
    offset += literal.length;
    if (percent < 0) break;
    data[offset++] = parseInt(payload.slice(percent + 1, percent + 3), 16);
    start = percent + 3;
  }
  return data;
}
