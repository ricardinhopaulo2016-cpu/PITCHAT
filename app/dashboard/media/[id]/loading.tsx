import { Skeleton } from "@/components/ui/skeleton";

export default function MediaAssetDetailLoading() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mb-4 mt-3 h-6 w-64" />
      <Skeleton className="mb-6 h-64 w-full" />
      <div className="divide-y divide-border-subtle">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex justify-between gap-4 py-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </main>
  );
}
