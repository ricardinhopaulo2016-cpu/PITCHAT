import { Skeleton } from "@/components/ui/skeleton";

export default function InboxLoading() {
  return (
    <div>
      <div className="px-6 pb-6 pt-7 md:px-8 md:pt-8">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>

      <div className="grid grid-cols-1 gap-0 border-t border-border-subtle md:grid-cols-[280px_1fr] lg:grid-cols-[280px_1fr_280px]">
        <div className="hidden flex-col gap-0 border-border-subtle md:flex md:border-r">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col gap-2 border-b border-border-subtle px-4 py-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
        <div className="hidden flex-col items-center justify-center gap-2 p-6 md:flex">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="hidden lg:block" />
      </div>
    </div>
  );
}
