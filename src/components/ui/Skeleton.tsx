import { cn } from '@/lib/utils'

function Pulse({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded bg-gray-200 dark:bg-gray-700', className)} />
  )
}

export function MemoCardSkeleton() {
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-2.5">
      <Pulse className="h-4 w-3/4" />
      <Pulse className="h-3 w-full" />
      <Pulse className="h-3 w-2/3" />
      <div className="flex gap-2 pt-1">
        <Pulse className="h-3 w-12 rounded-full" />
        <Pulse className="h-3 w-12 rounded-full" />
      </div>
    </div>
  )
}

export function MemoListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <MemoCardSkeleton key={i} />
      ))}
    </div>
  )
}

export function EditorSkeleton() {
  return (
    <div className="flex flex-col flex-1 px-8 py-6 space-y-4">
      <Pulse className="h-8 w-1/2" />
      <Pulse className="h-4 w-full" />
      <Pulse className="h-4 w-5/6" />
      <Pulse className="h-4 w-4/6" />
      <Pulse className="h-4 w-full" />
      <Pulse className="h-4 w-3/5" />
    </div>
  )
}

export function CalendarSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between items-center mb-4">
        <Pulse className="h-6 w-32" />
        <Pulse className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <Pulse key={i} className="h-5 w-full" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, row) => (
        <div key={row} className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, col) => (
            <Pulse key={col} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function GraphSkeleton() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="relative w-64 h-64">
        {[
          { cx: '50%', cy: '20%', r: 24 },
          { cx: '20%', cy: '60%', r: 16 },
          { cx: '80%', cy: '60%', r: 20 },
          { cx: '40%', cy: '80%', r: 14 },
          { cx: '70%', cy: '40%', r: 12 },
        ].map((c, i) => (
          <div
            key={i}
            className="absolute animate-pulse rounded-full bg-violet-200 dark:bg-violet-900/40"
            style={{
              left: `calc(${c.cx} - ${c.r}px)`,
              top: `calc(${c.cy} - ${c.r}px)`,
              width: c.r * 2,
              height: c.r * 2,
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function InsightsSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <Pulse className="h-6 w-40" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Pulse key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Pulse className="h-40 rounded-xl" />
    </div>
  )
}
