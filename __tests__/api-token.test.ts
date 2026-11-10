import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getAuthContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: vi.fn() }));

import { authenticateApiToken, generateApiToken, getRequestAuth, hashApiToken, readBearerToken } from "@/lib/auth/api-token";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/** Imita só a cadeia usada por authenticateApiToken. */
function fakeAdmin(row: { id: string; created_by: string; workspace: { id: string; name: string; slug: string } | null; token_hash: string; revoked_at: string | null } | null) {
  const updates: unknown[] = [];
  const admin = {
    from: vi.fn(() => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        },
        is: (col: string, val: unknown) => {
          filters[`is:${col}`] = val;
          return chain;
        },
        maybeSingle: async () => {
          const ok = row && filters.token_hash === row.token_hash && row.revoked_at === null;
          return { data: ok ? row : null };
        },
        update: (patch: unknown) => {
          updates.push(patch);
          return chain;
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: null }),
      };
      return chain;
    }),
  };
  return { admin, updates };
}

const WS = { id: "ws1", name: "Fullz", slug: "fullz" };

describe("token da API", () => {
  beforeEach(() => {
    vi.mocked(getAuthContext).mockReset();
    vi.mocked(getSupabaseAdminClient).mockReset();
  });

  it("gera token com prefixo e nunca repete", () => {
    const a = generateApiToken();
    expect(a.startsWith("pct_")).toBe(true);
    expect(a.length).toBeGreaterThan(40);
    expect(generateApiToken()).not.toBe(a);
  });

  it("guarda só o hash", () => {
    expect(hashApiToken("pct_x")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiToken("pct_x")).not.toContain("pct_x");
  });

  it("lê só Bearer com o prefixo do PITCHAT", () => {
    const req = (h?: string) => new Request("https://x/api", { headers: h ? { authorization: h } : {} });
    expect(readBearerToken(req("Bearer pct_abc"))).toBe("pct_abc");
    expect(readBearerToken(req("Bearer outro"))).toBeNull();
    expect(readBearerToken(req())).toBeNull();
  });

  it("token válido vira o contexto do workspace dele", async () => {
    const token = generateApiToken();
    const { admin } = fakeAdmin({ id: "t1", created_by: "user-1", workspace: WS, token_hash: hashApiToken(token), revoked_at: null });
    await expect(authenticateApiToken(admin as never, token)).resolves.toEqual({ userId: "user-1", email: null, workspace: WS });
  });

  it("token revogado ou errado não entra", async () => {
    const token = generateApiToken();
    const revoked = fakeAdmin({ id: "t1", created_by: "u", workspace: WS, token_hash: hashApiToken(token), revoked_at: "2026-11-10T00:00:00Z" });
    await expect(authenticateApiToken(revoked.admin as never, token)).resolves.toBeNull();
    const other = fakeAdmin({ id: "t1", created_by: "u", workspace: WS, token_hash: hashApiToken(token), revoked_at: null });
    await expect(authenticateApiToken(other.admin as never, generateApiToken())).resolves.toBeNull();
  });

  it("sem header usa a sessão; header inválido nunca cai para a sessão", async () => {
    vi.mocked(getAuthContext).mockResolvedValue({ userId: "sessao", email: null, workspace: WS });
    await expect(getRequestAuth(new Request("https://x/api"))).resolves.toMatchObject({ userId: "sessao" });
    await expect(getRequestAuth(new Request("https://x/api", { headers: { authorization: "Bearer lixo" } }))).resolves.toBeNull();
    expect(getAuthContext).toHaveBeenCalledTimes(1);
  });

  it("header com token usa o token, não a sessão", async () => {
    const token = generateApiToken();
    const { admin } = fakeAdmin({ id: "t1", created_by: "user-api", workspace: WS, token_hash: hashApiToken(token), revoked_at: null });
    vi.mocked(getSupabaseAdminClient).mockReturnValue(admin as never);
    await expect(getRequestAuth(new Request("https://x/api", { headers: { authorization: `Bearer ${token}` } }))).resolves.toMatchObject({ userId: "user-api" });
    expect(getAuthContext).not.toHaveBeenCalled();
  });
});
