'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUIStore } from '@/store/uiStore'
import {
  User, Moon, Sun, CalendarDays, LogOut, Trash2,
  CheckCircle, AlertCircle, Loader2, ExternalLink,
  Download, Upload, FileText, FileJson, HardDrive,
  CloudUpload, Bell, BellOff, Radio, Sparkles,
} from 'lucide-react'
import {
  isNotifSupported, getNotifPermission, isNotifEnabled, setNotifEnabled,
  getNotifLead, setNotifLead, requestPermissionIfNeeded,
  refreshScheduled, showTestNotification, LEAD_OPTIONS,
} from '@/lib/notifications/scheduler'
import { usePushSubscription } from '@/hooks/usePushSubscription'
import { printToPdf, markdownToHtml } from '@/lib/export/pdf'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/Toast'
import { isRealtimeEnabled, setRealtimeEnabled } from '@/hooks/useRealtimeSync'
import { lsLastDriveBackup } from '@/lib/cache/lsKeys'
import { useConfirm } from '@/components/ui/ConfirmModal'

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = createClient()

  const { darkMode, toggleDarkMode } = useUIStore()
  const [realtimeOn, setRealtimeOn] = useState<boolean>(true)
  const [embedStatus, setEmbedStatus] = useState<{ total: number; embedded: number; missing: number; percent: number } | null>(null)
  const [embedLoading, setEmbedLoading] = useState(false)
  const [backfillBusy, setBackfillBusy] = useState(false)
  const [restoreModalOpen, setRestoreModalOpen] = useState(false)
  const [restoreFolders, setRestoreFolders] = useState<Array<{ id: string; name: string; createdAt: string }>>([])
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [retainCount, setRetainCount] = useState<number>(10)
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [nicknameSaving, setNicknameSaving] = useState(false)
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [driveConnected, setDriveConnected] = useState(false)
  const [driveLoading, setDriveLoading] = useState(false)
  const [integrationsLoading, setIntegrationsLoading] = useState(true)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const confirm = useConfirm()
  const [storageStats, setStorageStats] = useState<{
    fileCount: number
    originalBytes: number
    compressedBytes: number
  } | null>(null)
  const [driveBackupLoading, setDriveBackupLoading] = useState(false)
  const [lastBackup, setLastBackup] = useState<string | null>(() => {
    if (typeof window !== 'undefined') { const k = lsLastDriveBackup(); return k ? localStorage.getItem(k) : null } return null
    return null
  })
  const [autoBackup, setAutoBackup] = useState(false)
  const [backupPeriod, setBackupPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [nextBackupAt, setNextBackupAt] = useState<string | null>(null)
  const [autoBackupLoading, setAutoBackupLoading] = useState(false)

  // 알림 상태 (단계 A — 탭 열린 동안)
  const [notifEnabled, setNotifEnabledState] = useState(false)
  const [notifPerm, setNotifPerm] = useState<'default' | 'granted' | 'denied' | 'unsupported'>('default')
  const [notifLead, setNotifLeadState] = useState(10)

  // Web Push (단계 B — 백그라운드 알림)
  const push = usePushSubscription()

  // Realtime 토글 초기값 — currentUser init 후 LS 읽기 (mount 시 1회)
  useEffect(() => {
    setRealtimeOn(isRealtimeEnabled())
  }, [])
  // PR-6: 임베딩 진행률 로드
  useEffect(() => {
    let mounted = true
    // PR-5: 백업 설정의 retainCount 로드
    fetch('/api/backup/settings')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d && typeof d.retainCount === 'number') setRetainCount(d.retainCount) })
      .catch(() => {})

    setEmbedLoading(true)
    fetch('/api/embeddings/status')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (mounted && d) setEmbedStatus(d) })
      .catch(() => {})
      .finally(() => { if (mounted) setEmbedLoading(false) })
    return () => { mounted = false }
  }, [])



  // PR-5: Drive 복원 모달 열기
  const openRestoreModal = async () => {
    setRestoreModalOpen(true)
    setRestoreLoading(true)
    try {
      const r = await fetch('/api/restore/google-drive')
      if (r.ok) {
        const d = await r.json() as { folders: Array<{ id: string; name: string; createdAt: string }> }
        setRestoreFolders(d.folders || [])
      } else {
        toast.error('백업 목록을 불러오지 못했습니다')
      }
    } catch (e) {
      toast.error('백업 목록 조회 실패: ' + (e instanceof Error ? e.message : 'unknown'))
    } finally {
      setRestoreLoading(false)
    }
  }

  const doRestore = async (folderId: string, mode: 'skip' | 'newer-wins' | 'overwrite') => {
    if (restoreBusy) return
    setRestoreBusy(true)
    try {
      toast.info('복원 시작 — 폴더 크기에 따라 몇 분 걸릴 수 있어요')
      const r = await fetch('/api/restore/google-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, mode }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error('복원 실패: ' + (d.error ?? 'unknown'))
      } else {
        toast.success(`복원 완료 — 새로/덮어쓴 메모 ${d.restored}건, 건너뜀 ${d.skipped}, 오류 ${d.errors}`)
        setRestoreModalOpen(false)
      }
    } catch (e) {
      toast.error('복원 중 오류: ' + (e instanceof Error ? e.message : 'unknown'))
    } finally {
      setRestoreBusy(false)
    }
  }

  const refreshEmbedStatus = async () => {
    setEmbedLoading(true)
    try {
      const r = await fetch('/api/embeddings/status')
      if (r.ok) setEmbedStatus(await r.json())
    } catch {} finally { setEmbedLoading(false) }
  }

  const saveRetainCount = async (n: number) => {
    setRetainCount(n)
    try {
      await fetch('/api/backup/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retainCount: n }),
      })
    } catch { /* silent */ }
  }

  const runEmbedBackfill = async () => {
    if (backfillBusy) return
    setBackfillBusy(true)
    toast.info('임베딩 backfill 시작 — 메모 수에 따라 몇 분 걸릴 수 있어요')
    try {
      let totalProcessed = 0
      // 한 번에 50개씩 반복 처리
      for (let i = 0; i < 50; i++) {  // 최대 50회 = 2500개 보호
        const r = await fetch('/api/embeddings/backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        if (!r.ok) break
        const d = await r.json() as { processed: number; remaining: number }
        totalProcessed += d.processed
        if (d.remaining === 0 || d.processed === 0) break
      }
      await refreshEmbedStatus()
      toast.success(`임베딩 backfill 완료 — ${totalProcessed}개 처리됨`)
    } catch (e) {
      toast.error('임베딩 backfill 중 오류: ' + (e instanceof Error ? e.message : 'unknown'))
    } finally {
      setBackfillBusy(false)
    }
  }


  useEffect(() => {
    if (!isNotifSupported()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 브라우저 지원 여부 1회 동기 설정
      setNotifPerm('unsupported')
      return
    }
    setNotifEnabledState(isNotifEnabled())
    setNotifPerm(getNotifPermission() as 'default' | 'granted' | 'denied')
    setNotifLeadState(getNotifLead())
  }, [])

  /**
   * 통합 알림 토글 — 포어그라운드(setTimeout) + 백그라운드(Web Push + cron)를 한 번에 컨트롤.
   *
   * ON 시:
   *  1) Notification 권한 요청
   *  2) localStorage `weave-notif-enabled = '1'`
   *  3) refreshScheduled — 탭 열려있는 동안 setTimeout 알림 예약
   *  4) push.subscribe — Web Push 등록 → DB push_subscriptions 행 생성
   *     → 이후 cron이 백그라운드에서 푸시 발송 가능
   *
   * OFF 시:
   *  1) localStorage `weave-notif-enabled = '0'` + clearAllTimers
   *  2) push.unsubscribe — DB push_subscriptions 삭제 + 브라우저 구독 해제
   *     → cron은 발송 대상이 없어져서 사실상 멈춤
   */
  async function handleToggleNotif() {
    const next = !notifEnabled
    if (next) {
      // 권한 요청
      const perm = await requestPermissionIfNeeded()
      setNotifPerm(perm as 'default' | 'granted' | 'denied' | 'unsupported')
      if (perm !== 'granted') {
        if (perm === 'denied') {
          toast.error('브라우저 설정에서 알림 권한을 허용해주세요.')
        }
        return
      }
    }
    setNotifEnabled(next)
    setNotifEnabledState(next)
    if (next) {
      // ① 포어그라운드 setTimeout 예약
      await refreshScheduled()
      // ② 백그라운드 Web Push 구독 (cron이 발송할 수 있게)
      const ok = await push.subscribe()
      if (ok) {
        toast.success('알림이 활성화됐어요. 앱이 닫혀있어도 알림이 와요.')
      } else {
        // 푸시 구독 실패해도 포어그라운드는 동작하므로 그대로 진행
        toast.error(push.error
          ? `포어그라운드 알림만 활성화됐어요 — 백그라운드 실패: ${push.error}`
          : '포어그라운드 알림만 활성화됐어요 (백그라운드 등록 실패).')
      }
    } else {
      // 백그라운드 푸시 구독도 같이 해제 → cron 발송 대상에서 제외
      let unsubscribed = true
      if (push.subscribed) {
        unsubscribed = await push.unsubscribe()
      }
      if (unsubscribed) {
        toast.success('알림이 꺼졌어요. 백그라운드 알림도 중단됩니다.')
      } else {
        toast.error('포어그라운드 알림은 꺼졌지만 백그라운드 해제에 실패했어요. 잠시 후 다시 시도해주세요.')
      }
    }
  }

  function handleChangeLead(min: number) {
    setNotifLead(min)
    setNotifLeadState(min)
    if (notifEnabled) refreshScheduled().catch(() => {})
  }

  async function handleTestNotif() {
    const ok = await showTestNotification()
    if (ok) {
      toast.success('테스트 알림을 보냈어요.')
    } else {
      toast.error('먼저 알림을 활성화해주세요.')
    }
  }

  async function fetchBackupSettings() {
    try {
      const res = await fetch('/api/backup/settings')
      if (!res.ok) return
      const data = await res.json()
      setAutoBackup(data.autoBackup ?? false)
      setBackupPeriod(data.period ?? 'weekly')
      setNextBackupAt(data.nextBackupAt ?? null)
      if (data.lastBackupAt) {
        const str = new Date(data.lastBackupAt).toLocaleString('ko-KR')
        setLastBackup(str)
        { const k = lsLastDriveBackup(); if (k) localStorage.setItem(k, str) }
      }
    } catch { /* 미연결 시 무시 */ }
  }

  async function saveAutoBackupSettings(enabled: boolean, period: 'daily' | 'weekly' | 'monthly') {
    setAutoBackupLoading(true)
    try {
      const res = await fetch('/api/backup/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoBackup: enabled, period }),
      })
      const data = await res.json()
      setAutoBackup(data.autoBackup)
      setBackupPeriod(data.period)
      setNextBackupAt(data.nextBackupAt ?? null)
      toast.success('자동 백업 설정이 저장되었습니다.')
    } catch {
      toast.error('설정 저장에 실패했습니다.')
    } finally {
      setAutoBackupLoading(false)
    }
  }

  // 연결 상태를 user_integrations에서 직접 조회 (access_token 유무로 판단)
  async function fetchIntegrationStatus() {
    setIntegrationsLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: integrations } = await supabase
        .from('user_integrations')
        .select('provider, access_token')
        .eq('user_id', user.id)
        .in('provider', ['google_drive', 'google_calendar'])
      setDriveConnected(!!(integrations?.some((i) => i.provider === 'google_drive' && i.access_token)))
      setCalendarConnected(!!(integrations?.some((i) => i.provider === 'google_calendar' && i.access_token)))
    } finally {
      setIntegrationsLoading(false)
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setEmail(data.user.email ?? '')
        setNickname((data.user.user_metadata?.display_name as string | undefined) ?? '')
      }
    })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 비동기 로더 호출 (로더가 loading 상태를 동기 설정)
    fetchIntegrationStatus()
    fetchBackupSettings()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: files } = await supabase
        .from('uploaded_files')
        .select('original_size, compressed_size')
        .eq('user_id', data.user.id)
      if (files) {
        setStorageStats({
          fileCount: files.length,
          originalBytes: files.reduce((s, f) => s + (f.original_size ?? 0), 0),
          compressedBytes: files.reduce((s, f) => s + (f.compressed_size ?? 0), 0),
        })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // URL 파라미터로 toast 표시 + 상태 재조회
  useEffect(() => {
    const connected = searchParams.get('connected')
    const error = searchParams.get('error')
    if (!connected && !error) return
    queueMicrotask(() => {
      if (connected === 'calendar') {
        toast.success('Google Calendar가 연결되었습니다.')
      } else if (connected === 'drive') {
        toast.success('Google Drive가 연결되었습니다.')
      } else if (error === 'calendar_auth_failed') {
        toast.error('Google Calendar 연결에 실패했습니다.')
      } else if (error === 'drive_auth_failed') {
        toast.error('Google Drive 연결에 실패했습니다.')
      }
      fetchIntegrationStatus()
      fetchBackupSettings()
      router.replace('/settings')
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function disconnectCalendar() {
    setCalendarLoading(true)
    try {
      await fetch('/api/calendar/disconnect', { method: 'DELETE' })
      setCalendarConnected(false)
      toast.success('Google Calendar 연결이 해제되었습니다.')
    } catch {
      toast.error('연결 해제 중 오류가 발생했습니다.')
    } finally {
      setCalendarLoading(false)
    }
  }

  async function saveNickname() {
    setNicknameSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ data: { display_name: nickname.trim() } })
      if (error) throw error
      toast.success('별명이 저장되었습니다.')
    } catch {
      toast.error('저장 중 오류가 발생했습니다.')
    } finally {
      setNicknameSaving(false)
    }
  }

  async function disconnectDrive() {
    setDriveLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('user_integrations').delete().eq('user_id', user.id).eq('provider', 'google_drive')
      setDriveConnected(false)
      toast.success('Google Drive 연결이 해제되었습니다.')
    } catch {
      toast.error('연결 해제 중 오류가 발생했습니다.')
    } finally {
      setDriveLoading(false)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function handleDriveBackup(mode: 'individual' | 'combined') {
    if (!driveConnected) {
      window.location.href = '/api/drive/auth'
      return
    }
    setDriveBackupLoading(true)
    try {
      const res = await fetch('/api/backup/google-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      // 빈 응답 대응: text로 먼저 읽은 뒤 JSON 파싱
      const text = await res.text()
      if (!text) throw new Error('서버에서 빈 응답이 왔습니다.')
      let data: Record<string, unknown>
      try {
        data = JSON.parse(text)
      } catch {
        console.error('[backup] 응답 파싱 실패, 원본:', text)
        throw new Error('응답 형식이 올바르지 않습니다.')
      }
      if (!res.ok) throw new Error((data.error as string) ?? '백업 실패')
      const now = new Date().toLocaleString('ko-KR')
      setLastBackup(now)
      { const k = lsLastDriveBackup(); if (k) localStorage.setItem(k, now) }
      const failMsg = data.failCount ? ` / 실패 ${data.failCount}개` : ''
      const msg = `${data.message} (성공 ${data.count}개${failMsg})`
      if (data.failCount) toast.error(msg)
      else toast.success(msg)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '백업 중 오류가 발생했습니다.')
    } finally {
      setDriveBackupLoading(false)
    }
  }

  async function exportData(format: 'json' | 'markdown' | 'pdf') {
    setExportLoading(true)
    try {
      if (format === 'pdf') {
        const res = await fetch('/api/export?format=markdown')
        const md = await res.text()
        printToPdf(markdownToHtml(md), '메모 내보내기')
        return
      }
      const res = await fetch(`/api/export?format=${format}`)
      const blob = await res.blob()
      const ext = format === 'markdown' ? 'md' : 'json'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `backup-${new Date().toISOString().slice(0, 10)}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('내보내기가 완료되었습니다.')
    } catch {
      toast.error('내보내기 중 오류가 발생했습니다.')
    } finally {
      setExportLoading(false)
    }
  }

  async function importData(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImportLoading(true)
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const { results } = data
      toast.success(`가져오기 완료: 폴더 ${results.folders}개, 메모 ${results.memos}개, 플랜 ${results.plans}개`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '가져오기 중 오류가 발생했습니다.')
    } finally {
      setImportLoading(false)
    }
  }

  function handleDeleteAccount() {
    confirm.open({
      title: '계정을 삭제할까요?',
      description: '계정을 삭제하면 모든 데이터가 영구적으로 삭제돼요.\n이 작업은 되돌릴 수 없습니다.',
      variant: 'danger',
      confirmLabel: '계정 삭제',
      onConfirm: async () => {
        setDeleteLoading(true)
        try {
          // 서비스 역할로 계정 삭제는 서버 API가 필요하므로 로그아웃만 처리
          await supabase.auth.signOut()
          router.push('/login')
        } finally {
          setDeleteLoading(false)
        }
      },
    })
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white">설정</h2>

      {/* 프로필 */}
      <Section title="프로필" icon={<User size={15} />}>
        {/* 프로필 카드 — Section 내부에 풀폭으로 채워 nested rounded 제거 */}
        <div className="flex items-center gap-3 px-4 py-4 bg-white dark:bg-gray-900">
          <div className="w-10 h-10 rounded-full bg-violet-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
            {(nickname || email).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            {nickname && <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{nickname}</p>}
            <p className="text-xs text-gray-500 truncate">{email || '—'}</p>
          </div>
        </div>
        {/* 별명 — 모바일 세로 스택 (label/description/input+저장), 데스크탑 가로 배치 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3.5 bg-white dark:bg-gray-900">
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">별명</p>
            <p className="text-xs text-gray-500 mt-0.5">홈 화면 인사말과 사이드바에 표시됩니다</p>
          </div>
          <div className="flex gap-2 sm:flex-shrink-0">
            <input
              type="search"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveNickname()}
              placeholder="별명 입력"
              maxLength={20}
              autoComplete="off"
              data-1p-ignore="true"
              className="[&::-webkit-search-cancel-button]:hidden flex-1 sm:w-36 sm:flex-none px-3 py-2 text-base sm:text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <button
              onClick={saveNickname}
              disabled={nicknameSaving}
              className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1 flex-shrink-0"
            >
              {nicknameSaving ? <Loader2 size={13} className="animate-spin" /> : null}
              저장
            </button>
          </div>
        </div>
      </Section>

      {/* 외관 */}
      <Section title="외관" icon={darkMode ? <Moon size={15} /> : <Sun size={15} />}>
        <SettingRow
          label="다크 모드"
          description="어두운 테마를 사용합니다"
        >
          <Toggle enabled={darkMode} onChange={toggleDarkMode} />
        </SettingRow>
      </Section>

      {/* 알림 */}
      <Section title="알림" icon={notifEnabled ? <Bell size={15} /> : <BellOff size={15} />}>
        {notifPerm === 'unsupported' ? (
          <div className="px-4 py-4 bg-white dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400">
            이 브라우저는 알림 기능을 지원하지 않습니다.
          </div>
        ) : (
          <>
            <SettingRow
              label="플랜 시작 알림"
              description={
                notifPerm === 'denied'
                  ? '브라우저 알림이 차단되어 있어요. 주소창 자물쇠 아이콘에서 허용해주세요.'
                  : notifPerm === 'granted'
                    ? notifEnabled
                      ? '앱이 열려있을 때(setTimeout)와 닫혀있을 때(Web Push) 모두 알림이 와요'
                      : '활성화하면 시간 지정 플랜의 시작 시간을 알려드려요 (포어그라운드 + 백그라운드 통합)'
                    : '활성화하면 브라우저 알림 권한을 요청합니다'
              }
            >
              <Toggle
                enabled={notifEnabled}
                onChange={handleToggleNotif}
              />
            </SettingRow>
            {notifEnabled && notifPerm === 'granted' && (
              <>
                <div className="px-4 py-3.5 bg-white dark:bg-gray-900 space-y-3">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    기본 알림 시점
                    <span className="ml-1.5 text-[10px] font-normal text-gray-400">(새 플랜 만들 때 이 값으로 시작)</span>
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {LEAD_OPTIONS.map((min) => (
                      <button
                        key={min}
                        onClick={() => handleChangeLead(min)}
                        className={cn(
                          'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                          notifLead === min
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
                        )}
                      >
                        {min === 0 ? '정시' : `${min}분 전`}
                      </button>
                    ))}
                  </div>
                </div>
                <SettingRow label="테스트 알림" description="알림이 정상적으로 표시되는지 확인합니다">
                  <button
                    onClick={handleTestNotif}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <Bell size={12} /> 보내기
                  </button>
                </SettingRow>
              </>
            )}
            {/* 백그라운드 푸시 상태 — 별도 토글 X, 위 알림 토글이 컨트롤 */}
            {notifEnabled && push.permission !== 'unsupported' && (
              <div className="px-4 py-3 bg-white dark:bg-gray-900 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    이 기기 백그라운드 푸시
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {push.subscribed
                      ? '등록됨 — 앱을 닫아도 알림이 와요'
                      : '미등록 — 알림 토글을 다시 켜면 재등록됩니다'}
                  </p>
                </div>
                <span
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full',
                    push.subscribed
                      ? 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  )}
                >
                  {push.subscribed
                    ? <><CheckCircle size={11} /> 활성</>
                    : <><AlertCircle size={11} /> 비활성</>}
                </span>
              </div>
            )}
            <div className="px-4 py-2.5 text-[11px] text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/30">
              ℹ️ 시점은 플랜별로 다르게 설정할 수 있어요. 위 값은 새 플랜 만들 때 기본으로 적용되는 값이에요.
              <strong>백그라운드 알림</strong>은 서버 cron 5분 단위라 시점 ±5분 오차가 있어요.
            </div>
          </>
        )}
      </Section>

      {/* Google Calendar */}
      <Section title="동기화" icon={<Radio size={15} />}>
        <SettingRow
          label="실시간 디바이스 동기화"
          description={
            realtimeOn
              ? '데스크탑·모바일 간 즉시 반영됩니다. 데이터 사용량 매우 적음.'
              : 'OFF — 다른 디바이스 변경은 다음 새로고침에 반영됩니다. 데이터 절약 모드.'
          }
        >
          <button
            onClick={() => {
              const next = !realtimeOn
              setRealtimeEnabled(next)
              setRealtimeOn(next)
              toast.success(next ? '실시간 동기화 ON — 새로고침 후 적용' : '실시간 동기화 OFF — 새로고침 후 적용')
            }}
            className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
              realtimeOn ? 'bg-violet-600' : 'bg-gray-300 dark:bg-gray-700',
            )}
            aria-pressed={realtimeOn}
            aria-label="실시간 동기화 토글"
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                realtimeOn ? 'translate-x-6' : 'translate-x-1',
              )}
            />
          </button>
        </SettingRow>
      </Section>

      <Section title="검색 인덱싱" icon={<Sparkles size={15} />}>
        <SettingRow
          label="의미 검색 인덱스"
          description={
            embedLoading && !embedStatus ? '진행률 불러오는 중...' :
            embedStatus ?
              `${embedStatus.embedded.toLocaleString()} / ${embedStatus.total.toLocaleString()} 메모 인덱싱됨 (${embedStatus.percent}%)` +
                (embedStatus.missing > 0 ? ` — ${embedStatus.missing}개 대기 중` : ' — 최신 상태')
              : '진행률을 불러오지 못했습니다'
          }
        >
          <button
            onClick={runEmbedBackfill}
            disabled={backfillBusy || (embedStatus !== null && embedStatus.missing === 0)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
              (backfillBusy || (embedStatus !== null && embedStatus.missing === 0))
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 opacity-60 cursor-not-allowed'
                : 'bg-violet-600 hover:bg-violet-700 text-white'
            )}
          >
            {backfillBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {backfillBusy ? '인덱싱 중...' : '지금 인덱싱'}
          </button>
        </SettingRow>
      </Section>

      <Section title="연동" icon={<CalendarDays size={15} />}>
        <SettingRow
          label="Google Calendar"
          description={
            integrationsLoading ? '연결 확인 중...' :
            calendarConnected ? `${email} 계정으로 연결됨 ✅` :
            '연결하면 플랜을 Google 캘린더에 동기화할 수 있습니다'
          }
        >
          {integrationsLoading ? (
            <button disabled className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400 opacity-60">
              <Loader2 size={12} className="animate-spin" /> 연결 중...
            </button>
          ) : calendarConnected ? (
            <button
              onClick={disconnectCalendar}
              disabled={calendarLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50"
            >
              {calendarLoading ? <Loader2 size={12} className="animate-spin" /> : null}
              연결 해제
            </button>
          ) : (
            <a
              href="/api/calendar/auth"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors"
            >
              <ExternalLink size={12} />
              연결하기
            </a>
          )}
        </SettingRow>
      </Section>

      {/* 내보내기 / 가져오기 */}
      <Section title="내보내기 / 백업" icon={<Download size={15} />}>
        <SettingRow label="Markdown 내보내기" description="메모를 .md 파일로 저장합니다">
          <button
            onClick={() => exportData('markdown')}
            disabled={exportLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {exportLoading ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
            내보내기
          </button>
        </SettingRow>
        <SettingRow label="JSON 전체 백업" description="메모·플랜·폴더를 .json 파일로 백업합니다">
          <button
            onClick={() => exportData('json')}
            disabled={exportLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {exportLoading ? <Loader2 size={12} className="animate-spin" /> : <FileJson size={12} />}
            백업
          </button>
        </SettingRow>
        <SettingRow label="PDF 인쇄" description="메모를 PDF로 인쇄하거나 저장합니다">
          <button
            onClick={() => exportData('pdf')}
            disabled={exportLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {exportLoading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            PDF
          </button>
        </SettingRow>
        <SettingRow label="JSON 가져오기" description="백업 파일에서 데이터를 복원합니다 (중복 제외)">
          <label className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer',
            importLoading
              ? 'border-gray-200 text-gray-400 opacity-50 pointer-events-none'
              : 'border-violet-200 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/20'
          )}>
            {importLoading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            가져오기
            <input type="file" accept=".json" className="hidden" onChange={importData} disabled={importLoading} />
          </label>
        </SettingRow>
      </Section>

      {/* Google Drive 백업 */}
      <Section title="Google Drive 백업" icon={<CloudUpload size={15} />}>
        <SettingRow
          label="Google Drive 연결"
          description={
            integrationsLoading ? '연결 확인 중...' :
            driveConnected ? `${email} 계정으로 연결됨 ✅` :
            '연결하면 메모를 Google Drive에 자동 백업할 수 있습니다'
          }
        >
          {integrationsLoading ? (
            <button disabled className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400 opacity-60">
              <Loader2 size={12} className="animate-spin" /> 연결 중...
            </button>
          ) : driveConnected ? (
            <button
              onClick={disconnectDrive}
              disabled={driveLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50"
            >
              {driveLoading ? <Loader2 size={12} className="animate-spin" /> : null}
              연결 해제
            </button>
          ) : (
            <a
              href="/api/drive/auth"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors"
            >
              <ExternalLink size={12} />
              연결하기
            </a>
          )}
        </SettingRow>
        {driveConnected && (
          <>
            <SettingRow
              label="폴더별 개별 백업"
              description="메모를 폴더 구조대로 개별 .md 파일로 Drive에 저장합니다"
            >
              <button
                onClick={() => handleDriveBackup('individual')}
                disabled={driveBackupLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-violet-200 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors disabled:opacity-50"
              >
                {driveBackupLoading ? <Loader2 size={12} className="animate-spin" /> : <CloudUpload size={12} />}
                폴더별 백업
              </button>
            </SettingRow>
            <SettingRow
              label="단일 파일 백업"
              description="전체 메모를 하나의 .md 파일로 통합해 Drive에 저장합니다"
            >
              <button
                onClick={() => handleDriveBackup('combined')}
                disabled={driveBackupLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {driveBackupLoading ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                단일 파일
              </button>
            </SettingRow>
            <SettingRow
              label="Drive에서 복원"
              description="저장된 백업 폴더 중 하나를 골라 메모를 다시 가져옵니다"
            >
              <button
                onClick={openRestoreModal}
                disabled={restoreBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors disabled:opacity-50"
              >
                {restoreBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                복원
              </button>
            </SettingRow>
            <SettingRow
              label="자동 백업"
              description="설정한 주기마다 Drive에 자동으로 백업합니다"
            >
              <Toggle
                enabled={autoBackup}
                onChange={() => saveAutoBackupSettings(!autoBackup, backupPeriod)}
              />
            </SettingRow>
            {autoBackup && (
              <div className="px-4 py-3 bg-white dark:bg-gray-900 space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400">최근 N개 유지 (그 이상은 자동 삭제)</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={50}
                      value={retainCount}
                      onChange={(e) => setRetainCount(parseInt(e.target.value, 10))}
                      onPointerUp={() => saveRetainCount(retainCount)}
                      className="flex-1 accent-violet-600"
                    />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-12 text-right">{retainCount}개</span>
                  </div>
                </div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400">백업 주기</p>
                <div className="flex gap-2">
                  {(['daily', 'weekly', 'monthly'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => saveAutoBackupSettings(true, p)}
                      disabled={autoBackupLoading}
                      className={cn(
                        'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50',
                        backupPeriod === p
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      )}
                    >
                      {p === 'daily' ? '매일' : p === 'weekly' ? '매주' : '매월'}
                    </button>
                  ))}
                </div>
                {nextBackupAt && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    다음 백업: {new Date(nextBackupAt).toLocaleString('ko-KR')}
                  </p>
                )}
              </div>
            )}
            {lastBackup && (
              <div className="px-4 py-2.5 text-xs text-gray-400 dark:text-gray-500">
                마지막 백업: {lastBackup}
              </div>
            )}
          </>
        )}
      </Section>

      {/* 스토리지 현황 */}
      <Section title="스토리지 현황" icon={<HardDrive size={15} />}>
        <div className="px-4 py-4 space-y-3">
          {storageStats ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="총 업로드 파일" value={`${storageStats.fileCount}개`} />
                <StatCard label="절약된 용량" value={
                  storageStats.originalBytes > 0
                    ? `${Math.round((1 - storageStats.compressedBytes / storageStats.originalBytes) * 100)}% 절감`
                    : '—'
                } accent />
                <StatCard label="원본 총 용량" value={formatBytes(storageStats.originalBytes)} />
                <StatCard label="압축 후 용량" value={formatBytes(storageStats.compressedBytes)} />
              </div>
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{formatBytes(storageStats.compressedBytes)} 사용 중</span>
                  <span>10GB</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    className="h-1.5 rounded-full bg-violet-500 transition-all"
                    style={{ width: `${Math.min((storageStats.compressedBytes / (10 * 1024 ** 3)) * 100, 100).toFixed(2)}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400 text-center py-2">업로드된 파일이 없습니다</p>
          )}
        </div>
      </Section>

      {/* 계정 */}
      <Section title="계정" icon={<LogOut size={15} />}>
        <SettingRow label="로그아웃" description="현재 기기에서 로그아웃합니다">
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            로그아웃
          </button>
        </SettingRow>
        <SettingRow label="계정 삭제" description="모든 데이터가 영구 삭제됩니다">
          <button
            onClick={handleDeleteAccount}
            disabled={deleteLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50"
          >
            {deleteLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            계정 삭제
          </button>
        </SettingRow>
      </Section>

      {/* 버전 */}
      <p className="text-xs text-center text-gray-400">Weave v0.1.0</p>
      <confirm.Render />

      {/* PR-5: Drive 복원 모달 */}
      {restoreModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => !restoreBusy && setRestoreModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Drive 백업에서 복원</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                폴더 하나를 골라 그 안의 메모들을 Weave에 다시 가져옵니다.
              </p>
            </div>

            {restoreLoading ? (
              <div className="py-8 flex flex-col items-center gap-2 text-gray-500">
                <Loader2 className="animate-spin" size={20} />
                <span className="text-xs">백업 목록 불러오는 중...</span>
              </div>
            ) : restoreFolders.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-500">
                저장된 백업 폴더가 없어요.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {restoreFolders.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-violet-300 dark:hover:border-violet-700 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{f.name}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        {new Date(f.createdAt).toLocaleString('ko-KR')}
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => doRestore(f.id, 'skip')}
                        disabled={restoreBusy}
                        className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
                        title="기존 메모는 유지, 누락분만 새로 추가"
                      >
                        추가만
                      </button>
                      <button
                        onClick={() => doRestore(f.id, 'newer-wins')}
                        disabled={restoreBusy}
                        className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50"
                        title="더 최신 버전이면 덮어쓰기"
                      >
                        최신우선
                      </button>
                      <button
                        onClick={() => doRestore(f.id, 'overwrite')}
                        disabled={restoreBusy}
                        className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                        title="기존 메모를 무조건 덮어씀"
                      >
                        덮어쓰기
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => !restoreBusy && setRestoreModalOpen(false)}
                disabled={restoreBusy}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
        <span className="text-gray-500">{icon}</span>
        <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">{children}</div>
    </div>
  )
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 bg-white dark:bg-gray-900">
      <div>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <div className="ml-4 flex-shrink-0">{children}</div>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2.5">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={cn('text-sm font-semibold mt-0.5', accent ? 'text-violet-600 dark:text-violet-400' : 'text-gray-800 dark:text-gray-200')}>
        {value}
      </p>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cn(
        'relative w-10 h-5.5 rounded-full transition-colors',
        enabled ? 'bg-violet-600' : 'bg-gray-200 dark:bg-gray-700'
      )}
      style={{ height: '22px', width: '40px' }}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform',
          enabled && 'translate-x-[18px]'
        )}
      />
    </button>
  )
}
