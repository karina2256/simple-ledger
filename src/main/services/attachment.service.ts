import { dialog } from 'electron'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDataDir } from '../paths'
import * as repo from '../db/repositories/attachments.repo'
import type { Attachment, WriteResult } from '@shared/types'

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

/** 附件在磁盘上的绝对路径 */
export function resolveAttachmentPath(filePath: string): string {
  return path.join(getDataDir(), filePath)
}

export async function pickImages(): Promise<string[]> {
  const result = await dialog.showOpenDialog({
    title: '选择收据截图',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }]
  })
  return result.canceled ? [] : result.filePaths
}

/**
 * 把用户选的图片复制进数据目录，数据库只存相对路径。
 * 目录结构：attachments/YYYY/MM/<uuid>.<ext>
 */
export function addAttachments(recordId: string, sourcePaths: string[]): Attachment[] {
  const dataDir = getDataDir()
  const now = new Date()
  const relDir = ['attachments', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0')]
  const absDir = path.join(dataDir, ...relDir)
  mkdirSync(absDir, { recursive: true })

  const created: Attachment[] = []
  for (const source of sourcePaths) {
    if (!existsSync(source)) continue
    const ext = path.extname(source).toLowerCase()
    const storedName = `${randomUUID()}${ext}`
    const absTarget = path.join(absDir, storedName)
    copyFileSync(source, absTarget)
    created.push(
      repo.insert({
        recordId,
        filePath: [...relDir, storedName].join('/'),
        fileName: path.basename(source),
        fileType: MIME[ext] ?? 'application/octet-stream',
        fileSize: statSync(absTarget).size
      })
    )
  }
  return created
}

export function removeAttachment(id: string): WriteResult {
  const target = repo.get(id)
  if (!target) return { ok: false, message: '附件不存在' }
  const abs = resolveAttachmentPath(target.filePath)
  repo.remove(id)
  try {
    if (existsSync(abs)) rmSync(abs)
  } catch {
    // 文件可能已被手工删掉，不影响数据库层面的移除
  }
  return { ok: true }
}
