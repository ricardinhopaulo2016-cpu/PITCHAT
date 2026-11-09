import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./fakes/fake-supabase";

vi.mock("@/lib/auth/session", () => ({ getAuthContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: vi.fn() }));

import { GET } from "@/app/api/inbox/unread-count/route";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

describe("GET /api/inbox/unread-count", () => {
  beforeEach(() => {
    vi.mocked(getAuthContext).mockReset();
    vi.mocked(getSupabaseAdminClient).mockReset();
  });

  it("sem sessão devolve 401", async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null as never);
    expect((await GET()).status).toBe(401);
  });

  it("conta só o workspace da sessão", async () => {
    const fake = createFakeSupabase();
    fake.__tables.conversations.push(
      { id: "a", workspace_id: "ws1", unread_inbound_count: 2 },
      { id: "b", workspace_id: "ws1", unread_inbound_count: 0 },
      { id: "c", workspace_id: "ws2", unread_inbound_count: 7 }
    );
    vi.mocked(getAuthContext).mockResolvedValue({ workspace: { id: "ws1" } } as never);
    vi.mocked(getSupabaseAdminClient).mockReturnValue(fake as never);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ count: 1 });
  });
});
