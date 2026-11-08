import { rate, type Rate } from "./rates";

export type FunnelCounts = {
  comments_valid: number;
  requests_unique: number;
  requests_without_author: number;
  executions: number;
  first_dm: number;
  button: number;
  link_button: number;
  quick_reply_button: number;
};

export type FunnelStage = {
  key: "comments" | "requests" | "executions" | "first_dm" | "button";
  label: string;
  count: number;
  rate: Rate | null;
  rateCaption: string | null;
};

export type Funnel = {
  stages: FunnelStage[];
  pendingExecution: number;
  requestsWithoutAuthor: number;
  linkButton: number;
  quickReplyButton: number;
};

export function buildFunnel(c: FunnelCounts): Funnel {
  const executionRate: Rate =
    c.requests_unique > 0 && c.executions === 0
      ? { kind: "pending", pending: c.requests_unique }
      : rate(c.executions, c.requests_unique);

  return {
    stages: [
      { key: "comments", label: "Comentários válidos", count: c.comments_valid, rate: null, rateCaption: null },
      { key: "requests", label: "Pedidos únicos", count: c.requests_unique, rate: rate(c.requests_unique, c.comments_valid), rateCaption: "dos comentários" },
      { key: "executions", label: "Com execução iniciada", count: c.executions, rate: executionRate, rateCaption: "dos pedidos" },
      { key: "first_dm", label: "Primeira DM enviada", count: c.first_dm, rate: rate(c.first_dm, c.executions), rateCaption: "das execuções" },
      { key: "button", label: "Mensagem com botão enviada", count: c.button, rate: rate(c.button, c.first_dm), rateCaption: "das primeiras DMs" },
    ],
    pendingExecution: Math.max(0, c.requests_unique - c.executions),
    requestsWithoutAuthor: c.requests_without_author,
    linkButton: c.link_button,
    quickReplyButton: c.quick_reply_button,
  };
}

/** Cada par pessoa e post pertence a uma conta só, então somar contas não conta ninguém duas vezes. */
export function sumFunnel(rows: FunnelCounts[]): FunnelCounts {
  const total: FunnelCounts = {
    comments_valid: 0,
    requests_unique: 0,
    requests_without_author: 0,
    executions: 0,
    first_dm: 0,
    button: 0,
    link_button: 0,
    quick_reply_button: 0,
  };
  for (const row of rows) {
    total.comments_valid += row.comments_valid;
    total.requests_unique += row.requests_unique;
    total.requests_without_author += row.requests_without_author;
    total.executions += row.executions;
    total.first_dm += row.first_dm;
    total.button += row.button;
    total.link_button += row.link_button;
    total.quick_reply_button += row.quick_reply_button;
  }
  return total;
}

export type RawFunnelAccount = FunnelCounts & { social_account_id: string };
export type RawFunnelPost = RawFunnelAccount & {
  external_media_id: string;
  permalink: string | null;
  media_type: string | null;
  published_at: string | null;
};
export type RawFunnel = { posts_total: number; by_account: RawFunnelAccount[]; by_post: RawFunnelPost[] };
