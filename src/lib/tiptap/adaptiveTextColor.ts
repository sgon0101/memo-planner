import { Color } from '@tiptap/extension-color'

/**
 * 인라인 글자색 자동 대비 (adaptive text color)
 *
 * 배경: 외부(노션·네이버·워드 등)에서 서식째로 붙여넣으면 `color: rgb(48,48,56)`
 * 같은 near-black 인라인 색이 textStyle mark로 그대로 저장된다. 앱 규칙상
 * "사용자 글자색은 존중"이라 다크모드에서도 그 색을 그대로 그려 글자가 배경에
 * 묻혀 읽을 수 없었다.
 *
 * 해결: 색상 mark를 렌더할 때 배경 대비를 계산해 **읽을 수 없는 색에만**
 * `data-color-tone`(dark/light)과 보정색(`--tc-adapt`)을 함께 내보내고,
 * globals.css가 테마에 맞을 때만 보정색으로 교체한다. 원본 색은 `--tc`로 남겨
 * 형광펜 위처럼 배경이 다른 곳에서 되돌릴 수 있게 한다.
 *
 * 저장 데이터(content JSONB)는 건드리지 않는다 — 렌더 시점 보정이라
 * 기존 메모도 즉시 적용되고, 색을 되돌려도 원본이 그대로 남는다.
 */

// 판정 기준 배경 — 다크모드 본문 배경(#0F172A) / 라이트모드 본문 배경(#FFFFFF)
const DARK_BG: RGB = [15, 23, 42]
const LIGHT_BG: RGB = [255, 255, 255]

/* 임계값은 실측 대비로 잡았다 — 팔레트 기본색은 절대 건드리지 않으면서
   붙여넣기로 들어온 저대비 색만 잡히는 구간:
     다크 배경 대비  붙여넣은 rgb(6,95,212) 3.06 < [3.4] < 회색 #64748B 3.75 (팔레트 최저)
     라이트 배경 대비 흰색 #FFFFFF 1.00 < [1.5] < 노란색 #EAB308 1.92 (팔레트 최저) */
/** 다크 배경에서 이 대비 미만이면 "너무 어두운 색"으로 보고 밝게 보정 */
const DARK_MODE_MIN_CONTRAST = 3.4
/** 라이트 배경에서 이 대비 미만이면 "사실상 안 보이는 색"으로 보고 어둡게 보정 */
const LIGHT_MODE_MIN_CONTRAST = 1.5

/** 채도가 이보다 낮으면 무채색으로 보고 테마 기본 글자색으로 치환 */
const NEUTRAL_SATURATION = 0.12
const DARK_MODE_DEFAULT = '#F1F5F9'
const LIGHT_MODE_DEFAULT = '#1E293B'
/** 유채색은 색상(hue)·채도를 유지한 채 명도만 읽을 수 있는 구간으로 이동 */
const DARK_MODE_MIN_LIGHTNESS = 0.72
const LIGHT_MODE_MAX_LIGHTNESS = 0.38

type RGB = [number, number, number]

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  dimgray: '#696969',
  dimgrey: '#696969',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

function parseColor(input: string): RGB | null {
  const raw = input.trim().toLowerCase()
  if (!raw || raw === 'inherit' || raw === 'currentcolor' || raw === 'transparent') return null

  const value = NAMED_COLORS[raw] ?? raw

  if (value.startsWith('#')) {
    let hex = value.slice(1)
    // #rgb / #rgba → 각 자리를 2배로 확장, alpha는 대비 계산에서 무시
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .slice(0, 3)
        .split('')
        .map((c) => c + c)
        .join('')
    }
    if (hex.length === 8) hex = hex.slice(0, 6)
    if (!/^[0-9a-f]{6}$/.test(hex)) return null
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ]
  }

  const fn = value.match(/^rgba?\(([^)]+)\)$/)
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3)
    if (parts.length < 3) return null
    const nums = parts.map((p) =>
      p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p),
    )
    if (nums.some((n) => !Number.isFinite(n))) return null
    return [
      clamp(Math.round(nums[0]), 0, 255),
      clamp(Math.round(nums[1]), 0, 255),
      clamp(Math.round(nums[2]), 0, 255),
    ]
  }

  return null
}

/** WCAG 상대 휘도 */
function relativeLuminance([r, g, b]: RGB): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return [h, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }

  let r: number
  let g: number
  let b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue(p, q, h + 1 / 3)
    g = hue(p, q, h)
    b = hue(p, q, h - 1 / 3)
  }

  const toHex = (v: number) =>
    clamp(Math.round(v * 255), 0, 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export type ColorTone = 'dark' | 'light'

export interface AdaptiveColorResult {
  /** dark = 다크모드에서 읽을 수 없음 / light = 라이트모드에서 읽을 수 없음 */
  tone: ColorTone
  /** 해당 테마에서 대신 쓸 보정색 */
  adaptive: string
}

const cache = new Map<string, AdaptiveColorResult | null>()

/**
 * 색이 어느 테마에서 읽을 수 없는지 판정하고 보정색을 계산한다.
 * 양쪽 테마 모두에서 읽을 수 있는 색(팔레트 기본색 대부분)은 null → 원본 유지.
 */
export function analyzeTextColor(color: string): AdaptiveColorResult | null {
  const hit = cache.get(color)
  if (hit !== undefined) return hit

  let result: AdaptiveColorResult | null = null
  const rgb = parseColor(color)

  if (rgb) {
    const [h, s, l] = rgbToHsl(rgb)
    if (contrastRatio(rgb, DARK_BG) < DARK_MODE_MIN_CONTRAST) {
      result = {
        tone: 'dark',
        adaptive:
          s < NEUTRAL_SATURATION
            ? DARK_MODE_DEFAULT
            : hslToHex(h, s, Math.max(l, DARK_MODE_MIN_LIGHTNESS)),
      }
    } else if (contrastRatio(rgb, LIGHT_BG) < LIGHT_MODE_MIN_CONTRAST) {
      result = {
        tone: 'light',
        adaptive:
          s < NEUTRAL_SATURATION
            ? LIGHT_MODE_DEFAULT
            : hslToHex(h, s, Math.min(l, LIGHT_MODE_MAX_LIGHTNESS)),
      }
    }
  }

  cache.set(color, result)
  return result
}

/**
 * @tiptap/extension-color를 그대로 쓰되(name·commands·parseHTML 동일),
 * renderHTML만 감싸 대비 보정 정보를 함께 내보낸다.
 */
export const AdaptiveTextColor = Color.extend({
  addGlobalAttributes() {
    const groups = this.parent?.() ?? []

    return groups.map((group) => {
      const attributes = group.attributes as Record<string, unknown> | undefined
      if (!attributes || !('color' in attributes)) return group

      return {
        ...group,
        attributes: {
          ...attributes,
          color: {
            ...(attributes.color as Record<string, unknown>),
            renderHTML: (attrs: Record<string, unknown>) => {
              const value = attrs.color
              if (typeof value !== 'string' || !value) return {}

              const adapted = analyzeTextColor(value)
              if (!adapted) return { style: `color: ${value}` }

              return {
                style: `color: ${value}; --tc: ${value}; --tc-adapt: ${adapted.adaptive}`,
                'data-color-tone': adapted.tone,
              }
            },
          },
        },
      }
    })
  },
})
