import { isOpen } from '../db/connection'

/** 数据库没准备好时直接拒绝写操作，避免出现半初始化状态 */
export function assertReady(): void {
  if (!isOpen()) throw new Error('数据库尚未初始化，请先完成首次启动引导')
}
