import { writeFileSync } from 'node:fs'

export interface ProbeResult {
  name: string
  ok: boolean
  detail: string
}

/**
 * 统一的探针输出：打印到控制台，同时（若设置了 LEDGER_PROBE_REPORT）写一份文件。
 * 打包后的 GUI 程序 stdout 不保证能被父进程拿到，所以文件是可靠通道。
 */
export function finishProbe(title: string, results: ProbeResult[]): number {
  const failed = results.filter((item) => !item.ok)
  const lines = [
    `===== ${title} =====`,
    ...results.map((item) => `${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  ${item.detail}`),
    `===== ${results.length - failed.length}/${results.length} 通过 =====`
  ]
  for (const line of lines) console.log(line)

  const target = process.env['LEDGER_PROBE_REPORT']
  if (target) {
    try {
      writeFileSync(target, `${lines.join('\n')}\n`, 'utf-8')
    } catch {
      /* 写不进去也不影响进程退出码 */
    }
  }

  return failed.length === 0 ? 0 : 1
}
