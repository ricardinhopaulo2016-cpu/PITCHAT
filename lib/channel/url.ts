/**
 * Helpers puros de URL do Channel Filter (D1) — a URL é a ÚNICA fonte de
 * verdade (sem cookie/localStorage/Context), pra preservar SSR, deep link,
 * refresh, nova aba e Back/Forward. Funcionam com `URLSearchParams` (client,
 * `useSearchParams()`) ou um record simples (server, `searchParams` do
 * Next.js já resolvido).
 */

export const CHANNEL_PARAM = "channel";

export type ParamsInput = URLSearchParams | Record<string, string | undefined>;

function toSearchParams(input: ParamsInput): URLSearchParams {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) sp.set(key, value);
  }
  return sp;
}

export function buildHref(pathname: string, params: ParamsInput): string {
  const qs = toSearchParams(params).toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Href de um item do Channel Switcher: troca (ou remove) `channel` e, por
 * regra do D1 (troca manual nunca deixa uma thread fora do filtro
 * escolhido), remove `conversation`. Preserva os demais params (ex.:
 * `window` do Health).
 */
export function buildChannelSwitchHref(pathname: string, current: ParamsInput, channelId: string | null): string {
  const sp = toSearchParams(current);
  sp.delete("conversation");
  if (channelId) sp.set(CHANNEL_PARAM, channelId);
  else sp.delete(CHANNEL_PARAM);
  return buildHref(pathname, sp);
}

/** Link de navegação entre seções (Rail/MobileSidebar) — só propaga `channel`, nunca params específicos de outra página (conversation/window). */
export function withChannelQuery(href: string, channelId: string | null): string {
  return channelId ? `${href}?${CHANNEL_PARAM}=${encodeURIComponent(channelId)}` : href;
}

/** Remove só o `channel`, preservando os demais params — canonicaliza `?channel=all` e alimenta o estado "canal não encontrado". */
export function withoutChannelParam(pathname: string, current: ParamsInput): string {
  const sp = toSearchParams(current);
  sp.delete(CHANNEL_PARAM);
  return buildHref(pathname, sp);
}
