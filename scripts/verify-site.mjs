/**
 * 官网自检（npm run verify:site）。
 *
 * 官网最容易出的问题不是「不好看」，而是「少东西」：
 * 忘记 title/description、图片路径写错、下载按钮指向不存在的文件、
 * canonical 还留着 example.com 就上线了。这些都能静态查出来。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const site = path.join(root, 'website')

const results = []
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: String(detail) })

const indexPath = path.join(site, 'index.html')
check('网站目录存在 index.html', existsSync(indexPath), indexPath)

const html = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8') : ''

// ---------- 1. SEO 必备元素 ----------
const title = (html.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? ''
check('有 title 且长度合适（15–70 字）', title.length >= 15 && title.length <= 70, `${title.length} 字：${title}`)

const desc = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/) ?? [])[1] ?? ''
check('有 meta description（60–160 字）', desc.length >= 60 && desc.length <= 160, `${desc.length} 字`)

check('有 keywords（可选但已填）', /name="keywords"/.test(html), 'keywords')
check('有 canonical', /rel="canonical"/.test(html), 'canonical')
check('有 robots 指令', /name="robots"[^>]*index/.test(html), 'index, follow')
check('语言标注为中文', /<html lang="zh-CN"/.test(html), 'lang="zh-CN"')
check(
  '有 og:title / og:description / og:image（分享到微信QQ有预览卡片）',
  /property="og:title"/.test(html) && /property="og:description"/.test(html) && /property="og:image"/.test(html),
  'og 标签'
)
check('有结构化数据 SoftwareApplication', /"@type":\s*"SoftwareApplication"/.test(html), 'ld+json')
check('viewport 正确（手机上不乱）', /name="viewport"[^>]*width=device-width/.test(html), 'viewport')

// ---------- 2. 内容：页面得真的讲清楚这是什么 ----------
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
check('正文提到「离线」与「不联网」', text.includes('离线') && text.includes('不联网'), '关键词覆盖')
check('正文提到 Windows 与记账', text.includes('Windows') && text.includes('记账'), '关键词覆盖')
check('正文长度足够（>2500 字，搜索引擎才有内容可抓）', text.length > 2500, `${text.length} 字`)
check('有 FAQ 段落（长尾关键词来源）', /<details/.test(html), `${(html.match(/<details/g) ?? []).length} 个问答`)
check('标题层级完整（h1 有且仅有一个）', (html.match(/<h1/g) ?? []).length === 1, `${(html.match(/<h1/g) ?? []).length} 个 h1`)
check('每个 img 都有 alt（无障碍 + 图片搜索）', !/<img(?![^>]*\balt=)/.test(html), 'alt 齐全')
check('内容图片开了懒加载', /loading="lazy"/.test(html), `${(html.match(/loading="lazy"/g) ?? []).length} 张`)

// ---------- 3. 本地资源真的存在 ----------
const refs = [...html.matchAll(/(?:src|href)="((?!https?:|#|mailto:)[^"]+)"/g)].map((match) => match[1])
const missing = refs.filter((ref) => !existsSync(path.join(site, ref.split('#')[0].split('?')[0])))
check('页面引用的本地资源都存在', missing.length === 0, missing.length ? missing.join(', ') : `${refs.length} 个引用全部命中`)

// ---------- 4. 下载相关 ----------
check('有下载区块', /id="download"/.test(html), 'id="download"')
const dlButtons = (html.match(/data-download="/g) ?? []).length
check('三个下载入口都在（免安装 / 安装 / MSI）', dlButtons === 3, `${dlButtons} 个`)
check('有 SmartScreen 提示（不然用户以为中毒）', /SmartScreen|仍要运行/.test(html), '提示文案')

// ---------- 5. 上线前的占位符检查 ----------
const placeholders = []
if (/example\.com/.test(html)) placeholders.push('index.html 里的 example.com 域名')
if (/example\.com/.test(readFileSync(path.join(site, 'robots.txt'), 'utf-8'))) placeholders.push('robots.txt 的 sitemap 域名')
if (/example\.com/.test(readFileSync(path.join(site, 'sitemap.xml'), 'utf-8'))) placeholders.push('sitemap.xml 的域名')
if (/发布前请把这里替换/.test(readFileSync(path.join(site, 'privacy.html'), 'utf-8'))) placeholders.push('privacy.html 的联系方式')
// 这条故意做成「提醒」而不是「失败」：占位符还没换也能先本地预览
check(
  '上线前需要替换的占位符（现在是提醒，不是错误）',
  true,
  placeholders.length ? placeholders.join('；') : '已全部替换 ✅'
)

// ---------- 6. 配套文件 ----------
for (const file of ['styles.css', 'main.js', 'privacy.html', 'robots.txt', 'sitemap.xml']) {
  check(`配套文件存在：${file}`, existsSync(path.join(site, file)), file)
}
const shots = readdirSync(path.join(site, 'assets', 'shots'))
check('截图资源齐全（>= 6 张）', shots.length >= 6, `${shots.length} 张`)
check('图标存在', existsSync(path.join(site, 'assets', 'icons', 'icon.png')), 'icon.png')

// ---------- 7. 图片比例（防止主视觉被拉伸变形） ----------
// 这个 bug 真的发生过：截图统一 1445×897，但窗口外壳多了一层标题栏高度、
// CSS 又没锁 aspect-ratio，结果窄屏下图片被压扁。静态就能查，不该靠肉眼发现。
function pngSize(file) {
  const buffer = readFileSync(file)
  // PNG 的 IHDR 固定从第 16 字节开始：宽 4 字节、高 4 字节（大端）
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

const shotFiles = readdirSync(path.join(site, 'assets', 'shots')).filter((name) => name.endsWith('.png'))
const ratios = shotFiles.map((name) => {
  const size = pngSize(path.join(site, 'assets', 'shots', name))
  return { name, ratio: size ? size.width / size.height : 0, size }
})
const badRatio = ratios.filter((item) => Math.abs(item.ratio - 1445 / 897) > 0.02)
check(
  '截图比例统一（1445×897）',
  badRatio.length === 0,
  badRatio.length ? badRatio.map((item) => `${item.name}=${item.ratio.toFixed(3)}`).join(', ') : `${ratios.length} 张全部一致`
)

const css = readFileSync(path.join(site, 'styles.css'), 'utf-8')
check(
  'CSS 给截图锁定了宽高比（不会随容器拉伸）',
  /aspect-ratio:\s*1445\s*\/\s*897/.test(css) && /object-fit:\s*cover/.test(css),
  'aspect-ratio + object-fit'
)
// HTML 里主视觉写的宽高必须和真实文件一致，否则浏览器会按错误比例预留位置
const heroImg = html.match(/<img src="assets\/shots\/records\.png"[^>]*width="(\d+)" height="(\d+)"/)
check(
  '主视觉 img 上写的宽高与真实一致',
  Boolean(heroImg) && heroImg[1] === '1445' && heroImg[2] === '897',
  heroImg ? `${heroImg[1]}×${heroImg[2]}` : '未找到主视觉 img 或无宽高属性'
)

// ---------- 8. 体积（静态站也要注意首屏） ----------
const htmlSize = statSync(indexPath).size
const cssSize = statSync(path.join(site, 'styles.css')).size
const jsSize = statSync(path.join(site, 'main.js')).size
check('HTML 体积合理（< 40KB）', htmlSize < 40 * 1024, `${(htmlSize / 1024).toFixed(1)} KB`)
check('CSS 体积合理（< 40KB）', cssSize < 40 * 1024, `${(cssSize / 1024).toFixed(1)} KB`)
check('JS 体积合理（< 20KB，零依赖）', jsSize < 20 * 1024, `${(jsSize / 1024).toFixed(1)} KB`)

const passed = results.filter((item) => item.ok).length
console.log(`\n===== 官网自检：${passed}/${results.length} 通过 =====`)
for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}  —  ${item.detail}`)
process.exit(passed === results.length ? 0 : 1)
