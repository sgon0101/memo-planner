# MemoPlanner — Home Page Override

## Layout
- Max width: max-w-2xl mx-auto (tighter than 3xl for focus)
- Padding: px-4 py-10 sm:py-12
- Section gap: space-y-8

## Greeting
- Date: text-xs text-gray-400 tracking-wide uppercase
- Name: text-2xl font-bold text-gray-900 dark:text-white
- Emoji: allowed only in greeting text (not as UI icons)

## Stat Cards
- Grid: 3-col, gap-3
- Each: rounded-xl p-4 border bg-white dark:bg-gray-800 cursor-pointer
- Icon container: w-10 h-10 rounded-lg flex items-center justify-center
- Value: text-xl font-bold | Label: text-xs text-gray-500 mt-0.5

## Quick Memo Input
- rounded-2xl border, elevated shadow-sm
- Input: text-sm, no inner border, full-width
- Submit: icon-only button, violet bg

## Section Headers
- text-sm font-semibold text-gray-700 dark:text-gray-300
- "전체 보기" link: text-xs text-violet-600 hover:underline

## Recent Memo Rows
- hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-sm
- Title truncated 1 line | Preview truncated 1 line
- Time: text-xs text-gray-400 flex-shrink-0

## Week Plan Rows
- Left color dot (4px wide strip) matching plan color
- Completed: line-through opacity-50
