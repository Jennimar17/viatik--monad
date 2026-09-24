import { Skeleton } from '@/components/ui/skeleton'
import { PageSkeleton } from '@/components/viatik/feedback'
import { ViatikMark } from '@/components/viatik/viatik-logo'

/** First paint while the session and workspace load. Mirrors the shell layout. */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-svh" aria-busy="true">
      <aside className="glass-chrome hidden w-64 shrink-0 flex-col gap-6 border-r p-4 md:flex">
        <div className="flex items-center gap-2 px-1">
          <ViatikMark className="size-7" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-14 w-full rounded-xl" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
          ))}
        </div>
      </aside>
      <div className="flex-1">
        <div className="glass-chrome h-16 border-b" />
        <div className="mx-auto w-full max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8">
          <PageSkeleton />
        </div>
      </div>
    </div>
  )
}
