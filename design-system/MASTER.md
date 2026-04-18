# MemoPlanner — Design System MASTER

> Generated via ui-ux-pro-max skill analysis
> Product Type: Productivity Tool (Personal)
> Style: Flat Design + Micro-interactions
> Reference: Notion + Craft + Reflect

---

## 1. Product Identity

| Attribute | Value |
|---|---|
| Product Type | Personal Productivity Tool |
| Style | Flat Design + Micro-interactions |
| Dashboard Style | Drill-Down Analytics |
| Anti-patterns | gradient abuse, excessive shadows, neon colors, inconsistent radii |

---

## 2. Color System

### Brand Palette
- Primary:        #7C3AED  (violet-700)
- Primary Hover:  #6D28D9  (violet-800)
- Primary Light:  #8B5CF6  (violet-500)
- Primary Subtle: #EDE9FE  (violet-100)
- Accent (AI):    #06B6D4  (cyan-500)

### Semantic
- Success: #10B981 | Warning: #F59E0B | Error: #EF4444 | Info: #3B82F6

### Graph Nodes
- Memo: #7C3AED | Wiki Hub: #10B981 | Tag Hub: #3B82F6 | Starred: #F59E0B

### Light Surface
- bg: #FAFAFA | surface: #FFFFFF | border: #E2E8F0 | text: #1E293B | muted: #64748B

### Dark Surface
- bg: #0F172A | surface: #1E293B | border: #334155 | text: #F1F5F9 | muted: #94A3B8

---

## 3. Typography

- UI Font: Noto Sans KR (300/400/500/600/700)
- Mono Font: JetBrains Mono
- Scale: 12/14/16/18/20/24px | Line-height: 1.5–1.75
- Heading tracking: -0.01em | Label tracking: 0.02em

---

## 4. Spacing & Radius

- Card: p-4 | Modal: p-6 | Grid: gap-3 | List: gap-2
- Button: rounded-lg (8px) | Card: rounded-xl (12px) | Modal: rounded-2xl (16px) | Badge: rounded-full

---

## 5. Component Tokens

### Sidebar Active State
- border-l-2 border-violet-600 bg-violet-50 text-violet-700
- dark: bg-violet-950/40 text-violet-300

### Buttons
- Primary: bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 text-sm font-medium
- Secondary: border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg px-4 py-2 text-sm
- Danger: bg-red-500 hover:bg-red-600 text-white rounded-lg px-4 py-2 text-sm font-medium
- Min touch: 44x44px

### Cards
- Base: bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700
- Hover: hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-sm transition-all duration-200

### Toast
- Success/Error/Warning/Info with matching bg-50/border/text color tokens

---

## 6. Animation
- Micro: 150ms ease-out | Transition: 200ms ease-out | Modal: 250ms cubic-bezier(0.16,1,0.3,1)
- GPU: transform + opacity only | prefers-reduced-motion: disable all

---

## 7. Accessibility
- Contrast: WCAG AA 4.5:1 | Focus: 2px violet-600 ring | Touch: 44px min | Icons: aria-label

---

## 8. Anti-patterns
- No gradients on buttons | No shadow > 0 8px 32px | No font < 12px
- No contrast < 4.5:1 | No neon colors | No transition > 300ms
