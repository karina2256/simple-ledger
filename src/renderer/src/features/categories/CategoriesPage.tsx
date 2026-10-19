import { useEffect, useState } from 'react'
import type { CategoryInput, CategoryNode, CategoryType, CategoryUsage, MigrateResult } from '@shared/types'
import { Button, Card, Field, Hint, Input, Modal, Segmented } from '../../components/ui'
import { EntityIcon, Icon } from '../../components/Icon'
import { useAppStore } from '../../stores/app.store'
import { toast, toastError } from '../../stores/toast.store'

const COLORS = ['#4FB3A5', '#4A9BD1', '#7B8CE0', '#A97BD1', '#D96BA8', '#E8836B', '#C4B24A', '#7FBF7A', '#C9895E', '#8A9BA8']

interface EditorState {
  open: boolean
  parentId: string | null
  editingId: string | null
  form: CategoryInput
}

/**
 * 分类的删除分支，与账户一致：
 *  - 没有记录也没有子分类 → 真删除
 *  - 其它 → 二选一：归档（子分类一并归档），或迁移到同类型分类后归档
 */
function DeleteCategoryModal({
  category,
  targets,
  onClose,
  onDone
}: {
  category: CategoryNode
  targets: CategoryNode[]
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const [usage, setUsage] = useState<CategoryUsage | null>(null)
  const [mode, setMode] = useState<'archive' | 'migrate'>('archive')
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)

  // 可迁移的目标：同类型、未归档、且不是它自己
  const options = targets
    .filter((node) => node.type === category.type && node.id !== category.id)
    .flatMap((node) => [node, ...node.children.filter((child) => child.id !== category.id)])

  const firstTargetId = options[0]?.id ?? ''

  useEffect(() => {
    setTargetId(firstTargetId)
    window.api.categories
      .usage(category.id)
      .then(setUsage)
      .catch(toastError)
  }, [category.id, firstTargetId])

  const canHardDelete = usage?.canHardDelete ?? false

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      if (canHardDelete) {
        const result = await window.api.categories.remove(category.id)
        toast(result.message ?? (result.ok ? '分类已删除' : '删除失败'), result.ok ? 'ok' : 'warn')
      } else if (mode === 'archive') {
        const result: MigrateResult = await window.api.categories.archive(category.id)
        const extra = result.archivedChildren ? `（含 ${result.archivedChildren} 个子分类）` : ''
        toast(`${result.message ?? '分类已归档'}${extra}`, result.ok ? 'ok' : 'warn')
      } else {
        if (!targetId) return toast('请选择迁移到的目标分类', 'error')
        const result: MigrateResult = await window.api.categories.migrateAndArchive(category.id, targetId)
        if (!result.ok) return toast(result.message ?? '迁移失败', 'warn')
        const extra = [
          `迁移 ${result.movedRecords ?? 0} 笔记录`,
          result.archivedChildren ? `连带归档 ${result.archivedChildren} 个子分类` : null,
          result.movedRecurring ? `迁移 ${result.movedRecurring} 条预算` : null
        ]
          .filter(Boolean)
          .join('，')
        toast(`${result.message}（${extra}）`, 'ok')
      }
      onDone()
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
      title={`删除分类「${category.name}」`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            variant={canHardDelete ? 'danger' : 'primary'}
            disabled={busy || (!canHardDelete && mode === 'migrate' && options.length === 0)}
            onClick={() => void run()}
          >
            {canHardDelete ? '确认删除' : mode === 'archive' ? '归档' : '迁移并归档'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!usage ? (
          <p className="text-sm text-muted">正在读取该分类的使用情况…</p>
        ) : canHardDelete ? (
          <p className="text-sm leading-6">该分类下没有记录、也没有子分类，可以安全删除。删除后不可恢复。</p>
        ) : (
          <>
            <div className="rounded-xl bg-soft p-4 text-sm leading-6">
              <div className="text-muted">
                关联 {usage.recordCount} 笔记录 · {usage.childCount} 个子分类
              </div>
            </div>
            <Segmented
              value={mode}
              onChange={(value) => setMode(value)}
              options={[
                { value: 'archive', label: '仅归档' },
                { value: 'migrate', label: '迁移到其它分类并归档' }
              ]}
            />
            {mode === 'archive' ? (
              <p className="text-xs text-muted leading-5">
                归档后该分类不再出现在记录表单的下拉与筛选中，历史记录仍然显示它的名字。
                一级分类归档时，它下面的子分类会一并归档。之后可以在本页底部的「已归档分类」里恢复。
              </p>
            ) : (
              <div className="space-y-3">
                <Field label="迁移到">
                  <select
                    value={targetId}
                    onChange={(event) => setTargetId(event.target.value)}
                    className="h-9 w-full rounded-lg border border-line bg-card px-3 text-sm text-main outline-none focus:border-accent"
                  >
                    {options.length === 0 ? <option value="">没有同类型的其它分类</option> : null}
                    {options.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.icon} {item.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="text-xs text-muted leading-5">
                  该分类（含子分类）下的记录会改挂到目标分类，相关预算一并迁移；目标上已有同周期预算时保留目标那条。
                  源分类整棵子树随后归档。
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

export function CategoriesPage(): JSX.Element {
  const categories = useAppStore((state) => state.categories)
  const archivedCategories = useAppStore((state) => state.archivedCategories)
  const refreshCategories = useAppStore((state) => state.refreshCategories)

  const [type, setType] = useState<CategoryType>('expense')
  const [editor, setEditor] = useState<EditorState>({
    open: false,
    parentId: null,
    editingId: null,
    form: { name: '', icon: '🏷️', color: COLORS[0], type: 'expense', parentId: null }
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<CategoryNode | null>(null)

  const tree = categories.filter((node) => node.type === type)

  const openCreate = (parent: CategoryNode | null): void => {
    setEditor({
      open: true,
      parentId: parent?.id ?? null,
      editingId: null,
      form: {
        name: '',
        icon: parent ? '🏷️' : '📁',
        color: parent?.color ?? COLORS[0],
        type,
        parentId: parent?.id ?? null
      }
    })
  }

  const openEdit = (node: CategoryNode): void => {
    setEditor({
      open: true,
      parentId: node.parentId,
      editingId: node.id,
      form: { name: node.name, icon: node.icon, color: node.color, type: node.type, parentId: node.parentId }
    })
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      if (editor.editingId) await window.api.categories.update(editor.editingId, editor.form)
      else await window.api.categories.create({ ...editor.form, type, parentId: editor.parentId })
      await refreshCategories()
      toast(editor.editingId ? '分类已更新' : '分类已添加', 'ok')
      setEditor({ ...editor, open: false })
    } catch (error) {
      toastError(error)
    } finally {
      setSaving(false)
    }
  }

  const restore = async (node: CategoryNode): Promise<void> => {
    try {
      const result = await window.api.categories.restore(node.id)
      if (!result.ok) return toast(result.message ?? '恢复失败', 'warn')
      await refreshCategories()
      toast('分类已恢复', 'ok')
    } catch (error) {
      toastError(error)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="cinema-page-title cinema-title text-xl font-medium">分类</h1>
          <Segmented
            value={type}
            onChange={(value) => setType(value)}
            options={[
              { value: 'expense', label: '支出分类' },
              { value: 'income', label: '收入分类' }
            ]}
          />
        </div>
        <Button type="button" variant="primary" onClick={() => openCreate(null)}>
          <Icon name="plus" size={16} /> 新增一级分类
        </Button>
      </div>

      <div className="space-y-3">
        {tree.map((parent) => (
          <Card key={parent.id} className="cinema-reveal" tilt>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: `${parent.color}22` }}
                >
                  <EntityIcon value={parent.icon} size={20} />
                </span>
                <span className="font-medium">{parent.name}</span>
                <span className="text-xs text-muted">{parent.children.length} 个子分类</span>
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" className="h-8" onClick={() => openCreate(parent)}>
                  <Icon name="plus" size={16} /> 子分类
                </Button>
                <Button type="button" variant="ghost" className="h-8" onClick={() => openEdit(parent)}>
                  编辑
                </Button>
                <Button type="button" variant="danger" className="h-8" onClick={() => setDeleting(parent)}>
                  删除
                </Button>
              </div>
            </div>

            {parent.children.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {parent.children.map((child) => (
                  <span
                    key={child.id}
                    className="group inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 h-8 text-sm"
                  >
                    <EntityIcon value={child.icon} size={16} />
                    <span>{child.name}</span>
                    <button
                      type="button"
                      className="text-muted hover:text-accent opacity-0 group-hover:opacity-100 transition"
                      onClick={() => openEdit(child)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition"
                      onClick={() => setDeleting(child)}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
        ))}
      </div>

      <Card className="mt-5">
        <h2 className="text-sm font-medium mb-1">已归档分类</h2>
        <Hint>归档的分类不出现在记录表单的下拉与筛选里，历史记录仍然显示它的名字。恢复后重新可选。</Hint>
        <div className="mt-3">
          {archivedCategories.length === 0 ? (
            <p className="text-xs text-muted py-2">暂无归档分类</p>
          ) : (
            archivedCategories.map((node) => (
              <div key={node.id} className="py-2.5 border-b border-line last:border-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center opacity-70"
                      style={{ background: `${node.color}22` }}
                    >
                      {node.icon}
                    </span>
                    <div>
                      <div className="text-sm">{node.name}</div>
                      <div className="text-xs text-muted">
                        {node.type === 'income' ? '收入' : '支出'}
                        {node.children.length ? ` · 含 ${node.children.length} 个已归档子分类` : ''}
                        {node.archivedAt ? ` · 归档于 ${new Date(node.archivedAt).toLocaleDateString('zh-CN')}` : ''}
                      </div>
                    </div>
                  </div>
                  <Button type="button" className="h-8" onClick={() => void restore(node)}>
                    恢复
                  </Button>
                </div>
                {node.children.length ? (
                  <div className="mt-2 ml-11 flex flex-wrap gap-2 text-xs text-muted">
                    {node.children.map((child) => (
                      <span key={child.id} className="rounded-lg border border-line px-2 h-7 inline-flex items-center">
                        {child.icon} {child.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>

      <Modal
        open={editor.open}
        title={editor.editingId ? '编辑分类' : editor.parentId ? '新增子分类' : '新增一级分类'}
        onClose={() => setEditor({ ...editor, open: false })}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setEditor({ ...editor, open: false })}>
              取消
            </Button>
            <Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="分类名称">
              <Input
                value={editor.form.name}
                placeholder="例如：外卖"
                onChange={(event) =>
                  setEditor({ ...editor, form: { ...editor.form, name: event.target.value } })
                }
              />
            </Field>
            <Field label="图标（emoji）">
              <Input
                value={editor.form.icon}
                maxLength={4}
                onChange={(event) =>
                  setEditor({ ...editor, form: { ...editor.form, icon: event.target.value } })
                }
              />
            </Field>
          </div>
          <Field label="颜色">
            <div className="flex flex-wrap gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setEditor({ ...editor, form: { ...editor.form, color } })}
                  className={`w-7 h-7 rounded-full transition ${editor.form.color === color ? 'ring-2 ring-offset-2 ring-accent ring-offset-card' : ''}`}
                  style={{ background: color }}
                />
              ))}
            </div>
          </Field>
          <p className="text-xs text-muted">只支持两级：一级分类下可以再建子分类，子分类下不能再分。</p>
        </div>
      </Modal>

      {deleting ? (
        <DeleteCategoryModal
          category={deleting}
          targets={categories}
          onClose={() => setDeleting(null)}
          onDone={() => void refreshCategories()}
        />
      ) : null}
    </div>
  )
}
