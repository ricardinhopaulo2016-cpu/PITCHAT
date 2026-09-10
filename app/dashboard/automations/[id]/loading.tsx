import { Skeleton } from "@/components/ui/skeleton";

export default function AutomationEditorLoading() {
  return (
    <div>
      <div className="px-6 pb-5 pt-7 md:px-8 md:pt-8">
        <Skeleton className="mb-4 h-4 w-28" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-2 h-4 w-40" />
      </div>
      <div className="grid grid-cols-1 gap-0 border-t border-border-subtle md:grid-cols-[1fr_260px]">
        <div className="flex flex-col gap-4 px-6 py-6 md:border-r md:border-border-subtle md:px-8">
          <Skeleton className="h-16" />
          <Skeleton className="h-24" />
          <Skeleton className="h-16" />
        </div>
        <div className="px-6 py-6">
          <Skeleton className="h-20" />
        </div>
      </div>
    </div>
  );
}
