# Design Override — Planner Page

> Inherits from MASTER.md. Only deviations listed here.

## Calendar Grid
- Today cell: `bg-violet-600 text-white` circle (w-6 h-6 rounded-full)
- Selected date: `bg-violet-50/60 dark:bg-violet-950/20`
- Weekend Sun: `text-red-400`, Sat: `text-blue-400`
- Out-of-month: `text-gray-300 dark:text-gray-700 bg-gray-50/60`

## Plan Blocks (inline)
- Background: `{plan.color}22` (10% opacity hex)
- Left border: `border-l-2 border-{plan.color}`
- Text: `{plan.color}` with truncate
- Completed: `opacity-50 line-through`

## Week/Day View
- Hour height: 60px grid
- Current time line: `bg-red-500` with circle dot (w-2 h-2)
- Time label: `text-xs text-gray-400`
- Column hover: subtle `bg-gray-50/50 dark:bg-gray-800/30`

## PlanPanel (sidebar)
- Width: 320px desktop, full-width mobile bottom-sheet
- Header: date title + "새 플랜" button (`bg-violet-600 text-white`)
- Plan item: left `border-l-4 border-{color}` card

## Colors for plans (preset)
```
#7F77DD #3B82F6 #10B981 #F59E0B
#EF4444 #EC4899 #8B5CF6 #6B7280
```
