import { net, protocol } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getDataDir } from './paths'

export const LEDGER_SCHEME = 'ledger'

/**
 * 在 app ready 之前调用，让 ledger:// 具备标准协议的能力。
 * 渲染进程用它来显示收据图片：ledger://local/attachments/2025/06/xxx.png
 */
export function registerLedgerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LEDGER_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** app ready 之后调用 */
export function registerLedgerProtocol(): void {
  protocol.handle(LEDGER_SCHEME, (request) => {
    try {
      const url = new URL(request.url)
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const dataDir = path.resolve(getDataDir())
      const target = path.resolve(path.join(dataDir, relative))
      // 越界保护：只允许读数据目录内的文件
      if (!target.startsWith(dataDir + path.sep)) {
        return new Response('越界访问被拒绝', { status: 403 })
      }
      if (!existsSync(target)) {
        return new Response('文件不存在', { status: 404 })
      }
      return net.fetch(pathToFileURL(target).toString())
    } catch (error) {
      return new Response(`读取失败：${String(error)}`, { status: 500 })
    }
  })
}
