import { Skeleton } from "@/components/ui/skeleton";

export default function HealthLoading() {
  return (
    <div>
      <div className="flex items-start justify-between gap-4 px-6 pb-6 pt-7 md:px-8 md:pt-8">
        <div>
          <Skeleton className="h-7 w-20" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>

      <div className="flex flex-col gap-6 px-6 pb-10 md:px-8">
        <div className="overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-3 last:border-b-0">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-[var(--radius-panel-lg)]" />
          ))}
        </div>
      </div>
    </div>
  );
}
