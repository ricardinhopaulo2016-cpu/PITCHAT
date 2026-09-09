import type { SupabaseClient } from "@supabase/supabase-js";
import type { Graph } from "./graph";

/**
 * Helpers de persistência compartilhados pelas rotas de CRUD de automação.
 * Toda query aqui já espera que quem chamou validou `workspace_id` — nenhuma
 * função aqui aceita workspaceId implícito, sempre explícito (ver
 * AGENTS.md: rotas server-side usam service_role e por isso precisam
 * validar workspace_id manualmente).
 */

export type AutomationVersionRow = {
  id: string;
  automation_id: string;
  version: number;
  status: "draft" | "published" | "archived";
  graph: Graph;
  created_at: string;
  published_at: string | null;
};

/** Automação pertence ao workspace? Retorna a linha (com profile_id) ou null. */
export async function loadAutomationForWorkspace(
  admin: SupabaseClient,
  automationId: string,
  workspaceId: string
) {
  const { data } = await admin
    .from("automations")
    .select("id, workspace_id, profile_id, name, description, status, current_version_id")
    .eq("id", automationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data;
}

/** A versão em edição (status='draft') da automação, se existir. */
export async function loadDraftVersion(
  admin: SupabaseClient,
  automationId: string
): Promise<AutomationVersionRow | null> {
  const { data } = await admin
    .from("automation_versions")
    .select("id, automation_id, version, status, graph, created_at, published_at")
    .eq("automation_id", automationId)
    .eq("status", "draft")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as AutomationVersionRow | null;
}

export async function loadVersionById(admin: SupabaseClient, versionId: string): Promise<AutomationVersionRow | null> {
  const { data } = await admin
    .from("automation_versions")
    .select("id, automation_id, version, status, graph, created_at, published_at")
    .eq("id", versionId)
    .maybeSingle();
  return data as AutomationVersionRow | null;
}

/**
 * Garante que existe uma versão 'draft' pra editar: reaproveita a que já
 * existir, ou cria uma nova clonando o grafo da versão publicada mais
 * recente (ou um grafo vazio, se a automação nunca foi publicada).
 */
export async function ensureDraftVersion(
  admin: SupabaseClient,
  automationId: string,
  emptyGraph: Graph
): Promise<AutomationVersionRow> {
  const existingDraft = await loadDraftVersion(admin, automationId);
  if (existingDraft) return existingDraft;

  const { data: lastVersion } = await admin
    .from("automation_versions")
    .select("version, graph")
    .eq("automation_id", automationId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (lastVersion?.version ?? 0) + 1;
  const baseGraph = (lastVersion?.graph as Graph | undefined) ?? emptyGraph;

  const { data: created, error } = await admin
    .from("automation_versions")
    .insert({ automation_id: automationId, version: nextVersion, status: "draft", graph: baseGraph as never })
    .select("id, automation_id, version, status, graph, created_at, published_at")
    .single();

  if (error || !created) throw new Error(`Falha ao criar versão draft: ${error?.message}`);
  return created as AutomationVersionRow;
}
