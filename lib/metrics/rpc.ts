export type RpcFailure = "missing" | "timeout" | "error";
export type RpcResult<T> = { status: "ok"; data: T } | { status: RpcFailure };

/** Função, tabela ou coluna inexistente: a migration ainda não foi aplicada. */
const MISSING_CODES = new Set(["PGRST202", "42883", "42P01", "42703"]);
const TIMEOUT_CODE = "57014";

export function classifyRpcError(error: { code?: string } | null | undefined): RpcFailure {
  const code = error?.code;
  if (code && MISSING_CODES.has(code)) return "missing";
  if (code === TIMEOUT_CODE) return "timeout";
  return "error";
}

export function hasMissing(results: RpcResult<unknown>[]): boolean {
  return results.some((result) => result.status === "missing");
}

export function resultData<T>(result: RpcResult<T>): T | null {
  return result.status === "ok" ? result.data : null;
}

/** Mais da metade das fontes sem dado: frases com o que sobrou enganariam. */
export function mostlyFailed(results: RpcResult<unknown>[]): boolean {
  return results.filter((result) => result.status !== "ok").length * 2 > results.length;
}
