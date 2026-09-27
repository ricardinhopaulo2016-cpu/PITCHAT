import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "./fakes/fake-supabase";
import { decideAccountLink, type LinkableAccount } from "@/lib/meta/account-link";
import { buildOAuthState, verifyOAuthState } from "@/lib/meta/oauth";
import { groupAccountsByProfile, listProfileInstagramAccounts, listWorkspaceInstagramAccounts } from "@/lib/social-accounts/repo";

/**
 * Fase D0 — segurança pra 2+ contas Instagram no mesmo workspace/perfil.
 * NÃO prova comportamento da Meta (ex.: IGSID por conta) — isso é E2E real.
 */

const acct = (over: Partial<LinkableAccount> = {}): LinkableAccount => ({
  id: "sa-1",
  workspace_id: "ws-1",
  profile_id: "profile-1",
  external_account_id: "ig-111",
  ...over,
});

describe("decideAccountLink — adicionar vs reconectar sem sobrescrever conta", () => {
  const base = { workspaceId: "ws-1", profileId: "profile-1" };

  it("adicionar uma 2ª conta ao mesmo perfil = insert (não toca a IG01 existente)", () => {
    expect(decideAccountLink({ ...base, authorizedExternalId: "ig-222", existing: null })).toEqual({ action: "insert" });
  });

  it("reautorizar conta já existente do mesmo perfil = update só de credenciais", () => {
    expect(decideAccountLink({ ...base, authorizedExternalId: "ig-111", existing: acct() })).toEqual({ action: "update", accountId: "sa-1" });
  });

  it("conta existente em OUTRO perfil nunca é reassociada", () => {
    const d = decideAccountLink({ ...base, authorizedExternalId: "ig-111", existing: acct({ profile_id: "profile-2" }) });
    expect(d).toEqual({ action: "reject", reason: "account_linked_to_other_profile" });
  });

  it("conta existente em OUTRO workspace nunca é tomada", () => {
    const d = decideAccountLink({ ...base, authorizedExternalId: "ig-111", existing: acct({ workspace_id: "ws-2" }) });
    expect(d).toEqual({ action: "reject", reason: "account_in_other_workspace" });
  });

  it("reconectar IG01 mas a Meta devolver IG02 = recusa, sem alterar nada", () => {
    const d = decideAccountLink({
      ...base,
      authorizedExternalId: "ig-222",
      existing: acct({ id: "sa-2", external_account_id: "ig-222" }),
      reconnectRequested: true,
      reconnectTarget: acct(),
    });
    expect(d).toEqual({ action: "reject", reason: "wrong_account_authorized" });
  });

  it("reconectar IG01 e a Meta devolver IG01 = update dela", () => {
    const d = decideAccountLink({ ...base, authorizedExternalId: "ig-111", existing: acct(), reconnectRequested: true, reconnectTarget: acct() });
    expect(d).toEqual({ action: "update", accountId: "sa-1" });
  });

  it("reconexão pedida mas conta-alvo sumiu = recusa", () => {
    const d = decideAccountLink({ ...base, authorizedExternalId: "ig-111", existing: acct(), reconnectRequested: true, reconnectTarget: null });
    expect(d).toEqual({ action: "reject", reason: "reconnect_target_not_found" });
  });
});

describe("OAuth state — alvo de reconexão", () => {
  const secret = "segredo";
  it("carrega reconnectAccountId quando informado", () => {
    expect(verifyOAuthState(buildOAuthState("ws", "p", secret, "sa-9"), secret)).toEqual({ workspaceId: "ws", profileId: "p", reconnectAccountId: "sa-9" });
  });
  it("sem alvo = fluxo 'adicionar' (campo ausente)", () => {
    const parsed = verifyOAuthState(buildOAuthState("ws", "p", secret), secret);
    expect(parsed).toEqual({ workspaceId: "ws", profileId: "p" });
    expect(parsed).not.toHaveProperty("reconnectAccountId");
  });
});

describe("social accounts — 2+ contas no mesmo perfil", () => {
  function seed() {
    const supabase = createFakeSupabase();
    const base = { workspace_id: "ws-1", platform: "instagram", status_detail: null, token_expires_at: null };
    supabase.__tables.social_accounts = [
      { id: "ig01", profile_id: "profile-1", username: "ig01", status: "connected", ...base },
      { id: "ig02", profile_id: "profile-1", username: "ig02", status: "connected", ...base },
      { id: "old", profile_id: "profile-1", username: "antiga", status: "revoked", ...base },
      { id: "other", profile_id: "profile-2", username: "outra", status: "expired", ...base },
      { id: "foreign", profile_id: "profile-1", username: "de-outro-ws", status: "connected", ...base, workspace_id: "ws-2" },
    ];
    return supabase;
  }

  it("lista do workspace mantém as DUAS contas do mesmo perfil, sem revogadas nem de outro workspace", async () => {
    const accounts = await listWorkspaceInstagramAccounts(seed() as never, "ws-1");
    expect(accounts.map((a) => a.id).sort()).toEqual(["ig01", "ig02", "other"]);
  });

  it("agrupamento por perfil não perde a segunda conta (era Map profile→1 conta)", async () => {
    const grouped = groupAccountsByProfile(await listWorkspaceInstagramAccounts(seed() as never, "ws-1"));
    expect(grouped.get("profile-1")?.map((a) => a.username)).toEqual(["ig01", "ig02"]);
    expect(grouped.get("profile-2")?.map((a) => a.username)).toEqual(["outra"]);
  });

  it("editor: contas do perfil vêm como LISTA (2 contas), nunca escolhe uma arbitrária", async () => {
    const accounts = await listProfileInstagramAccounts(seed() as never, "ws-1", "profile-1");
    expect(accounts.map((a) => a.username)).toEqual(["ig01", "ig02"]);
  });

  it("guarda de regressão: o editor de automação não usa .maybeSingle() em social_accounts", () => {
    const source = readFileSync("app/dashboard/automations/[id]/page.tsx", "utf8");
    expect(source).not.toMatch(/from\("social_accounts"\)[\s\S]{0,300}maybeSingle/);
    expect(source).toContain("listProfileInstagramAccounts");
  });

  it("guarda de regressão: Social Accounts não colapsa contas num Map profile→conta", () => {
    const source = readFileSync("app/dashboard/social-accounts/page.tsx", "utf8");
    expect(source).not.toContain("accountByProfile");
    expect(source).toContain("groupAccountsByProfile");
  });
});
