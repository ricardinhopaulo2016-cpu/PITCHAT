import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="px-6 pb-10 pt-7 md:px-8 md:pt-8">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-4 w-64" />

      <div className="mt-6 flex divide-x divide-border-subtle rounded-[var(--radius-panel-lg)] border border-border-subtle">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex-1 px-5 py-4">
            <Skeleton className="h-7 w-10" />
            <Skeleton className="mt-2 h-3.5 w-24" />
          </div>
        ))}
      </div>

      <div className="mt-7 grid grid-cols-1 gap-7 lg:grid-cols-[1.2fr_1fr]">
        <Skeleton className="h-64" />
        <div className="flex flex-col gap-7">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    </div>
  );
}
