import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getGraphApiVersion } from "./api-version";

/**
 * Instagram API with Instagram Login — fluxo OAuth completo. Endpoints e
 * formato de resposta confirmados via documentação oficial (ver
 * docs/PITCHAT_META_INTEGRATION.md §1).
 *
 * ATENÇÃO — achado real testando contra o app de produção (10/09/2026,
 * erro "Invalid platform app"): o client_id/client_secret usados em TODO
 * este fluxo (authorize, troca de code, exchange pra long-lived) são o
 * **Instagram App ID / Instagram App Secret** — exibidos em App Dashboard →
 * Instagram → API setup with Instagram login → Business login settings —
 * e são DIFERENTES do Meta App ID/Secret "principal" (App settings → Basic).
 * Confirmado literalmente na doc oficial (business-login): "Your app's
 * Instagram App ID displayed in App Dashboard > Instagram > API setup with
 * Instagram login > ... > Instagram App ID" — usado tanto no authorize
 * quanto no token exchange. O Meta App ID/Secret "principal" continua sendo
 * usado só pra webhook (X-Hub-Signature-256, ver lib/meta/signature.ts) e
 * subscriptions a nível de app — não pra OAuth.
 */

const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
].join(",");

export type MetaOAuthConfig = {
  instagramAppId: string;
  instagramAppSecret: string;
  redirectUri: string;
};

export function getMetaOAuthConfig(): MetaOAuthConfig | null {
  const instagramAppId = process.env.INSTAGRAM_APP_ID;
  const instagramAppSecret = process.env.INSTAGRAM_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;
  if (!instagramAppId || !instagramAppSecret || !redirectUri) return null;
  return { instagramAppId, instagramAppSecret, redirectUri };
}

/** Monta a URL pra onde o usuário é mandado pra autorizar o PITCHAT. */
export function buildAuthorizationUrl(config: MetaOAuthConfig, state: string): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", config.instagramAppId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

export type ShortLivedTokenResult = {
  accessToken: string;
  userId: string;
  permissions: string[];
};

/**
 * Bug real de produção (10/09/2026): a API retorna `permissions` como ARRAY
 * de verdade (`["instagram_business_basic", ...]`), não como string separada
 * por vírgula — `entry.permissions.split(",")` no callback quebrava com
 * "e.permissions.split is not a function". Normaliza na fronteira (aqui),
 * nunca espalha tratamento defensivo pelo caller.
 */
export function normalizePermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === "string");
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return [];
}

/** Troca o `code` (válido 1h, uso único) por um short-lived access token. */
export async function exchangeCodeForShortLivedToken(
  config: MetaOAuthConfig,
  code: string
): Promise<ShortLivedTokenResult> {
  const body = new URLSearchParams({
    client_id: config.instagramAppId,
    client_secret: config.instagramAppSecret,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });

  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Falha ao trocar code por token: HTTP ${res.status}`);
  }

  const json = await res.json();
  const entry = json.data?.[0] ?? json; // doc mostra resposta como {data: [...]}
  return {
    accessToken: entry.access_token,
    userId: entry.user_id,
    permissions: normalizePermissions(entry.permissions),
  };
}

export type LongLivedTokenResult = {
  accessToken: string;
  expiresAt: Date;
};

/** short-lived -> long-lived (60 dias). Server-side only (usa o Instagram App Secret). */
export async function exchangeForLongLivedToken(
  config: MetaOAuthConfig,
  shortLivedToken: string
): Promise<LongLivedTokenResult> {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config.instagramAppSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Falha no exchange pra long-lived token: HTTP ${res.status}`);

  const json = await res.json();
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
  };
}

/**
 * Renova um long-lived token — só funciona se ele tiver pelo menos 24h de
 * idade e ainda não tiver expirado. Passado os 60 dias sem renovar, precisa
 * refazer o OAuth do zero (não tem como recuperar).
 */
export async function refreshLongLivedToken(currentToken: string): Promise<LongLivedTokenResult> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", currentToken);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Falha ao renovar token: HTTP ${res.status}`);

  const json = await res.json();
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
  };
}

export async function fetchInstagramProfile(
  accessToken: string,
  userId: string
): Promise<{ username: string | null }> {
  // Lookup de nó da Graph API — ao contrário dos endpoints de token acima
  // (esses não levam versão, confirmado na doc oficial), este segue o padrão
  // versionado normal (mesmo formato usado pra IG-Comment, ver
  // docs/PITCHAT_META_INTEGRATION.md §3).
  const url = new URL(`https://graph.instagram.com/${getGraphApiVersion()}/${userId}`);
  url.searchParams.set("fields", "username");
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString());
  if (!res.ok) return { username: null };
  const json = await res.json();
  return { username: json.username ?? null };
}

/** Token precisa renovar quando faltar menos de N dias pra expirar (default 10). */
export function needsRefresh(expiresAt: Date, thresholdDays = 10): boolean {
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  return expiresAt.getTime() - Date.now() < thresholdMs;
}

// --- CSRF state assinado (evita depender de sessão de servidor pro callback) ---

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 min é de sobra pro usuário autorizar na Meta

type StatePayload = { workspaceId: string; profileId: string; nonce: string; ts: number };

function signStatePayload(payload: StatePayload, secret: string): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function buildOAuthState(workspaceId: string, profileId: string, secret: string): string {
  return signStatePayload({ workspaceId, profileId, nonce: randomUUID(), ts: Date.now() }, secret);
}

export function verifyOAuthState(
  state: string,
  secret: string
): { workspaceId: string; profileId: string } | null {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) return null;

  const expectedSignature = createHmac("sha256", secret).update(encoded).digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as StatePayload;
    if (Date.now() - payload.ts > STATE_MAX_AGE_MS) return null; // expirado
    return { workspaceId: payload.workspaceId, profileId: payload.profileId };
  } catch {
    return null;
  }
}
