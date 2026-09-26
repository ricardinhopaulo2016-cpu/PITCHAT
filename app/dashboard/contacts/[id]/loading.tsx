import { Skeleton } from "@/components/ui/skeleton";

export default function ContactDetailLoading() {
  return (
    <div className="max-w-3xl px-6 pb-10 pt-7 md:px-8 md:pt-8">
      <Skeleton className="mb-5 h-4 w-24" />

      <div className="flex items-center gap-4 pb-6">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>

      {[0, 1, 2].map((i) => (
        <div key={i} className="border-t border-border-subtle py-6">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="mt-3 h-4 w-48 max-w-full" />
        </div>
      ))}
    </div>
  );
}
