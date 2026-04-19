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
