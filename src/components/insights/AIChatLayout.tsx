'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Bot, User, Plus, Trash2, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'

interface ChatRoom {
  id: string
  title: string
  summary: string | null
  last_message_at: string
  message_count: number
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

interface ProfileSuggestion {
  field: string
  insight: string
  confidence: string
}

const FIELD_LABELS: Record<string, string> = {
  interests: '관심사',
  personality: '성향',
  recurring_themes: '반복 주제',
  values: '가치관',
  behavior_patterns: '행동 패턴',
  goals: '목표',
  recent_changes: '최근 변화',
}

function relativeTime(iso: string) {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: ko })
  } catch {
    return ''
  }
}

export default function AIChatLayout() {
  const [rooms, setRooms] = useState<ChatRoom[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [suggestion, setSuggestion] = useState<ProfileSuggestion | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadRooms = useCallback(async () => {
    const res = await fetch('/api/ai/chat-rooms')
    if (!res.ok) return
    const data = await res.json()
    setRooms(data)
    setLoadingRooms(false)
  }, [])

  useEffect(() => { loadRooms() }, [loadRooms])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function selectRoom(id: string) {
    setSelectedId(id)
    setSuggestion(null)
    setMessages([])
    setMobileView('chat')
    const res = await fetch(`/api/ai/chat-rooms/${id}`)
    if (!res.ok) return
    const data = await res.json()
    setMessages(data)
  }

  async function createRoom() {
    const res = await fetch('/api/ai/chat-rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    if (!res.ok) return
    const room = await res.json()
    setRooms((prev) => [room, ...prev])
    await selectRoom(room.id)
  }

  async function deleteRoom(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('이 대화를 삭제할까요?')) return
    await fetch(`/api/ai/chat-rooms/${id}`, { method: 'DELETE' })
    setRooms((prev) => prev.filter((r) => r.id !== id))
    if (selectedId === id) { setSelectedId(null); setMessages([]); setMobileView('list') }
  }

  async function send() {
    const text = input.trim()
    if (!text || loading || !selectedId) return

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: text, created_at: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setSuggestion(null)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: selectedId, message: text }),
      })

      if (!res.ok) {
        throw new Error(`서버 오류 (${res.status})`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let assistantText = ''
      const assistantId = (Date.now() + 1).toString()

      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', created_at: new Date().toISOString() }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          // 마지막 멀티바이트 문자 flush
          const tail = decoder.decode()
          if (tail) {
            assistantText += tail
            setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: assistantText } : m))
          }
          break
        }
        assistantText += decoder.decode(value, { stream: true })
        setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: assistantText } : m))
      }

      // 대화방 목록 갱신
      await loadRooms()

      // 프로필 인사이트 추출 (비동기, 결과 기다림)
      fetch('/api/ai/profile-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage: text, aiResponse: assistantText }),
      }).then((r) => r.json()).then(({ suggestion: s }) => {
        if (s) setSuggestion(s)
      }).catch(() => {})
    } catch {
      setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'assistant', content: '오류가 발생했습니다. 다시 시도해주세요.', created_at: new Date().toISOString() }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  async function acceptSuggestion() {
    if (!suggestion) return
    const profileRes = await fetch('/api/ai/profile')
    const current = await profileRes.json()
    const field = suggestion.field as keyof typeof FIELD_LABELS
    const currentArr: string[] = (current?.[field] ?? []) as string[]
    const updated = [...currentArr, suggestion.insight]
    await fetch('/api/ai/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: updated, source: 'chat' }),
    })
    setSuggestion(null)
  }

  const selectedRoom = rooms.find((r) => r.id === selectedId)

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── 대화 목록 패널 ──────────────────────────────────────────
          모바일: mobileView==='list' 일 때만 전체 화면으로 표시
          데스크톱: 항상 좌측 사이드바(w-56)로 표시              */}
      <div className={cn(
        'flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900',
        'md:flex md:w-56 md:flex-shrink-0',
        mobileView === 'list' ? 'flex w-full' : 'hidden',
      )}>
        <button
          onClick={createRoom}
          className="flex items-center gap-2 m-3 px-3 py-2.5 rounded-xl border border-dashed border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 text-xs hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors"
        >
          <Plus size={13} />
          새 대화
        </button>

        <div className="flex-1 overflow-y-auto">
          {loadingRooms ? (
            <div className="p-3 space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />)}
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-xs gap-1">
              <MessageCircle size={24} className="opacity-30" />
              <p>대화가 없어요</p>
              <p className="text-[11px]">위 버튼으로 새 대화를 시작하세요</p>
            </div>
          ) : rooms.map((room) => (
            <div
              key={room.id}
              onClick={() => selectRoom(room.id)}
              className={cn(
                'group relative flex flex-col gap-0.5 px-3 py-3 md:py-2.5 cursor-pointer border-l-2 transition-colors',
                selectedId === room.id
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/20'
                  : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
              )}
            >
              <span className={cn('text-xs truncate pr-6', selectedId === room.id ? 'font-medium text-violet-700 dark:text-violet-300' : 'text-gray-700 dark:text-gray-300')}>
                {room.title}
              </span>
              <span className="text-[10px] text-gray-400">{relativeTime(room.last_message_at)}</span>
              <button
                onClick={(e) => deleteRoom(room.id, e)}
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1.5 rounded text-gray-400 hover:text-red-500 transition-all"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── 채팅 패널 ────────────────────────────────────────────────
          모바일: mobileView==='chat' 일 때만 전체 화면으로 표시
          데스크톱: 항상 우측 flex-1로 표시                      */}
      <div className={cn(
        'flex-col min-w-0',
        'md:flex md:flex-1',
        mobileView === 'chat' ? 'flex flex-1' : 'hidden',
      )}>
        {!selectedId ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 gap-3">
            <Bot size={40} className="opacity-20" />
            <div>
              <p className="text-sm font-medium">AI 어시스턴트</p>
              <p className="text-xs mt-1 hidden md:block">왼쪽에서 대화를 선택하거나 새 대화를 시작하세요.</p>
            </div>
            <button onClick={createRoom} className="mt-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs rounded-lg transition-colors">
              새 대화 시작
            </button>
          </div>
        ) : (
          <>
            {/* 대화방 헤더 */}
            <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              {/* 모바일 뒤로가기 버튼 */}
              <button
                onClick={() => setMobileView('list')}
                className="md:hidden flex-shrink-0 p-1.5 -ml-1 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="대화 목록으로"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">{selectedRoom?.title ?? '대화'}</p>
                {selectedRoom?.summary && (
                  <p className="text-[10px] text-gray-400 truncate mt-0.5">요약 보관 중</p>
                )}
              </div>
            </div>

            {/* 메시지 영역 */}
            <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3 bg-gray-50 dark:bg-gray-950">
              {messages.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
                  <Bot size={32} className="opacity-20" />
                  <p className="text-xs">무엇이든 물어보세요.</p>
                  <div className="flex flex-col gap-1.5 mt-2 w-full max-w-xs">
                    {['이번 주 플랜 달성률이 어때?', '내 메모에서 관심사를 찾아줘', '오늘 뭘 하면 좋을까?'].map((q) => (
                      <button key={q} onClick={() => setInput(q)} className="text-xs px-3 py-2.5 md:py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors text-left">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className={cn('flex gap-2', msg.role === 'user' && 'flex-row-reverse')}>
                  <div className={cn('flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center', msg.role === 'user' ? 'bg-violet-600' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700')}>
                    {msg.role === 'user' ? <User size={12} className="text-white" /> : <Bot size={12} className="text-gray-500" />}
                  </div>
                  <div className={cn('max-w-[85%] md:max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed', msg.role === 'user' ? 'bg-violet-600 text-white rounded-tr-sm' : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-sm border border-gray-100 dark:border-gray-700')}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center flex-shrink-0">
                    <Bot size={12} className="text-gray-500" />
                  </div>
                  <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-tl-sm px-4 py-3">
                    <span className="flex gap-1">
                      {[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                    </span>
                  </div>
                </div>
              )}

              {/* 프로필 업데이트 제안 카드 */}
              {suggestion && (
                <div className="mx-auto max-w-md p-3 rounded-xl bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800">
                  <p className="text-xs font-medium text-violet-600 dark:text-violet-400 mb-1.5">💡 프로필 업데이트 제안</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300 mb-2.5">
                    <strong>{FIELD_LABELS[suggestion.field] ?? suggestion.field}</strong>에 추가: &ldquo;{suggestion.insight}&rdquo;
                  </p>
                  <div className="flex gap-2">
                    <button onClick={acceptSuggestion} className="px-3 py-2 md:py-1.5 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700 transition-colors">추가하기</button>
                    <button onClick={() => setSuggestion(null)} className="px-3 py-2 md:py-1.5 border border-gray-300 dark:border-gray-600 text-gray-500 text-xs rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">무시</button>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* 입력창 */}
            <div className="flex-shrink-0 p-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder="메시지를 입력하세요..."
                  disabled={loading}
                  className="flex-1 px-3.5 py-2.5 text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
                />
                <button
                  onClick={send}
                  disabled={loading || !input.trim()}
                  className="p-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl transition-colors"
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
