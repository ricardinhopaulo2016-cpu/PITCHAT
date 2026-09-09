import { afterEach, describe, expect, it } from "vitest";
import { getGraphApiVersion } from "@/lib/meta/api-version";

describe("getGraphApiVersion", () => {
  const original = process.env.META_API_VERSION;
  afterEach(() => {
    if (original === undefined) delete process.env.META_API_VERSION;
    else process.env.META_API_VERSION = original;
  });

  it("usa META_API_VERSION quando definida", () => {
    process.env.META_API_VERSION = "v30.0";
    expect(getGraphApiVersion()).toBe("v30.0");
  });

  it("cai pro fallback v26.0 quando a env não está definida", () => {
    delete process.env.META_API_VERSION;
    expect(getGraphApiVersion()).toBe("v26.0");
  });

  it("reflete mudança de env em runtime (não é module-level const preso ao import)", () => {
    process.env.META_API_VERSION = "v27.0";
    expect(getGraphApiVersion()).toBe("v27.0");
    process.env.META_API_VERSION = "v28.0";
    expect(getGraphApiVersion()).toBe("v28.0");
  });
});
