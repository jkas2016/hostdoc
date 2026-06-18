import mime from "mime-types";

/** Returns a Content-Type (with charset for text types) or octet-stream. */
export function contentTypeFor(filename: string): string {
  return mime.contentType(filename) || "application/octet-stream";
}
