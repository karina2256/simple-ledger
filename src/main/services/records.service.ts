import { existsSync, rmSync } from 'node:fs'
import * as attachmentsRepo from '../db/repositories/attachments.repo'
import * as recordsRepo from '../db/repositories/records.repo'
import type { WriteResult } from '@shared/types'
import { resolveAttachmentPath } from './attachment.service'

/**
 * 彻底删除记录（不可撤销）。
 *
 * 附件文件默认保留 —— 数据库行会被删掉，但磁盘上的图片不动，避免手滑之后连图都没了。
 * 只有调用方明确要求 deleteAttachments 时才真删文件。
 */
export function purgeRecords(ids: string[], deleteAttachments: boolean): WriteResult {
  if (ids.length === 0) return { ok: false, message: '没有选中任何记录' }

  const files: string[] = []
  for (const id of ids) {
    for (const attachment of attachmentsRepo.listByRecord(id)) {
      files.push(resolveAttachmentPath(attachment.filePath))
    }
  }

  // attachments 行由 records 的外键级联删除
  const changes = recordsRepo.hardDelete(ids)

  if (deleteAttachments) {
    for (const file of files) {
      try {
        if (existsSync(file)) rmSync(file)
      } catch {
        // 文件可能已被手工删除，不影响数据库层面的结果
      }
    }
  }

  return {
    ok: changes > 0,
    message: deleteAttachments
      ? `已彻底删除 ${changes} 笔记录及其 ${files.length} 个收据文件`
      : `已彻底删除 ${changes} 笔记录，另外 ${files.length} 个收据文件保留在数据目录里`
  }
}
