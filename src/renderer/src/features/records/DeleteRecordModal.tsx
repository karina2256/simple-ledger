import { useState } from 'react'
import type { RecordListItem } from '@shared/types'
import { Button, Modal, Segmented } from '../../components/ui'
import { toast, toastError } from '../../stores/toast.store'

/**
 * 删除记录：二选一。
 *  - 移到回收站：软删除，右下角可撤销，物理附件不动
 *  - 彻底删除：从库里移除，附件默认保留，勾选后才删文件
 */
export function DeleteRecordModal({
  record,
  onClose,
  onDone
}: {
  record: RecordListItem
  onClose: () => void
  onDone: () => void | Promise<void>
}): JSX.Element {
  const [mode, setMode] = useState<'soft' | 'purge'>('soft')
  const [dropFiles, setDropFiles] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      if (mode === 'soft') {
        await window.api.records.remove([record.id])
        await onDone()
        toast('已删除 1 笔', 'ok', {
          label: '撤销',
          run: async () => {
            await window.api.records.restore([record.id])
            await onDone()
            toast('已恢复', 'ok')
          }
        })
      } else {
        const result = await window.api.records.purge([record.id], dropFiles)
        await onDone()
        toast(result.message ?? '已彻底删除', 'ok')
      }
      onClose()
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title="删除记录"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            variant={mode === 'purge' ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() => void run()}
          >
            {mode === 'purge' ? '彻底删除' : '移到回收站'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={mode}
          onChange={(value) => setMode(value)}
          options={[
            { value: 'soft', label: '移到回收站' },
            { value: 'purge', label: '彻底删除' }
          ]}
        />
        {mode === 'soft' ? (
          <p className="text-xs text-muted leading-5">
            记录会从列表里消失，右下角浮出的提示里可以点「撤销」恢复。收据文件不受影响。
          </p>
        ) : (
          <>
            <p className="text-xs text-muted leading-5">彻底删除不可撤销，记录行会从数据库里移除。</p>
            {record.attachments.length > 0 ? (
              <label className="flex items-start gap-2 rounded-xl bg-soft p-3 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={dropFiles}
                  onChange={(event) => setDropFiles(event.target.checked)}
                />
                <span className="leading-5">
                  同时删除这 {record.attachments.length} 个收据文件
                  <span className="text-muted block">
                    默认不勾选：图片会继续留在数据目录的 attachments 文件夹里，需要时还能找回来。
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-muted">这笔记录没有收据附件。</p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
