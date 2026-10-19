/** 附件相对路径 → 渲染进程可用的 URL（由主进程注册的 ledger:// 协议提供文件） */
export function attachmentUrl(relativePath: string): string {
  const encoded = relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `ledger://local/${encoded}`
}
