'use client'

import { useGraphStore } from '@/store/graphStore'
import { useFolderStore } from '@/store/folderStore'

interface Props {
  onReset: () => void
}

function Slider({ label, min, max, value, onChange }: {
  label: string; min: number; max: number; value: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-violet-500"
      />
    </div>
  )
}

export default function GraphSettings({ onReset }: Props) {
  const { settings, setSettings } = useGraphStore()
  const { folders } = useFolderStore()

  return (
    <div className="w-60 flex-shrink-0 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 overflow-y-auto flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">그래프 설정</p>
      </div>

      <div className="flex-1 px-4 py-3 space-y-5 overflow-y-auto">
        {/* 슬라이더 */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">시뮬레이션</p>
          <Slider label="노드 크기" min={6} max={28} value={settings.nodeSize} onChange={(v) => setSettings({ nodeSize: v })} />
          <Slider label="링크 두께" min={1} max={6} value={settings.linkWidth} onChange={(v) => setSettings({ linkWidth: v })} />
          <Slider label="장력" min={1} max={10} value={settings.tension} onChange={(v) => setSettings({ tension: v })} />
          <Slider label="반발력" min={1} max={10} value={settings.repulsion} onChange={(v) => setSettings({ repulsion: v })} />
          <Slider label="링크 거리" min={40} max={200} value={settings.linkDistance} onChange={(v) => setSettings({ linkDistance: v })} />
          <Slider label="라벨 표시 최소 링크 수" min={0} max={10} value={settings.labelMinLinks} onChange={(v) => setSettings({ labelMinLinks: v })} />
        </div>

        {/* 노출 토글 */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">노출</p>
          {[
            { key: 'showIsolated', label: '고립 메모 표시' },
            { key: 'showWiki',     label: '[[위키]] 허브 + 링크' },
            { key: 'showTag',      label: '#태그 허브 + 링크' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings[key as keyof typeof settings] as boolean}
                onChange={(e) => setSettings({ [key]: e.target.checked })}
                className="accent-violet-600 w-3.5 h-3.5"
              />
              <span className="text-xs text-gray-600 dark:text-gray-300">{label}</span>
            </label>
          ))}
        </div>

        {/* 폴더 필터 */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">필터</p>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">폴더</label>
            <select
              value={settings.folderFilter ?? ''}
              onChange={(e) => setSettings({ folderFilter: e.target.value || null })}
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none focus:ring-1 focus:ring-violet-400"
            >
              <option value="">전체 폴더</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">태그</label>
            <input
              type="text"
              value={settings.tagFilter}
              onChange={(e) => setSettings({ tagFilter: e.target.value })}
              placeholder="#태그 입력"
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
        </div>

        {/* 레이아웃 초기화 */}
        <button
          onClick={onReset}
          className="w-full py-2 text-xs font-medium text-violet-600 dark:text-violet-400 border border-violet-300 dark:border-violet-700 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors"
        >
          레이아웃 초기화
        </button>

        {/* 범례 */}
        <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">범례</p>
          {[
            { color: '#7F77DD', label: '메모 노드', border: '' },
            { color: '#1D9E75', label: '[[위키]] 허브', border: '1px solid #0F6E56' },
            { color: '#378ADD', label: '#태그 허브', border: '1px solid #185FA5' },
          ].map(({ color, label, border }) => (
            <div key={label} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color, border: border || undefined }} />
              <span className="text-xs text-gray-600 dark:text-gray-300">{label}</span>
            </div>
          ))}
          {[
            { color: 'rgba(29,158,117,0.8)', label: '위키링크 화살표' },
            { color: 'rgba(55,138,221,0.8)', label: '태그링크 화살표' },
            { color: 'rgba(127,119,221,0.5)', label: '키워드 유사도' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2">
              <div className="w-6 h-0.5 flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-xs text-gray-600 dark:text-gray-300">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
