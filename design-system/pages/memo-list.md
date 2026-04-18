# MemoPlanner — Memo List Page Override

> Inherits from MASTER.md. Only deviations listed here.

## Layout
- Split panel: FolderPanel (left, fixed) + MemoList (right, scrollable)
- Header bar: folder name + new memo button (sticky top)
- Filter bar: sort chips + tag chips + month chips (horizontal scroll, no wrap)
- View modes: card grid (sm:2 lg:3 xl:4) | list (full-width rows) | timeline

## Cards
- Border: border-gray-200, hover:border-violet-200 dark:hover:border-violet-800
- Shadow: hover:shadow-sm (not default)
- Thumbnail: aspect-video, rounded-lg, object-cover (only when content has image)
- Locked state: centered Lock icon + "잠긴 메모" label, no content preview
- Pinned: Pin icon absolute top-right (text-violet-500)
- Starred: Star icon in actions row (fill-amber-400)

## Filter Chips
- Sort active: border-violet-500 bg-violet-50 text-violet-600
- Tag active: border-cyan-500 bg-cyan-50 text-cyan-600
- Month active: border-emerald-500 bg-emerald-50 text-emerald-600

## Skeleton (loading)
- 6-card grid with animate-pulse
- Show on initial load only
