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
    messages: [],
    contacts: [],
    conversations: [],
    comments: [],
    automations: [],
    audit_logs: [],
  };

  function matches(row: Record<string, unknown>, filters: [string, unknown][]) {
    return filters.every(([k, v]) => row[k] === v);
  }

  function builder(table: string) {
    tables[table] ??= []; // qualquer tabela nova usada num teste funciona sem precisar lembrar de listar aqui em cima
    const filters: [string, unknown][] = [];
    let pendingUpdate: Record<string, unknown> | null = null;
    let pendingInsert: Record<string, unknown> | null = null;
    let insertAttempted = false; // distingue "nunca chamou insert/upsert" de "chamou upsert mas ignorou por duplicata"

    const api = {
      select() {
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return api;
      },
      // `.not(col, "is", null)` etc — só o suficiente pra não quebrar quem
      // encadeia (ex: lib/automation/ingest.ts::loadActiveAutomations); não
      // filtra de verdade no fake, nenhum teste hoje depende dessa negação.
      not() {
        return api;
      },
      insert(row: Record<string, unknown>) {
        insertAttempted = true;
        pendingInsert = { id: row.id ?? `fake-${tables[table].length + 1}`, ...row };
        tables[table].push(pendingInsert);
        return api;
      },
      update(patch: Record<string, unknown>) {
        pendingUpdate = patch;
        return api;
      },
      // Chainable (igual ao Supabase real: upsert(...).select().maybeSingle())
      // — respeita onConflict + ignoreDuplicates igual o código de produção
      // espera (ver lib/automation/ingest.ts::ingestInstagramComment).
      upsert(row: Record<string, unknown>, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        insertAttempted = true;
        const conflictCols = (opts?.onConflict ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const conflictIdx =
          conflictCols.length > 0
            ? tables[table].findIndex((r) => conflictCols.every((c) => r[c] === row[c]))
            : -1;

        if (conflictIdx !== -1 && opts?.ignoreDuplicates) {
          pendingInsert = null; // já existia, upsert real também não retorna a linha nesse caso
        } else if (conflictIdx !== -1) {
          tables[table][conflictIdx] = { ...tables[table][conflictIdx], ...row };
          pendingInsert = tables[table][conflictIdx];
        } else {
          pendingInsert = { id: row.id ?? `fake-${tables[table].length + 1}`, ...row };
          tables[table].push(pendingInsert);
        }
        return api;
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
        if (insertAttempted) return { data: pendingInsert, error: null };
        const row = tables[table].find((r) => matches(r, filters));
        return { data: row ?? null, error: null };
      },
      async single() {
        const result = await api.maybeSingle();
        return result.data ? result : { data: null, error: new Error("not found") };
      },
      then(resolve: (v: { data: unknown; error: null; count?: number }) => void) {
        if (pendingUpdate) {
          tables[table] = tables[table].map((r) =>
            matches(r, filters) ? { ...r, ...pendingUpdate } : r
          );
          resolve({ data: pendingInsert, error: null });
          return;
        }
        if (insertAttempted) {
          resolve({ data: pendingInsert, error: null });
          return;
        }
        // Leitura simples (sem insert/update pendente) — ex: `.select("id", {
        // count: "exact", head: true }).eq(...).eq(...)` usado por
        // lib/automation/engine.ts pra contar tentativas de retry. `count`
        // sempre presente (o fake não distingue head:true/false — não
        // precisa, quem chama só olha o campo que interessa).
        const matched = tables[table].filter((r) => matches(r, filters));
        resolve({ data: matched, error: null, count: matched.length });
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
