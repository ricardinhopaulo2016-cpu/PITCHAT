import { Skeleton } from "@/components/ui/skeleton";

export default function SocialAccountsLoading() {
  return (
    <div className="px-6 pb-10 pt-7 md:px-8 md:pt-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-72" />

      <div className="mt-6 overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle">
        <Skeleton className="h-9 rounded-none" />
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-4 border-t border-border-subtle px-5 py-4">
            <Skeleton className="h-6 w-6 shrink-0" />
            <div className="flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-1.5 h-3 w-24" />
            </div>
            <Skeleton className="h-9 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
