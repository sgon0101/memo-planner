# 나만의 메모 플래너 — Design System MASTER

> Source of Truth for all UI/UX decisions.
> Generated via ui-ux-pro-max skill · Stack: Next.js + Tailwind CSS v4

---

## 1. Design Philosophy

| Attribute | Value |
|-----------|-------|
| Style | Minimal Swiss + Soft UI Evolution |
| Product Type | Productivity SaaS + AI Platform |
| Target Users | Personal productivity, Korean-speaking |
| Core Principle | Focus, Clarity, Calm productivity |

**Anti-patterns to avoid:**
- Heavy gradients or glow effects
- Excessive animations (> 300ms)
- Color as sole information carrier
- Emoji icons (use Lucide SVG)
- Horizontal scroll on any viewport

---

## 2. Color Palette

### Primary — Violet (Brand)
| Token | Light | Dark | Tailwind |
|-------|-------|------|----------|
| `--color-primary` | `#7C3AED` | `#8B5CF6` | `violet-700 / violet-500` |
| `--color-primary-hover` | `#6D28D9` | `#7C3AED` | `violet-800 / violet-700` |
| `--color-primary-light` | `#8B5CF6` | `#A78BFA` | `violet-500 / violet-400` |
| `--color-primary-muted` | `#EDE9FE` | `#4C1D95/40` | `violet-100 / violet-900/40` |
| `--color-primary-text` | `#5B21B6` | `#C4B5FD` | `violet-800 / violet-300` |

### Accent — Cyan (AI Interactions / CTA)
| Token | Light | Dark | Tailwind |
|-------|-------|------|----------|
| `--color-accent` | `#06B6D4` | `#22D3EE` | `cyan-500 / cyan-400` |
| `--color-accent-hover` | `#0891B2` | `#06B6D4` | `cyan-600 / cyan-500` |
| `--color-accent-muted` | `#ECFEFF` | `#164E63/40` | `cyan-50 / cyan-900/40` |

### Semantic
| Token | Value | Usage |
|-------|-------|-------|
| `--color-success` | `#10B981` | 저장됨, 완료 |
| `--color-warning` | `#F59E0B` | 미저장, 주의 |
| `--color-error` | `#EF4444` | 오류, 삭제 |
| `--color-info` | `#3B82F6` | 정보, 링크 |

### Backgrounds
| Token | Light | Dark |
|-------|-------|------|
| `--color-bg` | `#FAFAFA` | `#0F172A` |
| `--color-surface` | `#FFFFFF` | `#1E293B` |
| `--color-surface-2` | `#F8FAFC` | `#334155` |
| `--color-surface-hover` | `#F1F5F9` | `#475569` |

### Text
| Token | Light | Dark |
|-------|-------|------|
| `--color-text` | `#1E293B` | `#F1F5F9` |
| `--color-text-muted` | `#64748B` | `#94A3B8` |
| `--color-text-subtle` | `#94A3B8` | `#64748B` |
| `--color-text-disabled` | `#CBD5E1` | `#475569` |

### Borders
| Token | Light | Dark |
|-------|-------|------|
| `--color-border` | `#E2E8F0` | `#334155` |
| `--color-border-strong` | `#CBD5E1` | `#475569` |

---

## 3. Typography

### Font Stack
| Role | Font | Fallback | Import |
|------|------|----------|--------|
| UI / Body | Noto Sans KR | system-ui, sans-serif | next/font/google |
| Code / Mono | JetBrains Mono | monospace | next/font/google |

### Scale
| Token | Size | Line Height | Weight | Usage |
|-------|------|-------------|--------|-------|
| `text-xs` | 12px | 1.6 | 400 | 레이블, 배지, 메타 |
| `text-sm` | 14px | 1.6 | 400/500 | 본문 보조, 버튼 |
| `text-base` | 16px | 1.7 | 400 | 본문 (최소 크기) |
| `text-lg` | 18px | 1.6 | 500/600 | 소제목 |
| `text-xl` | 20px | 1.5 | 600 | 제목 중 |
| `text-2xl` | 24px | 1.4 | 700 | 에디터 제목 |
| `text-3xl` | 30px | 1.3 | 700 | 페이지 제목 |

### Rules
- Body text minimum: **16px** (mobile accessibility)
- Line length: **65–75 characters** (readable-font-size)
- Heading weight: **600–700**
- No text below `text-xs` (12px) for interactive labels

