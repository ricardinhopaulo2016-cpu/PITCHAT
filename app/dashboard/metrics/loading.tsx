import { Skeleton } from "@/components/ui/skeleton";

export default function MetricsLoading() {
  return (
    <div>
      <div className="flex items-start justify-between gap-4 px-6 pb-6 pt-7 md:px-11 md:pt-8">
        <div>
          <Skeleton className="h-7 w-28" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>

      <div className="flex flex-col gap-6 px-6 pb-14 md:px-11">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-40 rounded-[var(--radius-panel-lg)]" />
        ))}
      </div>
    </div>
  );
}
