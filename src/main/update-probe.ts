import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { checkUpdate } from './services/security.service'

/**
 * 检查更新的端到端自检。
 *
 * 为什么要专门起一个本地 HTTP 服务：这个功能的核心风险不在「版本号怎么比」，
 * 而在「网络不通 / 清单格式不对 / 字段缺失时会不会把应用卡死或谎报有新版」。
 * 那三种情况只有真发一次请求才验得到。
 */
export async function runUpdateProbe(): Promise<number> {
  const results: { name: string; ok: boolean; detail: string }[] = []
  const check = (name: string, ok: boolean, detail: unknown): void => {
    results.push({ name, ok, detail: String(detail) })
  }

  // ---- 1. 正常路径：清单里有更高版本 ----
  // 注意：不能写死「9.9.9 一定更新」——未打包运行时 app.getVersion() 返回的是
  // Electron 自己的版本（比如 34.5.8），反而比 9.9.9 大。这里按实际当前版本
  // 造一个「下一个小版本」，断言才与运行环境无关。
  const current = (await checkUpdate()).current
  const parts = current.replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const nextVersion = `${parts[0]}.${(parts[1] ?? 0) + 1}.0`

  const goodServer = createServer((request, response) => {
    if (request.url === '/update.json') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ version: nextVersion, url: 'https://example.com/download', notes: '测试用新版' }))
      return
    }
    response.writeHead(404).end('not found')
  })
  await new Promise<void>((resolve) => goodServer.listen(0, '127.0.0.1', resolve))
  const goodPort = (goodServer.address() as AddressInfo).port

  try {
    process.env['LEDGER_UPDATE_URL'] = `http://127.0.0.1:${goodPort}/update.json`
    const result = await checkUpdate()
    check(
      `能读到清单并判定有新版本（${current} → ${nextVersion}）`,
      result.ok && result.hasUpdate,
      `current=${result.current} latest=${result.latest}`
    )
    check('返回了最新版本号', result.latest === nextVersion, String(result.latest))
    check('返回了下载地址', result.url === 'https://example.com/download', String(result.url))
    check('返回了更新说明', result.notes === '测试用新版', String(result.notes))
    check('当前版本不是空的', Boolean(result.current), result.current)

    // ---- 2. 同版本：不该报有新版 ----
    goodServer.closeAllConnections()
    const sameServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ version: result.current, url: 'https://example.com' }))
    })
    await new Promise<void>((resolve) => sameServer.listen(0, '127.0.0.1', resolve))
    const samePort = (sameServer.address() as AddressInfo).port
    process.env['LEDGER_UPDATE_URL'] = `http://127.0.0.1:${samePort}/update.json`
    const same = await checkUpdate()
    check('版本相同时不报有新版', same.ok && !same.hasUpdate, `current=${same.current} latest=${same.latest}`)
    sameServer.closeAllConnections()
    await new Promise<void>((resolve) => sameServer.close(() => resolve()))

    // ---- 3. 清单格式不对：必须失败但不能抛 ----
    const badServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"hello":"world"}')
    })
    await new Promise<void>((resolve) => badServer.listen(0, '127.0.0.1', resolve))
    const badPort = (badServer.address() as AddressInfo).port
    process.env['LEDGER_UPDATE_URL'] = `http://127.0.0.1:${badPort}/update.json`
    const bad = await checkUpdate()
    check('清单缺 version 时返回失败而不是抛异常', !bad.ok && Boolean(bad.message), bad.message ?? '')
    check('失败时不给假的下载地址', bad.url === null && bad.latest === null, `url=${bad.url} latest=${bad.latest}`)
    badServer.closeAllConnections()
    await new Promise<void>((resolve) => badServer.close(() => resolve()))

    // ---- 4. 端口没人听：网络错误路径 ----
    process.env['LEDGER_UPDATE_URL'] = `http://127.0.0.1:${badPort + 1}/update.json`
    const down = await checkUpdate()
    check('连不上时返回失败而不是卡死', !down.ok && Boolean(down.message), (down.message ?? '').slice(0, 60))
    check('连不上时 hasUpdate 保持 false', !down.hasUpdate, String(down.hasUpdate))

    // ---- 5. 没配地址：明确说未配置，不去请求 ----
    delete process.env['LEDGER_UPDATE_URL']
    const none = await checkUpdate()
    check('没配地址时提示未配置', !none.ok && (none.message ?? '').includes('更新清单'), (none.message ?? '').slice(0, 40))
  } catch (error) {
    check('探针执行完成', false, error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
  } finally {
    delete process.env['LEDGER_UPDATE_URL']
    await new Promise<void>((resolve) => goodServer.close(() => resolve()))
  }

  const passed = results.filter((item) => item.ok).length
  console.log(`\n===== 检查更新验证：${passed}/${results.length} 通过 =====`)
  for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
  return passed === results.length ? 0 : 1
}
