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

  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let rpcError: { message: string } | null = null;
  // Colunas que "ainda não existem no banco": simula o código no ar antes da migration.
  const missingColumns = new Set<string>();
  // Erro simulado na próxima inserção da tabela (23505 = índice único).
  const insertErrorOnce = new Map<string, { code: string; message: string }>();

  function matches(row: Record<string, unknown>, filters: [string, unknown][]) {
    return filters.every(([k, v]) => row[k] === v);
  }

  function greatest(a: unknown, b: unknown) {
    if (a === null || a === undefined) return b;
    return (a as string) > (b as string) ? a : b;
  }

  function builder(table: string) {
    tables[table] ??= []; // qualquer tabela nova usada num teste funciona sem precisar lembrar de listar aqui em cima
    const filters: [string, unknown][] = [];
    const inFilters: [string, unknown[]][] = [];
    const neqFilters: [string, unknown][] = [];
    // Comparações `.gt/.lte/.is`: linha com valor nulo só passa no `.is(col, null)`, igual ao SQL.
    const predicates: ((r: Record<string, unknown>) => boolean)[] = [];
    const orderBy: { col: string; ascending: boolean; nullsFirst?: boolean }[] = [];
    let limitN: number | null = null;
    let rangeBounds: [number, number] | null = null;
    let pendingUpdate: Record<string, unknown> | null = null;
    let pendingInsert: Record<string, unknown> | null = null;
    let insertAttempted = false; // distingue "nunca chamou insert/upsert" de "chamou upsert mas ignorou por duplicata"
    let queryError: { code: string; message: string } | null = null;

    function rejectIfMissing(col: string, code = "42703") {
      if (missingColumns.has(col)) queryError = { code, message: `column ${col} does not exist` };
    }

    function rowMatches(r: Record<string, unknown>) {
      return (
        matches(r, filters) &&
        inFilters.every(([col, values]) => values.includes(r[col])) &&
        neqFilters.every(([col, val]) => r[col] !== val) &&
        predicates.every((p) => p(r))
      );
    }

    function readMatched() {
      let rows = tables[table].filter(rowMatches);
      if (orderBy.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const { col, ascending, nullsFirst } of orderBy) {
            const av = a[col] as string | number | null | undefined;
            const bv = b[col] as string | number | null | undefined;
            const aNull = av === null || av === undefined;
            const bNull = bv === null || bv === undefined;
            if (aNull && bNull) continue;
            if (av === bv) continue;
            const nullsComeFirst = nullsFirst ?? ascending;
            if (aNull) return nullsComeFirst ? -1 : 1;
            if (bNull) return nullsComeFirst ? 1 : -1;
            return ((av as string | number) < (bv as string | number) ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        });
      }
      if (rangeBounds) rows = rows.slice(rangeBounds[0], rangeBounds[1] + 1);
      if (limitN !== null) rows = rows.slice(0, limitN);
      return rows;
    }

    const api = {
      select(columns?: string) {
        for (const col of missingColumns) {
          if (columns?.includes(col)) rejectIfMissing(col);
        }
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return api;
      },
      gt(col: string, val: number | string) {
        rejectIfMissing(col);
        predicates.push((r) => r[col] !== null && r[col] !== undefined && (r[col] as number | string) > val);
        return api;
      },
      lte(col: string, val: number | string) {
        rejectIfMissing(col);
        predicates.push((r) => r[col] !== null && r[col] !== undefined && (r[col] as number | string) <= val);
        return api;
      },
      is(col: string, val: null) {
        rejectIfMissing(col);
        predicates.push((r) => (r[col] ?? null) === val);
        return api;
      },
      range(from: number, to: number) {
        rangeBounds = [from, to];
        return api;
      },
      // `.neq(col, val)` — usado por lib/social-accounts/repo.ts (exclui contas revogadas).
      neq(col: string, val: unknown) {
        neqFilters.push([col, val]);
        return api;
      },
      // `.in(col, [values])` — usado por queries em lote (ex:
      // lib/inbox/repo.ts::listConversations busca messages/comments de
      // várias conversas/contatos de uma vez, nunca N+1).
      in(col: string, values: unknown[]) {
        inFilters.push([col, values]);
        return api;
      },
      // Ordena e corta o resultado igual o Postgrest real — usado por telas
      // que precisam da timeline em ordem cronológica (lib/inbox/repo.ts).
      order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        rejectIfMissing(col);
        orderBy.push({ col, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
        return api;
      },
      limit(n: number) {
        limitN = n;
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
        const insertError = insertErrorOnce.get(table);
        if (insertError) {
          insertErrorOnce.delete(table);
          queryError = insertError;
          return api;
        }
        pendingInsert = { id: row.id ?? `fake-${tables[table].length + 1}`, ...row };
        tables[table].push(pendingInsert);
        return api;
      },
      update(patch: Record<string, unknown>) {
        for (const col of Object.keys(patch)) rejectIfMissing(col, "PGRST204");
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
        if (queryError) return { data: null, error: queryError };
        if (pendingUpdate) {
          const idx = tables[table].findIndex(rowMatches);
          if (idx === -1) return { data: null, error: null };
          tables[table][idx] = { ...tables[table][idx], ...pendingUpdate };
          return { data: tables[table][idx], error: null };
        }
        if (insertAttempted) return { data: pendingInsert, error: null };
        const row = readMatched()[0];
        return { data: row ?? null, error: null };
      },
      async single() {
        const result = await api.maybeSingle();
        return result.data ? result : { data: null, error: new Error("not found") };
      },
      then(resolve: (v: { data: unknown; error: { code: string; message: string } | null; count?: number }) => void) {
        if (queryError) {
          resolve({ data: null, error: queryError });
          return;
        }
        if (pendingUpdate) {
          tables[table] = tables[table].map((r) => (rowMatches(r) ? { ...r, ...pendingUpdate } : r));
          resolve({ data: pendingInsert, error: null });
          return;
        }
        if (insertAttempted) {
          resolve({ data: pendingInsert, error: null });
          return;
        }
        // Leitura simples (sem insert/update pendente) — ex: `.select("id", {
        // count: "exact", head: true }).eq(...).eq(...)` usado por
        // lib/automation/engine.ts pra contar tentativas de retry, ou
        // `.select(...).in(...).order(...).limit(...)` usado por
        // lib/inbox/repo.ts. `count` sempre presente (o fake não distingue
        // head:true/false — não precisa, quem chama só olha o campo que
        // interessa).
        const matched = readMatched();
        resolve({ data: matched, error: null, count: matched.length });
      },
    };
    return api;
  }

  return {
    from(table: string) {
      return builder(table);
    },
    // Espelha register_conversation_inbound da migration, inclusive a validação de workspace.
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (rpcError) return { data: null, error: rpcError };
      if (name === "register_conversation_inbound") {
        const conversation = tables.conversations.find((c) => c.id === args.p_conversation_id && c.workspace_id === args.p_workspace_id);
        if (conversation) {
          conversation.unread_inbound_count = ((conversation.unread_inbound_count as number | undefined) ?? 0) + 1;
          conversation.last_inbound_at = greatest(conversation.last_inbound_at, args.p_at);
          conversation.last_message_at = greatest(conversation.last_message_at, args.p_at);
          conversation.updated_at = greatest(conversation.updated_at, args.p_at);
        }
      }
      return { data: null, error: null };
    },
    __tables: tables,
    __rpcCalls: rpcCalls,
    __setRpcError(error: { message: string } | null) {
      rpcError = error;
    },
    /** Simula o código no ar antes da migration. */
    __setMissingColumns(...columns: string[]) {
      for (const col of columns) missingColumns.add(col);
    },
    /** Simula o índice único barrando a próxima inserção da tabela. */
    __failNextInsertAsDuplicate(table: string) {
      insertErrorOnce.set(table, { code: "23505", message: "duplicate key value violates unique constraint" });
    },
    /** Simula uma falha qualquer do banco na próxima inserção da tabela. */
    __failNextInsert(table: string, error: { code: string; message: string }) {
      insertErrorOnce.set(table, error);
    },
  };
}
