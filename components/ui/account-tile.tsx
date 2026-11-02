import { accountIdentity } from "@/lib/ui/account-identity";

const SIZES = {
  sm: "h-6 w-6 rounded-[7px] text-[11px]",
  md: "h-8 w-8 rounded-[9px] text-xs",
  lg: "h-10 w-10 rounded-[11px] text-sm",
} as const;

/** Sigla e cor da conta. Decorativo: o @username sempre aparece ao lado, em texto. */
export function AccountTile({ username, size = "md" }: { username: string | null | undefined; size?: keyof typeof SIZES }) {
  const { initials, color } = accountIdentity(username);
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center font-bold text-[#0B0B0D] ${SIZES[size]}`} style={{ background: color }}>
      {initials}
    </span>
  );
}
