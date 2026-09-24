import { Skeleton } from "@/components/ui/skeleton";

export default function ContactsLoading() {
  return (
    <div className="px-6 pb-10 pt-7 md:px-8 md:pt-8">
      <Skeleton className="h-7 w-28" />
      <Skeleton className="mt-2 h-4 w-96" />

      <div className="mt-6 overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-3.5 last:border-b-0">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
