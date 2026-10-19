/**
 * 本地预览官网：起一个极简静态服务器（零依赖，用 Node 自带 http）。
 *
 * 用法：npm run site  然后打开 http://127.0.0.1:5173
 * 为什么要自己写：npx http-server 要联网装包，而且容易被当成后台任务回收；
 * 这里只用 node:http + node:fs，几行就够，也不会阻塞其它验证脚本。
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'website')
const port = Number(process.env.PORT ?? 5173)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
}

createServer((request, response) => {
  const urlPath = decodeURIComponent((request.url ?? '/').split('?')[0])
  let file = path.join(root, urlPath === '/' ? 'index.html' : urlPath)
  // 防目录穿越
  if (!file.startsWith(root)) {
    response.writeHead(403).end('forbidden')
    return
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!existsSync(file)) {
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<h1>404</h1><p>没有这个页面。<a href="/">回首页</a></p>')
    return
  }
  response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  response.end(readFileSync(file))
}).listen(port, '127.0.0.1', () => {
  console.log(`官网预览：http://127.0.0.1:${port}`)
  console.log('（Ctrl+C 停止）')
})
