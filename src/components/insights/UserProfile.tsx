'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Edit2, Check, X, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { toast } from '@/components/ui/Toast'

interface Profile {
  id: string
  interests: string[]
  personality: string[]
  recurring_themes: string[]
  values: string[]
  behavior_patterns: string[]
  goals: string[]
  recent_changes: string[]
  raw_notes: string | null
  last_analyzed_at: string | null
}

const FIELD_META: { key: keyof Profile; label: string; emoji: string }[] = [
  { key: 'interests',        label: '관심사',     emoji: '🎯' },
  { key: 'personality',      label: '성향',       emoji: '🧠' },
  { key: 'recurring_themes', label: '반복 고민',  emoji: '🔄' },
  { key: 'values',           label: '가치관',     emoji: '💎' },
  { key: 'behavior_patterns',label: '행동 패턴',  emoji: '📊' },
  { key: 'goals',            label: '목표',       emoji: '🚀' },
  { key: 'recent_changes',   label: '최근 변화',  emoji: '✨' },
]

export default function UserProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [editField, setEditField] = useState<keyof Profile | null>(null)
  const [editValue, setEditValue] = useState('')

  const loadProfile = useCallback(async () => {
    const res = await fetch('/api/ai/profile')
    if (res.ok) {
      const data = await res.json()
      setProfile(data)
    }
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 프로필 로더 (loading 상태 동기 설정)
  useEffect(() => { loadProfile() }, [loadProfile])

  async function runAnalysis() {
    setAnalyzing(true)
    try {
      const res = await fetch('/api/ai/analyze-profile', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
        toast.success('프로필 분석이 완료됐어요.')
      } else {
        const { error } = await res.json().catch(() => ({ error: null }))
        toast.error(error ?? '분석에 실패했어요.')
      }
    } finally {
      setAnalyzing(false)
    }
  }

  function startEdit(key: keyof Profile) {
    if (!profile) return
    const val = profile[key]
    setEditField(key)
    setEditValue(Array.isArray(val) ? (val as string[]).join(', ') : (val as string) ?? '')
  }

  async function saveEdit() {
    if (!editField || !profile) return
    const isArray = Array.isArray(profile[editField])
    const newValue = isArray
      ? editValue.split(',').map((s) => s.trim()).filter(Boolean)
      : editValue
    const res = await fetch('/api/ai/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [editField]: newValue, source: 'manual' }),
    })
    if (res.ok) {
      const data = await res.json()
      setProfile(data)
    }
    setEditField(null)
    setEditValue('')
  }

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-10 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />)}
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <User size={48} className="text-gray-300" />
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">프로필이 없어요</p>
          <p className="text-xs text-gray-400 mt-1">메모 전체를 분석해서 나만의 프로필을 생성하세요.</p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm rounded-xl transition-colors"
        >
          <RefreshCw size={14} className={cn(analyzing && 'animate-spin')} />
          {analyzing ? '분석 중...' : '메모 전체 분석하기'}
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">나의 프로필</h3>
          {profile.last_analyzed_at && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              마지막 분석: {format(parseISO(profile.last_analyzed_at), 'yyyy.MM.dd', { locale: ko })}
            </p>
          )}
        </div>
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-500 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={11} className={cn(analyzing && 'animate-spin')} />
          {analyzing ? '분석 중...' : '재분석'}
        </button>
      </div>

      {/* 프로필 필드 */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
        {FIELD_META.map(({ key, label, emoji }) => {
          const val = profile[key]
          const arr = Array.isArray(val) ? (val as string[]) : []
          const isEditing = editField === key

          return (
            <div key={key} className="flex items-start gap-3 px-4 py-3 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 group transition-colors">
              <span className="text-sm flex-shrink-0 mt-0.5">{emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-gray-400 mb-1">{label}</p>
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditField(null) }}
                      className="flex-1 text-xs px-2 py-2 md:py-1 rounded border border-violet-400 outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                      placeholder="쉼표로 구분"
                    />
                    <button onClick={saveEdit} className="p-1.5 text-green-500 hover:text-green-700"><Check size={14} /></button>
                    <button onClick={() => setEditField(null)} className="p-1.5 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-700 dark:text-gray-300">
                    {arr.length > 0 ? arr.join(', ') : <span className="text-gray-400 italic">미설정</span>}
                  </p>
                )}
              </div>
              {!isEditing && (
                <button onClick={() => startEdit(key)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5 p-1 -mr-1">
                  <Edit2 size={13} className="text-gray-400 hover:text-violet-500" />
                </button>
              )}
            </div>
          )
        })}

        {/* raw_notes */}
        <div className="flex items-start gap-3 px-4 py-3 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 group transition-colors">
          <span className="text-sm flex-shrink-0 mt-0.5">📝</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-gray-400 mb-1">AI 메모</p>
            {editField === 'raw_notes' ? (
              <div className="flex flex-col gap-1">
                <textarea
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  rows={3}
                  className="text-xs px-2 py-1.5 rounded border border-violet-400 outline-none bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 resize-none"
                />
                <div className="flex gap-2">
                  <button onClick={saveEdit} className="flex items-center gap-1 text-xs text-green-600"><Check size={11} /> 저장</button>
                  <button onClick={() => setEditField(null)} className="flex items-center gap-1 text-xs text-gray-400"><X size={11} /> 취소</button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {profile.raw_notes || <span className="text-gray-400 italic">없음</span>}
              </p>
            )}
          </div>
          {editField !== 'raw_notes' && (
            <button onClick={() => startEdit('raw_notes')} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5 p-1 -mr-1">
              <Edit2 size={13} className="text-gray-400 hover:text-violet-500" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
