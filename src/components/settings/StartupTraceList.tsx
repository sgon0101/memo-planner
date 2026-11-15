'use client'

// 앱 시작 속도 기록 (임시 진단 — 원인 확인 후 제거 예정, 2026-11-15)

import { useEffect, useState } from 'react'
import { clearStartupTrace, readStartupTrace, type StartupEntry } from '@/lib/perf/startupTrace'

const sec = (ms?: number) => (ms === undefined ? '–' : `${(ms / 1000).toFixed(2)}초`)

function timeLabel(at: number) {
  const d = new Date(at)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function rows(e: StartupEntry): [string, string][] {
  if (e.kind === 'resume') return [['백그라운드에 있던 시간', `${e.hiddenMin}분`]]
  const m = e.marks
  return [
    ['화면 틀 도착', sec(e.html) + (e.sw ? ' (폰에 저장된 것)' : ' (서버)')],
    ['첫 화면 표시', sec(e.fcp)],
    ['앱 코드 준비 끝', sec(m.hydrated)],
    ['저장된 메모 표시', sec(m.home)],
    ['로그인 확인 끝', sec(m.token)],
    ['최신 메모 받음', sec(m.homeFresh)],
    ['메모 전체 받기 끝', sec(m.prefetch)],
    ['화면이 멈춘 시간', `${sec(e.longTaskMs)} (${e.longTaskCount ?? 0}번)`],
    ['읽은 앱 코드', `${e.jsKB ?? '–'}KB · 파일 ${e.jsFiles ?? '–'}개 (인터넷 ${e.jsFromNetwork ?? '–'}개)`],
  ]
}

function toText(list: StartupEntry[]) {
  return list.map((e) => {
    const head = `[${timeLabel(e.at)}] ${e.kind === 'resume' ? '다시 보여줌' : '새로 시작'} ${e.path}` +
      (e.kind === 'cold' ? ` nav=${e.navType} discarded=${e.discarded ? 'y' : 'n'}` : '')
    return [head, ...rows(e).map(([k, v]) => `  ${k}: ${v}`)].join('\n')
  }).join('\n')
}

export default function StartupTraceList() {
  const [list, setList] = useState<StartupEntry[]>([])
  const [copied, setCopied] = useState(false)

  // localStorage는 서버 렌더에 없어 hydration 뒤에 읽는다 (초기값으로 읽으면 SSR과 불일치)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setList(readStartupTrace()) }, [])

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        앱을 켤 때마다 최근 8번의 시작 시간을 기록해요. 시간은 앱을 누른 순간부터 잰 값이에요.
      </p>
      {list.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">아직 기록이 없어요. 앱을 켜고 10초 뒤에 기록돼요.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((e) => (
            <li key={e.at} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">
                {timeLabel(e.at)} · {e.kind === 'resume' ? '메모리에 있던 화면을 다시 보여줌' : e.discarded ? '폰이 지운 뒤 새로 시작' : '새로 시작'}
              </div>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                {rows(e).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                    <dd className="text-gray-800 dark:text-gray-200 tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={list.length === 0}
          onClick={() => {
            void navigator.clipboard?.writeText(toText(list)).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            })
          }}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40"
        >
          {copied ? '복사됨' : '기록 복사'}
        </button>
        <button
          type="button"
          disabled={list.length === 0}
          onClick={() => { clearStartupTrace(); setList([]) }}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40"
        >
          지우기
        </button>
      </div>
    </div>
  )
}