---

## 4. Spacing & Layout

### Base Grid: 4px
```
space-1 = 4px   space-2 = 8px   space-3 = 12px  space-4 = 16px
space-5 = 20px  space-6 = 24px  space-8 = 32px  space-10 = 40px
space-12 = 48px space-16 = 64px
```

### Border Radius
| Token | Value | Usage |
|-------|-------|-------|
| `rounded-sm` | 4px | 배지, 태그 |
| `rounded` | 6px | 인풋, 작은 버튼 |
| `rounded-lg` | 8px | 카드, 버튼 |
| `rounded-xl` | 12px | 모달, 패널 |
| `rounded-2xl` | 16px | 큰 카드, 바텀시트 |
| `rounded-full` | 9999px | 아바타, 토글 |

### Shadows (Soft UI Evolution)
| Token | Value | Usage |
|-------|-------|-------|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | 기본 카드 |
| `shadow` | `0 2px 8px rgba(0,0,0,0.08)` | 호버 카드, 드롭다운 |
| `shadow-md` | `0 4px 16px rgba(0,0,0,0.10)` | 모달, 팝업 |
| `shadow-lg` | `0 8px 32px rgba(0,0,0,0.12)` | 사이드 패널 |

---

## 5. Component Styles

### Button
```
primary:   bg-violet-700 hover:bg-violet-800 text-white font-medium rounded-lg px-4 py-2 transition-colors duration-150
secondary: bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium rounded-lg px-4 py-2
ghost:     hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 rounded-lg px-3 py-1.5
danger:    bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg px-4 py-2
```

### Input
```
base: w-full px-3.5 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700
      bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none
      focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-shadow duration-150
```

### Card
```
base: bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800
      shadow-sm hover:shadow transition-shadow duration-150 cursor-pointer
```

### Badge
```
default:  bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs px-2 py-0.5 rounded-full
primary:  bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs px-2 py-0.5 rounded-full
success:  bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs px-2 py-0.5 rounded-full
warning:  bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs px-2 py-0.5 rounded-full
error:    bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs px-2 py-0.5 rounded-full
```

### Sidebar
```
width: 240px (desktop), 100vw (mobile)
bg: bg-white dark:bg-gray-950 border-r border-gray-100 dark:border-gray-800
item: px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors duration-150
item-active: bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 font-medium
item-hover: hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300
```

### Modal
```
overlay: fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm
panel: bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 w-full max-w-md
```

---

## 6. Motion & Animation

| Duration | Use Case |
|----------|----------|
| 100ms | Hover color change |
| 150ms | Button press, focus |
| 200ms | Dropdown appear |
| 300ms | Modal slide-in |
| 400ms | Page transition |

**Easing**: `ease-out` for entrances, `ease-in` for exits, `ease-in-out` for continuous
**GPU**: Always use `transform` and `opacity`, never `width`/`height`
**Reduced motion**: Always wrap animations in `@media (prefers-reduced-motion: no-preference)`

---

## 7. Accessibility

- All interactive elements: minimum **44×44px** touch target
- Focus ring: `outline-2 outline-violet-500 outline-offset-2`
- Color contrast: **4.5:1** minimum (WCAG AA), **7:1** for small text
- All icon-only buttons: `aria-label` required
- Form inputs: always paired with `<label>`
- Loading states: `aria-live="polite"` or spinner with `aria-label`

---

## 8. Dark Mode

- Toggle via `.dark` class on `<html>` (Tailwind v4 `@custom-variant`)
- All surfaces: explicit `dark:` variant
- No pure black (`#000`) backgrounds — use `gray-900` / `gray-950`
- Light mode glass: `bg-white/90` minimum opacity
- Dark mode glass: `bg-gray-900/80` minimum opacity

---

## 9. Z-Index Scale

| Layer | Value | Usage |
|-------|-------|-------|
| Base | 0 | Normal content |
| Dropdown | 10 | Select, combobox |
| Sticky | 20 | Sticky header/toolbar |
| Overlay | 30 | Modal backdrop |
| Modal | 40 | Modal panel |
| Toast | 50 | Toast notifications |
| Tooltip | 60 | Tooltips |

---

## 10. Page-Specific Rules

See `design-system/pages/` for overrides per page:
- `memo.md` — Memo editor, sidebar, card list
- `planner.md` — Calendar, week/day views
- `insights.md` — Charts, AI chat, bubble map
