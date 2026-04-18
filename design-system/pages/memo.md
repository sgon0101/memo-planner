# Design Override — Memo Page

> Inherits from MASTER.md. Only deviations listed here.

## Layout
- FolderPanel: `w-56` (224px), `bg-white dark:bg-gray-950`
- MemoList: flex-1, `min-w-[280px] max-w-[340px]`
- Editor: flex-1, no max-width

## MemoCard
- Hover: `shadow-sm → shadow` transition 150ms
- Selected: `ring-2 ring-violet-500/30 bg-violet-50/30`
- Pinned badge: `bg-amber-100 text-amber-700`
- Starred: `text-amber-400`

## Editor
- Title input: `text-2xl font-bold` — 24px / weight 700
- Content font: `font-sans text-base leading-relaxed` — 16px / lh 1.75
- Toolbar: `sticky top-0 z-20 glass border-b`
- Save status dot: amber (unsaved) / green (saved) / violet spinner (saving)

## Colors
- Folder color picker: HSL wheel, saturation 60%, lightness 70-80%
- Trash bin: `text-red-400 hover:text-red-600`
