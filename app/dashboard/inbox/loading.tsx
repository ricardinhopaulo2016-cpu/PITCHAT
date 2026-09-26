import { Skeleton } from "@/components/ui/skeleton";

export default function InboxLoading() {
  return (
    <div>
      <div className="px-6 pb-6 pt-7 md:px-8 md:pt-8">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>

      <div className="grid h-[calc(100dvh-14rem)] min-h-[28rem] grid-cols-1 overflow-hidden border-t border-border-subtle md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)_300px] 2xl:grid-cols-[340px_minmax(0,1fr)_340px]">
        {/* lista: avatar + duas linhas, igual ConversationRow */}
        <div className="flex flex-col border-border-subtle md:border-r">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-3 border-b border-border-subtle px-4 py-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>

        {/* thread: header + spine com linhas de texto */}
        <div className="hidden flex-col border-border-subtle md:flex lg:border-r">
          <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex flex-col gap-6 px-5 py-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-[20px_1fr] gap-x-3">
                <Skeleton className="mt-1 h-3 w-3 justify-self-center" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="hidden p-5 lg:block">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
      </div>
    </div>
  );
}
