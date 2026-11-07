/**
 * Personalização de texto de mensagem com o nome da pessoa.
 *
 * Token suportado: `{nome}` (primeiro nome). Sem nome confiável, o token some
 * junto com o conector antes dele ("Oi {nome}!" vira "Oi!", "Oi, {nome}!" vira
 * "Oi!"), então nenhuma mensagem sai com "{nome}" cru nem com buraco no texto.
 */

/**
 * Extrai o primeiro nome de `display_name`. Só devolve algo quando parece um
 * nome de verdade (letras, 2 a 20 caracteres); emoji, número, "Dr." ou campo
 * vazio viram null e a mensagem cai na versão sem nome.
 */
export function firstNameFrom(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.trim().split(/\s+/)[0] ?? "";
  if (!/^[\p{L}][\p{L}'’-]{1,19}$/u.test(first)) return null;
  const lower = first.toLocaleLowerCase("pt-BR");
  return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
}

export const NAME_TOKEN = "{nome}";

export function renderMessageText(text: string, firstName: string | null): string {
  if (!text.includes(NAME_TOKEN)) return text;
  if (firstName) return text.split(NAME_TOKEN).join(firstName);

  let out = text;
  // Token no começo ("{nome}, bora!"): remove token e vírgula, depois capitaliza.
  if (out.startsWith(NAME_TOKEN)) {
    out = out.slice(NAME_TOKEN.length).replace(/^[\s,]+/, "");
    out = out.charAt(0).toLocaleUpperCase("pt-BR") + out.slice(1);
  }
  // Token no meio: leva junto o espaço e/ou vírgula que vinham antes.
  out = out.replace(/\s*,?\s*\{nome\}/g, "");
  return out.replace(/ {2,}/g, " ");
}
