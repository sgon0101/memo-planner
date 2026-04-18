# MemoPlanner — Memo Editor Page Override

## Layout
- Full-height flex: Toolbar (top, sticky) + Editor area (flex-1 scroll) + SidePanel (right, collapsible)
- Max content width: 720px centered in editor area
- Top padding: pt-8 pb-16 for breathing room

## Title Input
- text-2xl font-bold, no border, full-width
- placeholder: "제목 없음" (text-gray-300)
- Divider: 1px border-b border-gray-100 dark:border-gray-800 after title

## Toolbar
- Height: h-11 (44px)
- Buttons: w-8 h-8 rounded text-sm (ToolBtn)
- Active: bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300
- Dividers: w-px h-5 bg-gray-200 dark:bg-gray-700

## Editor Content
- Font: Noto Sans KR, 16px, line-height 1.75
- Paragraph spacing: mb-0 (Tiptap default spacing)
- Heading sizes: h1=24px bold, h2=20px semibold, h3=18px semibold

## Side Panel
- Width: 220px
- Collapsible with smooth width transition
- Search input at top
- Memo list: compact list rows with hover state

## Save Status Badge
- idle: hidden
- unsaved: amber dot + "저장 안 됨"
- saving: spinner + "저장 중..."
- saved: green check + "저장됨" (auto-hide 2s)
