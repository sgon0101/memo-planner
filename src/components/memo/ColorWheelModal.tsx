'use client'

import { useState, useRef, useCallback } from 'react'
import { X } from 'lucide-react'

interface ColorWheelModalProps {
  showNameInput?: boolean
  initialName?: string
  initialH?: number
  initialS?: number
  initialL?: number
  onConfirm: (h: number, s: number, l: number, name?: string) => void
  onClose: () => void
}

const PRESETS = [
  { h: 260, s: 60, l: 75 },
  { h: 220, s: 65, l: 70 },
  { h: 190, s: 60, l: 65 },
  { h: 155, s: 55, l: 65 },
  { h: 45,  s: 85, l: 68 },
  { h: 25,  s: 80, l: 68 },
  { h: 0,   s: 70, l: 70 },
  { h: 330, s: 65, l: 72 },
  { h: 0,   s: 0,  l: 75 },
]

export default function ColorWheelModal({
  showNameInput = false,
  initialName = '',
  initialH = 260, initialS = 60, initialL = 80,
  onConfirm, onClose,
}: ColorWheelModalProps) {
  const [h, setH] = useState(initialH)
  const [s, setS] = useState(initialS)
  const [l, setL] = useState(initialL)
  const [name, setName] = useState(initialName)

  const wheelRef = useRef<HTMLDivElement>(null)

  const handleWheelClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = wheelRef.current!.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const dx = e.clientX - rect.left - cx
    const dy = e.clientY - rect.top - cy
    const angle = Math.atan2(dy, dx) * (180 / Math.PI)
    const hue = (angle + 360) % 360
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy) / cx, 1)
    setH(Math.round(hue))
    setS(Math.round(dist * 100))
  }, [])

  const preview = `hsl(${h}, ${s}%, ${l}%)`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 w-72 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {showNameInput ? '새 폴더' : '폴더 색상 선택'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        {/* 폴더 이름 입력 (신규 폴더 모드) */}
        {showNameInput && (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onConfirm(h, s, l, name.trim())
            }}
            placeholder="폴더 이름"
            autoFocus
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500"
          />
        )}

        {/* 컬러 휠 */}
        <div
          ref={wheelRef}
          className="relative w-44 h-44 mx-auto rounded-full cursor-crosshair"
          style={{
            background: `conic-gradient(
              hsl(0,${s}%,${l}%), hsl(30,${s}%,${l}%), hsl(60,${s}%,${l}%),
              hsl(90,${s}%,${l}%), hsl(120,${s}%,${l}%), hsl(150,${s}%,${l}%),
              hsl(180,${s}%,${l}%), hsl(210,${s}%,${l}%), hsl(240,${s}%,${l}%),
              hsl(270,${s}%,${l}%), hsl(300,${s}%,${l}%), hsl(330,${s}%,${l}%), hsl(360,${s}%,${l}%)
            )`,
          }}
          onClick={handleWheelClick}
        >
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, white 0%, transparent 70%)' }}
          />
          <div
            className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md pointer-events-none -translate-x-1/2 -translate-y-1/2"
            style={{
              background: preview,
              left: `${50 + (s / 100) * 50 * Math.cos((h * Math.PI) / 180)}%`,
              top:  `${50 + (s / 100) * 50 * Math.sin((h * Math.PI) / 180)}%`,
            }}
          />
        </div>

        {/* 명도 슬라이더 */}
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">밝기 {l}%</label>
          <input
            type="range" min={30} max={90} value={l}
            onChange={(e) => setL(Number(e.target.value))}
            className="w-full accent-violet-500"
            style={{ background: `linear-gradient(to right, hsl(${h},${s}%,30%), hsl(${h},${s}%,90%))` }}
          />
        </div>

        {/* 프리셋 */}
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">프리셋</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p, i) => (
              <button
                key={i}
                className="w-7 h-7 rounded-full border-2 border-transparent hover:scale-110 transition-transform"
                style={{
                  background: `hsl(${p.h},${p.s}%,${p.l}%)`,
                  borderColor: h === p.h && s === p.s ? 'white' : 'transparent',
                  outline: h === p.h && s === p.s ? '2px solid #7c3aed' : 'none',
                }}
                onClick={() => { setH(p.h); setS(p.s); setL(p.l) }}
              />
            ))}
          </div>
        </div>

        {/* 미리보기 + 확인 */}
        <div className="flex items-center gap-3 pt-1">
          <div className="w-8 h-8 rounded-lg flex-shrink-0 border border-gray-200 dark:border-gray-700" style={{ background: preview }} />
          <span className="text-xs text-gray-500 dark:text-gray-400 flex-1 font-mono">
            hsl({h}, {s}%, {l}%)
          </span>
          <button
            onClick={() => {
              if (showNameInput && !name.trim()) return
              onConfirm(h, s, l, showNameInput ? name.trim() : undefined)
            }}
            disabled={showNameInput && !name.trim()}
            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
          >
            {showNameInput ? '만들기' : '적용'}
          </button>
        </div>
      </div>
    </div>
  )
}
