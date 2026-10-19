import { randomUUID } from 'node:crypto'
import { getDb } from '../connection'
import type { Attachment } from '@shared/types'

interface Row {
  id: string
  record_id: string
  file_path: string
  file_name: string
  file_type: string
  file_size: number
  created_at: number
}

function map(row: Row): Attachment {
  return {
    id: row.id,
    recordId: row.record_id,
    filePath: row.file_path,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: row.file_size,
    createdAt: row.created_at
  }
}

export function listByRecord(recordId: string): Attachment[] {
  const rows = getDb()
    .prepare('SELECT * FROM attachments WHERE record_id = ? ORDER BY created_at')
    .all(recordId) as Row[]
  return rows.map(map)
}

export function listByRecords(recordIds: string[]): Map<string, Attachment[]> {
  const result = new Map<string, Attachment[]>()
  if (recordIds.length === 0) return result
  const marks = recordIds.map(() => '?').join(',')
  const rows = getDb()
    .prepare(`SELECT * FROM attachments WHERE record_id IN (${marks}) ORDER BY created_at`)
    .all(...recordIds) as Row[]
  for (const row of rows) {
    const item = map(row)
    const list = result.get(item.recordId)
    if (list) list.push(item)
    else result.set(item.recordId, [item])
  }
  return result
}

export function get(id: string): Attachment | null {
  const row = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Row | undefined
  return row ? map(row) : null
}

export function insert(input: Omit<Attachment, 'id' | 'createdAt'>): Attachment {
  const id = randomUUID()
  const ts = Date.now()
  getDb()
    .prepare(
      `INSERT INTO attachments (id, record_id, file_path, file_name, file_type, file_size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.recordId, input.filePath, input.fileName, input.fileType, input.fileSize, ts)
  return get(id) as Attachment
}

export function remove(id: string): void {
  getDb().prepare('DELETE FROM attachments WHERE id = ?').run(id)
}

export function countByRecord(recordId: string): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM attachments WHERE record_id = ?').get(recordId) as {
    n: number
  }
  return row.n
}
