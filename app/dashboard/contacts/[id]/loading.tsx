import { Skeleton } from "@/components/ui/skeleton";

export default function ContactDetailLoading() {
  return (
    <div className="px-6 pb-10 pt-7 md:px-8 md:pt-8">
      <Skeleton className="mb-4 h-4 w-24" />
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-20" />

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1 p-5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-4 h-4 w-40" />
          <Skeleton className="mt-3 h-4 w-40" />
        </div>
        <div className="rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
        </div>
      </div>
    </div>
  );
}
