import { Skeleton } from "@/components/ui/skeleton";

export default function MediaLoading() {
  return (
    <div>
      <div className="px-6 pb-6 pt-7 md:px-8 md:pt-8">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>

      <div className="mx-auto max-w-4xl px-6 pb-10 md:px-8">
        <Skeleton className="mb-5 h-4 w-24" />
        <Skeleton className="mb-8 h-10 w-40" />

        <div className="overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border-subtle px-5 py-3.5 last:border-b-0">
              <Skeleton className="h-12 w-12 shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="mt-2 h-3 w-64" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
