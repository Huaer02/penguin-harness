import { createHash } from "node:crypto";
/** Source URLs identify documents within one library; titles and basenames never do. */
export function sourceAddress(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048)
    throw new Error("invalid source address");
  const text = value.trim();
  try {
    return new URL(text).href;
  } catch {
    return text.replaceAll("\\", "/");
  }
}
export function sourceId(libraryId, source) {
  return createHash("sha256")
    .update(JSON.stringify([libraryId, source]))
    .digest("hex");
}
