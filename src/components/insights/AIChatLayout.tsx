'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Bot, User, Plus, Trash2, MessageCircle, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useConfirm } from '@/components/ui/ConfirmModal'
import Markdown from '@/components/ui/Markdown'

const MAX_MESSAGE_LEN = 4000 // 서버(api/ai/chat)와 동일 제한

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
  const [messagesLoading, setMessagesLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 방 전환 레이스 가드 — 이전 방의 fetch가 늦게 도착해 현재 방 메시지를 덮지 않도록
  const selectedIdRef = useRef<string | null>(null)
  const confirm = useConfirm()

  // 언마운트 시 진행 중 스트림 정리
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const loadRooms = useCallback(async () => {
    const res = await fetch('/api/ai/chat-rooms')
    if (!res.ok) return
    const data = await res.json()
    setRooms(data)
    setLoadingRooms(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 비동기 로더 (loading 상태 동기 설정)
  useEffect(() => { loadRooms() }, [loadRooms])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function selectRoom(id: string) {
    setSelectedId(id)
    selectedIdRef.current = id
    setSuggestion(null)
    setMessages([])
    setMobileView('chat')
    // 기존 대화방(메시지 있음)은 로딩 스켈레톤 표시 —
    // "무엇이든 물어보세요" 빈 상태가 로딩 동안 스치듯 보이던 문제 방지.
    // 새 대화방(message_count 0)은 어차피 빈 상태가 정답이므로 스켈레톤 생략.
    const room = rooms.find((r) => r.id === id)
    const expectEmpty = (room?.message_count ?? 0) === 0
    if (!expectEmpty) setMessagesLoading(true)
    try {
      const res = await fetch(`/api/ai/chat-rooms/${id}`)
      if (!res.ok) return
      const data = await res.json()
      if (selectedIdRef.current === id) setMessages(data)
    } finally {
      if (selectedIdRef.current === id) setMessagesLoading(false)
    }
  }

  async function createRoom() {
    const res = await fetch('/api/ai/chat-rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    if (!res.ok) return
    const room = await res.json()
    setRooms((prev) => [room, ...prev])
    await selectRoom(room.id)
  }

  function deleteRoom(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    confirm.open({
      title: '이 대화를 삭제할까요?',
      description: '대화 기록이 영구적으로 사라집니다.',
      variant: 'danger',
      confirmLabel: '삭제',
      onConfirm: async () => {
        await fetch(`/api/ai/chat-rooms/${id}`, { method: 'DELETE' })
        setRooms((prev) => prev.filter((r) => r.id !== id))
        if (selectedId === id) { setSelectedId(null); selectedIdRef.current = null; setMessages([]); setMobileView('list') }
      },
    })
  }

  /** 스트리밍 중단 — 지금까지 받은 텍스트는 유지 */
  function stopStreaming() {
    abortRef.current?.abort()
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim()
    if (!text || loading || !selectedId) return
    if (text.length > MAX_MESSAGE_LEN) return

    // eslint-disable-next-line react-hooks/purity -- 이벤트 핸들러 내 임시 ID 생성 (렌더 중 실행 아님)
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: text, created_at: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setSuggestion(null)

    const controller = new AbortController()
    abortRef.current = controller
    let aborted = false

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: selectedId, message: text }),
        signal: controller.signal,
      })

      if (!res.ok) {
        // 서버가 만든 안내 문구(레이트리밋·길이 제한 등)를 그대로 사용자에게 전달
        const serverMsg = await res.text().catch(() => '')
        const friendly = serverMsg.trim()
          ? serverMsg.trim()
          : res.status === 429
            ? '오늘 대화 한도를 모두 사용했어요. 내일 다시 시도해주세요.'
            : `오류가 발생했어요. (서버 응답 ${res.status}) 잠시 후 다시 시도해주세요.`
        setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: friendly, created_at: new Date().toISOString() }])
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let assistantText = ''
      // eslint-disable-next-line react-hooks/purity -- 이벤트 핸들러 내 임시 ID 생성 (렌더 중 실행 아님)
      const assistantId = (Date.now() + 1).toString()

      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', created_at: new Date().toISOString() }])

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            // 마지막 멀티바이트 문자 flush
            const tail = decoder.decode()
            if (tail) {
              // eslint-disable-next-line react-hooks/immutability -- 스트리밍 청크 누적 (이벤트 핸들러 내 로컬 변수)
              assistantText += tail
              setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: assistantText } : m))
            }
            break
          }
          assistantText += decoder.decode(value, { stream: true })
          setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: assistantText } : m))
        }
      } catch (streamErr) {
        // Stop 버튼(abort)은 정상 종료로 취급 — 받은 부분까지 유지
        if (streamErr instanceof DOMException && streamErr.name === 'AbortError') aborted = true
        else throw streamErr
      }

      // 대화방 목록 갱신
      await loadRooms()

      // 프로필 인사이트 추출 (비동기, 결과 기다림) — 중단된 답변에는 미실행
      if (!aborted && assistantText) {
        fetch('/api/ai/profile-insight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userMessage: text, aiResponse: assistantText }),
        }).then((r) => r.json()).then(({ suggestion: s }) => {
          if (s) setSuggestion(s)
        }).catch(() => {})
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 첫 응답 전 중단 — 조용히 종료
      } else {
        setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'assistant', content: '네트워크 오류가 발생했어요. 연결 상태를 확인하고 다시 시도해주세요.', created_at: new Date().toISOString() }])
      }
    } finally {
      abortRef.current = null
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
              {/* 기존 대화방 메시지 로딩 — 빈 상태 대신 스켈레톤 (플래시 방지) */}
              {messagesLoading && messages.length === 0 && (
                <div className="space-y-3">
                  {[72, 44, 84].map((w, i) => (
                    <div key={i} className={cn('flex gap-2', i === 1 && 'flex-row-reverse')}>
                      <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse flex-shrink-0" />
                      <div
                        className={cn('h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse', i === 1 ? 'rounded-tr-sm' : 'rounded-tl-sm')}
                        style={{ width: `${w}%`, maxWidth: 420 }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {messages.length === 0 && !loading && !messagesLoading && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
                  <Bot size={32} className="opacity-20" />
                  <p className="text-xs">무엇이든 물어보세요.</p>
                  <div className="flex flex-col gap-1.5 mt-2 w-full max-w-xs">
                    {['이번 주 플랜 달성률이 어때?', '내 메모에서 관심사를 찾아줘', '오늘 뭘 하면 좋을까?'].map((q) => (
                      <button key={q} onClick={() => send(q)} className="text-xs px-3 py-2.5 md:py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors text-left">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.filter((msg) => !(msg.role === 'assistant' && msg.content === '')).map((msg) => (
                <div key={msg.id} className={cn('flex gap-2', msg.role === 'user' && 'flex-row-reverse')}>
                  <div className={cn('flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center', msg.role === 'user' ? 'bg-violet-600' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700')}>
                    {msg.role === 'user' ? <User size={12} className="text-white" /> : <Bot size={12} className="text-gray-500" />}
                  </div>
                  <div className={cn('max-w-[85%] md:max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed', msg.role === 'user' ? 'bg-violet-600 text-white rounded-tr-sm' : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-sm border border-gray-100 dark:border-gray-700')}>
                    {msg.role === 'assistant'
                      ? <Markdown text={msg.content} />
                      : <p className="whitespace-pre-wrap">{msg.content}</p>}
                  </div>
                </div>
              ))}

              {loading && (messages[messages.length - 1]?.role === 'user' || messages[messages.length - 1]?.content === '') && (
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
                  maxLength={MAX_MESSAGE_LEN}
                  className="flex-1 px-3.5 py-2.5 text-base sm:text-sm rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
                />
                {loading ? (
                  <button
                    onClick={stopStreaming}
                    className="p-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl transition-colors"
                    title="응답 중단"
                    aria-label="응답 중단"
                  >
                    <Square size={15} className="fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={() => send()}
                    disabled={!input.trim()}
                    className="p-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl transition-colors"
                  >
                    <Send size={15} />
                  </button>
                )}
              </div>
              {input.length > MAX_MESSAGE_LEN - 500 && (
                <p className={cn('text-[10px] mt-1 text-right', input.length >= MAX_MESSAGE_LEN ? 'text-red-500' : 'text-gray-400')}>
                  {input.length.toLocaleString()} / {MAX_MESSAGE_LEN.toLocaleString()}자
                </p>
              )}
            </div>
          </>
        )}
      </div>
      <confirm.Render />
    </div>
  )
}
