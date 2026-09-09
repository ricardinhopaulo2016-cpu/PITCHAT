/**
 * Bloqueia o node HTTP_REQUEST de bater em rede interna/local — sem isso,
 * uma automação poderia ser usada pra escanear a rede interna do host ou
 * acessar endpoints de metadata de cloud (169.254.169.254 etc).
 */

const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0"]);

// Ranges privados/reservados relevantes (IPv4). Suficiente pro node
// HTTP_REQUEST — não precisa ser um parser de CIDR genérico.
function isPrivateIPv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];

  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local / metadata cloud
  if (a === 0) return true; // 0.0.0.0/8

  return false;
}

export type SsrfCheckResult = { allowed: true } | { allowed: false; reason: string };

export function checkUrlAllowed(rawUrl: string): SsrfCheckResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "URL inválida" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { allowed: false, reason: `Protocolo não permitido: ${url.protocol}` };
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { allowed: false, reason: "Host bloqueado (rede local)" };
  }

  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return { allowed: false, reason: "Host bloqueado (domínio interno)" };
  }

  if (isPrivateIPv4(hostname)) {
    return { allowed: false, reason: "IP bloqueado (rede privada/reservada)" };
  }

  // IPv6 loopback/link-local em qualquer notação comum.
  if (hostname === "::1" || hostname.startsWith("fe80:") || hostname.startsWith("[::1]")) {
    return { allowed: false, reason: "IP bloqueado (rede privada/reservada)" };
  }

  return { allowed: true };
}
