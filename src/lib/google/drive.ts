import { google } from 'googleapis'

export function getDriveOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    `${process.env.NEXTAUTH_URL}/api/drive/callback`
  )
}

export function getDriveAuthUrl(state: string) {
  const client = getDriveOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    state,
  })
}

export async function getDriveClient(accessToken: string, refreshToken: string) {
  const client = getDriveOAuthClient()
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken })
  return google.drive({ version: 'v3', auth: client })
}

export async function createDriveFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId?: string
): Promise<string> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
  })
  return res.data.id!
}

export async function uploadDriveFile(
  drive: ReturnType<typeof google.drive>,
  name: string,
  content: string,
  parentId?: string
): Promise<string> {
  const { Readable } = await import('stream')
  const res = await drive.files.create({
    requestBody: {
      name,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    media: {
      mimeType: 'text/markdown',
      body: Readable.from([content]),
    },
    fields: 'id',
  })
  return res.data.id!
}

/** 폴더 내 파일 목록 (페이지네이션 자동) */
export async function listDriveFiles(
  drive: ReturnType<typeof google.drive>,
  parentId: string,
  filter?: { mimeType?: string; nameContains?: string }
): Promise<Array<{ id: string; name: string; mimeType: string; createdTime: string; modifiedTime: string }>> {
  const results: Array<{ id: string; name: string; mimeType: string; createdTime: string; modifiedTime: string }> = []
  let pageToken: string | undefined = undefined

  do {
    const qParts = [`'${parentId}' in parents`, 'trashed=false']
    if (filter?.mimeType) qParts.push(`mimeType='${filter.mimeType}'`)
    if (filter?.nameContains) qParts.push(`name contains '${filter.nameContains.replace(/'/g, "\\'")}'`)
    const res = (await drive.files.list({
      q: qParts.join(' and '),
      fields: 'nextPageToken, files(id, name, mimeType, createdTime, modifiedTime)',
      pageSize: 1000,
      pageToken,
    })) as {
      data: {
        files?: Array<{ id?: string | null; name?: string | null; mimeType?: string | null; createdTime?: string | null; modifiedTime?: string | null }>
        nextPageToken?: string | null
      }
    }
    for (const f of res.data.files ?? []) {
      results.push({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        createdTime: f.createdTime!,
        modifiedTime: f.modifiedTime!,
      })
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return results
}

/** Drive 파일 텍스트 내용 다운로드 */
export async function downloadDriveFile(
  drive: ReturnType<typeof google.drive>,
  fileId: string
): Promise<string> {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  )
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
}

/** Drive 파일/폴더 삭제 (휴지통으로) */
export async function deleteDriveFile(
  drive: ReturnType<typeof google.drive>,
  fileId: string
): Promise<void> {
  await drive.files.update({
    fileId,
    requestBody: { trashed: true },
  })
}

/** 부모 폴더에서 이름 패턴으로 백업 폴더 목록 + 정렬 */
export async function listBackupFolders(
  drive: ReturnType<typeof google.drive>,
  rootFolderId: string | undefined,
  namePrefix: string = '메모플래너_'
): Promise<Array<{ id: string; name: string; createdTime: string }>> {
  const parentId = rootFolderId || 'root'
  const qParts = [
    `'${parentId}' in parents`,
    `mimeType='application/vnd.google-apps.folder'`,
    `name contains '${namePrefix.replace(/'/g, "\\'")}'`,
    'trashed=false',
  ]
  const folders: Array<{ id: string; name: string; createdTime: string }> = []
  let pageToken: string | undefined = undefined
  do {
    const res = (await drive.files.list({
      q: qParts.join(' and '),
      fields: 'nextPageToken, files(id, name, createdTime)',
      pageSize: 1000,
      pageToken,
      orderBy: 'createdTime desc',
    })) as {
      data: {
        files?: Array<{ id?: string | null; name?: string | null; createdTime?: string | null }>
        nextPageToken?: string | null
      }
    }
    for (const f of res.data.files ?? []) {
      folders.push({ id: f.id!, name: f.name!, createdTime: f.createdTime! })
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return folders
}
