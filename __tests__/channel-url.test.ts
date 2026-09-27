import { describe, expect, it } from "vitest";
import { buildChannelSwitchHref, buildHref, withChannelQuery, withoutChannelParam } from "@/lib/channel/url";

describe("buildHref", () => {
  it("sem params retorna só o pathname", () => {
    expect(buildHref("/dashboard/inbox", {})).toBe("/dashboard/inbox");
  });
  it("aceita record simples (server) ou URLSearchParams (client)", () => {
    expect(buildHref("/dashboard/health", { window: "60" })).toBe("/dashboard/health?window=60");
    expect(buildHref("/dashboard/health", new URLSearchParams({ window: "60" }))).toBe("/dashboard/health?window=60");
  });
});

describe("buildChannelSwitchHref — item do Channel Switcher", () => {
  it("selecionar 'Todos os canais' remove o param channel", () => {
    const href = buildChannelSwitchHref("/dashboard/inbox", new URLSearchParams({ channel: "sa-1" }), null);
    expect(href).toBe("/dashboard/inbox");
  });

  it("selecionar uma conta seta ?channel=<id>", () => {
    expect(buildChannelSwitchHref("/dashboard/inbox", new URLSearchParams(), "sa-2")).toBe("/dashboard/inbox?channel=sa-2");
  });

  it("troca manual de channel remove `conversation` — nunca deixa uma thread fora do filtro escolhido", () => {
    const current = new URLSearchParams({ channel: "sa-1", conversation: "conv-9" });
    expect(buildChannelSwitchHref("/dashboard/inbox", current, "sa-2")).toBe("/dashboard/inbox?channel=sa-2");
    expect(buildChannelSwitchHref("/dashboard/inbox", current, null)).toBe("/dashboard/inbox");
  });

  it("preserva outros params (ex.: window do Health)", () => {
    const current = new URLSearchParams({ window: "1440" });
    expect(buildChannelSwitchHref("/dashboard/health", current, "sa-1")).toBe("/dashboard/health?window=1440&channel=sa-1");
  });
});

describe("withChannelQuery — propagação de navegação (Rail/MobileSidebar)", () => {
  it("sem channel ativo, não mexe no href", () => {
    expect(withChannelQuery("/dashboard/contacts", null)).toBe("/dashboard/contacts");
  });
  it("com channel ativo, propaga só o channel — nunca outro param page-specific", () => {
    expect(withChannelQuery("/dashboard/contacts", "sa-1")).toBe("/dashboard/contacts?channel=sa-1");
  });
});

describe("withoutChannelParam", () => {
  it("remove só o channel, preservando os demais params", () => {
    const current = new URLSearchParams({ channel: "sa-1", conversation: "conv-1" });
    expect(withoutChannelParam("/dashboard/inbox", current)).toBe("/dashboard/inbox?conversation=conv-1");
  });
});
