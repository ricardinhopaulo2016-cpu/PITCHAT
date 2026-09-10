import { Skeleton } from "@/components/ui/skeleton";

export default function AutomationsLoading() {
  return (
    <div className="px-6 pb-10 pt-7 md:px-8 md:pt-8">
      <Skeleton className="h-8 w-44" />
      <Skeleton className="mt-2 h-4 w-80" />

      <Skeleton className="mt-6 h-16" />

      <div className="mt-6 overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border-subtle px-5 py-4 last:border-b-0">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
