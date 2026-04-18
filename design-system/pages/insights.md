# Design Override — AI Insights Page

> Inherits from MASTER.md. Only deviations listed here.

## Tab Navigation
- Active: `border-b-2 border-violet-600 text-violet-700 font-medium`
- Inactive: `text-gray-500 hover:text-gray-700`

## AI Chat
- User bubble: `bg-violet-600 text-white rounded-2xl rounded-br-sm`
- Assistant bubble: `bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-bl-sm`
- Streaming cursor: `inline-block w-1 h-4 bg-violet-500 animate-pulse`

## Bubble Chart (Interests)
- Bubble colors: use brand gradient (violet → cyan)
- Hover: scale(1.05) + shadow-md
- Label: `text-xs font-medium text-center`

## Gap Analysis
- Gap bar: `bg-red-100 dark:bg-red-900/20` fill `bg-red-500`
- Aligned bar: `bg-emerald-100 dark:bg-emerald-900/20` fill `bg-emerald-500`
- Score badge: rounded-full, size based on score (sm/md/lg)

## RetroReport
- Section headers: `text-lg font-semibold text-gray-900 dark:text-white`
- Stat cards: `bg-gradient-to-br from-violet-50 to-cyan-50 dark:from-violet-950/20 dark:to-cyan-950/20`
- Print button: `bg-white border border-gray-200 text-gray-700`
