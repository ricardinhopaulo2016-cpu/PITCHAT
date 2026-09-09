/**
 * Fake mínimo do client do Supabase, só com o subconjunto de encadeamento
 * que lib/automation/engine.ts realmente usa. Guarda tudo em memória, pra
 * testar o orquestrador sem precisar de um Postgres de verdade.
 */
export function createFakeSupabase() {
  const tables: Record<string, Record<string, unknown>[]> = {
    automation_run_steps: [],
    automation_runs: [],
    tags: [],
    contact_tags: [],
  };

  function matches(row: Record<string, unknown>, filters: [string, unknown][]) {
    return filters.every(([k, v]) => row[k] === v);
  }

  function builder(table: string) {
    const filters: [string, unknown][] = [];
    let pendingUpdate: Record<string, unknown> | null = null;
    let pendingInsert: Record<string, unknown> | null = null;

    const api = {
      select() {
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return api;
      },
      insert(row: Record<string, unknown>) {
        pendingInsert = { id: row.id ?? `fake-${tables[table].length + 1}`, ...row };
        tables[table].push(pendingInsert);
        return api;
      },
      update(patch: Record<string, unknown>) {
        pendingUpdate = patch;
        return api;
      },
      upsert(row: Record<string, unknown>) {
        tables[table].push(row);
        return Promise.resolve({ data: row, error: null });
      },
      delete() {
        return {
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            tables[table] = tables[table].filter((r) => !matches(r, filters));
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      async maybeSingle() {
        if (pendingUpdate) {
          const idx = tables[table].findIndex((r) => matches(r, filters));
          if (idx === -1) return { data: null, error: null };
          tables[table][idx] = { ...tables[table][idx], ...pendingUpdate };
          return { data: tables[table][idx], error: null };
        }
        const row = tables[table].find((r) => matches(r, filters));
        return { data: row ?? null, error: null };
      },
      async single() {
        const result = await api.maybeSingle();
        return result.data ? result : { data: null, error: new Error("not found") };
      },
      then(resolve: (v: { data: unknown; error: null }) => void) {
        if (pendingUpdate) {
          tables[table] = tables[table].map((r) =>
            matches(r, filters) ? { ...r, ...pendingUpdate } : r
          );
        }
        resolve({ data: pendingInsert, error: null });
      },
    };
    return api;
  }

  return {
    from(table: string) {
      return builder(table);
    },
    __tables: tables,
  };
}
