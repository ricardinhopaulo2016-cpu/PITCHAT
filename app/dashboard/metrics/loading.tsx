import { Skeleton } from "@/components/ui/skeleton";

export default function MetricsLoading() {
  return (
    <div>
      <div className="px-6 pb-7 pt-8 md:px-11 md:pt-9">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="mt-2 h-5 w-96 max-w-full" />
      </div>

      <div className="flex flex-col gap-4 px-6 pb-14 md:px-11">
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-28" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28 rounded-[var(--radius-panel-lg)]" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-[var(--radius-panel-lg)]" />
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-72 rounded-[var(--radius-panel-lg)]" />
          ))}
        </div>
      </div>
    </div>
  );
}
