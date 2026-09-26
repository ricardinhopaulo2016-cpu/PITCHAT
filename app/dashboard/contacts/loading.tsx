import { Skeleton } from "@/components/ui/skeleton";

export default function ContactsLoading() {
  return (
    <div>
      <div className="px-6 pb-6 pt-7 md:px-8 md:pt-8">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>

      <div className="divide-y divide-border-subtle border-y border-border-subtle">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 md:px-5">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
