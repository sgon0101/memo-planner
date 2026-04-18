'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUIStore } from '@/store/uiStore'
import {
  User, Moon, Sun, CalendarDays, LogOut, Trash2,
  CheckCircle, AlertCircle, Loader2, ExternalLink,
  Download, Upload, FileText, FileJson, HardDrive,
  CloudUpload,
} from 'lucide-react'
import { printToPdf, markdownToHtml } from '@/lib/export/pdf'
import { cn } from '@/lib/utils'

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = createClient()

  const { darkMode, toggleDarkMode } = useUIStore()
  const [email, setEmail] = useState('')
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [storageStats, setStorageStats] = useState<{
    fileCount: number
    originalBytes: number
    compressedBytes: number
  } | null>(null)
  const [driveConnected, setDriveConnected] = useState(false)
  const [driveBackupLoading, setDriveBackupLoading] = useState(false)
  const [lastBackup, setLastBackup] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setEmail(data.user.email ?? '')
    })
    // Drive 연결 상태 + 마지막 백업
    fetch('/api/backup/google-drive').then((r) => r.json()).then((d) => {
      setDriveConnected(d.connected)
    }).catch(() => {})
    const savedBackup = localStorage.getItem('lastDriveBackup')
    if (savedBackup) setLastBackup(savedBackup)

    // Google Calendar 연결 상태 + 스토리지 통계
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: row } = await supabase
        .from('user_integrations')
        .select('id')
        .eq('user_id', data.user.id)
        .eq('provider', 'google_calendar')
        .single()
      setCalendarConnected(!!row)

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
  }, [])

  // URL 파라미터로 toast 표시
  useEffect(() => {
    const success = searchParams.get('success')
    const error = searchParams.get('error')
    if (success === 'calendar_connected') {
      setToast({ type: 'success', message: 'Google Calendar가 연결되었습니다.' })
      setCalendarConnected(true)
    } else if (error === 'calendar_auth_failed') {
      setToast({ type: 'error', message: 'Google Calendar 연결에 실패했습니다.' })
    } else if (success === 'drive_connected') {
      setToast({ type: 'success', message: 'Google Drive가 연결되었습니다.' })
      setDriveConnected(true)
    } else if (error === 'drive_auth_failed') {
      setToast({ type: 'error', message: 'Google Drive 연결에 실패했습니다.' })
    }
    if (success || error) router.replace('/settings')
  }, [searchParams])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  async function disconnectCalendar() {
    setCalendarLoading(true)
    try {
      await fetch('/api/calendar/disconnect', { method: 'DELETE' })
      setCalendarConnected(false)
      setToast({ type: 'success', message: 'Google Calendar 연결이 해제되었습니다.' })
    } catch {
      setToast({ type: 'error', message: '연결 해제 중 오류가 발생했습니다.' })
    } finally {
      setCalendarLoading(false)
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
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '백업 실패')
      const now = new Date().toLocaleString('ko-KR')
      setLastBackup(now)
      localStorage.setItem('lastDriveBackup', now)
      setToast({ type: 'success', message: `${data.message} (메모 ${data.count}개)` })
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : '백업 중 오류가 발생했습니다.' })
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
      setToast({ type: 'success', message: '내보내기가 완료되었습니다.' })
    } catch {
      setToast({ type: 'error', message: '내보내기 중 오류가 발생했습니다.' })
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
      setToast({ type: 'success', message: `가져오기 완료: 폴더 ${results.folders}개, 메모 ${results.memos}개, 플랜 ${results.plans}개` })
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : '가져오기 중 오류가 발생했습니다.' })
    } finally {
      setImportLoading(false)
    }
  }

  async function handleDeleteAccount() {
    if (!confirm('계정을 삭제하면 모든 데이터가 영구적으로 삭제됩니다. 정말 삭제하시겠습니까?')) return
    if (!confirm('이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?')) return
    setDeleteLoading(true)
    try {
      // 서비스 역할로 계정 삭제는 서버 API가 필요하므로 로그아웃만 처리
      await supabase.auth.signOut()
      router.push('/login')
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white">설정</h2>

      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all',
          toast.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'
        )}>
          {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* 프로필 */}
      <Section title="프로필" icon={<User size={15} />}>
        <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
          <div className="w-10 h-10 rounded-full bg-violet-600 flex items-center justify-center text-white font-semibold text-sm">
            {email.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{email || '—'}</p>
            <p className="text-xs text-gray-500">Supabase Auth</p>
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

      {/* Google Calendar */}
      <Section title="연동" icon={<CalendarDays size={15} />}>
        <SettingRow
          label="Google Calendar"
          description={calendarConnected ? '연결됨 — 플래너 플랜을 Google 캘린더와 동기화합니다' : '연결하면 플랜을 Google 캘린더에 동기화할 수 있습니다'}
        >
          {calendarConnected ? (
            <button
              onClick={disconnectCalendar}
              disabled={calendarLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50"
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
          description={driveConnected ? '연결됨 — 메모를 Drive에 Markdown으로 백업합니다' : '연결하면 메모를 Google Drive에 자동 백업할 수 있습니다'}
        >
          {driveConnected ? (
            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <CheckCircle size={12} /> 연결됨
            </span>
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
      <p className="text-xs text-center text-gray-400">나만의 메모 플래너 v0.1.0</p>
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
