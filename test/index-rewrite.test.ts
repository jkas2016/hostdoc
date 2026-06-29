import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// CloudFront Function files have no module exports; load the source into a
// sandbox and expose its `handler` for testing the pure URI-rewrite logic.
function loadHandler(): (event: unknown) => any {
  const code = readFileSync("infra/index-rewrite.js", "utf8");
  const sandbox: { handler?: (event: unknown) => any } = {};
  vm.createContext(sandbox);
  vm.runInContext(`${code}\nthis.handler = handler;`, sandbox);
  return sandbox.handler!;
}

const handler = loadHandler();
const reqEvent = (uri: string) => ({ request: { uri, headers: {} } });

describe("index-rewrite handler", () => {
  it("appends index.html for a trailing-slash URI", () => {
    const out = handler(reqEvent("/x7Kq2a/"));
    expect(out.uri).toBe("/x7Kq2a/index.html");
  });

  it("appends /index.html for an extensionless URI", () => {
    const out = handler(reqEvent("/x7Kq2a"));
    expect(out.uri).toBe("/x7Kq2a/index.html");
  });

  it("leaves a file URI with an extension untouched", () => {
    const out = handler(reqEvent("/x7Kq2a/assets/app.js"));
    expect(out.uri).toBe("/x7Kq2a/assets/app.js");
  });

  it("returns 403 for an underscore-prefixed path (meta protection)", () => {
    const out = handler(reqEvent("/_meta/x7Kq2a.json"));
    expect(out.statusCode).toBe(403);
  });

  it("appends index.html for a nested trailing-slash URI", () => {
    const out = handler(reqEvent("/team/q1/report/"));
    expect(out.uri).toBe("/team/q1/report/index.html");
  });

  it("appends /index.html for a nested extensionless URI", () => {
    const out = handler(reqEvent("/team/q1/report"));
    expect(out.uri).toBe("/team/q1/report/index.html");
  });

  it("returns 403 for a nested underscore-prefixed meta path", () => {
    const out = handler(reqEvent("/_meta/team/q1/report.json"));
    expect(out.statusCode).toBe(403);
  });
});
