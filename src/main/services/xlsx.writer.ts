import { deflateRawSync } from 'node:zlib'

/**
 * 最小 xlsx 写出器。
 *
 * 为什么放在 main 而不是 shared：shared 会被渲染进程一起编译，那边没有 Buffer 与 node:zlib。
 *
 * 为什么自己写而不用 SheetJS / exceljs：
 *   - 那几个库都是几百 KB 到几 MB 的依赖，而我们只需要「一张表 + 表头加粗」；
 *   - xlsx 本质就是一个装着几个 XML 的 zip，写出来比读完整个规范简单；
 *   - 少一个依赖就少一份打包与升级负担（尤其是要上架的时候）。
 *
 * 只做**导出**。xlsx 的**导入**需要解析共享字符串表、内联字符串、日期序列号，
 * 工作量与风险都大一个量级，而所有记账软件都能导出 CSV，所以导入走 CSV。
 *
 * 细节取舍：
 *   - 日期写成文本 YYYY-MM-DD：真正的日期要用 Excel 的序列号 + 1900 闰年 bug 兼容，
 *     写错会让全表日期偏一天，风险远大于收益；
 *   - 金额写成数值（不是文本），这样用户在 Excel 里能直接求和；
 *   - 用 deflate 压缩（Node 自带 zlib），比 store 更小且 Excel 完全支持。
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

interface ZipEntry {
  name: string
  data: Buffer
}

/**
 * 打一个 zip 包（只实现我们需要的：deflate 压缩、无 zip64、无加密）。
 * 大小上限 4GB 以内，账本导出远远到不了。
 */
function zip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf-8')
    const compressed = deflateRawSync(entry.data)
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // 本地文件头签名
    local.writeUInt16LE(20, 4) // 需要的解压版本
    local.writeUInt16LE(0x0800, 6) // 标志位：文件名为 UTF-8
    local.writeUInt16LE(8, 8) // 压缩方式：deflate
    local.writeUInt16LE(0, 10) // 修改时间
    local.writeUInt16LE(0x2100, 12) // 修改日期（1980-01-01，内容与时间无关紧要）
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28) // 扩展字段长度

    chunks.push(local, nameBytes, compressed)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0) // 中央目录签名
    header.writeUInt16LE(20, 4) // 创建版本
    header.writeUInt16LE(20, 6) // 需要的解压版本
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(8, 10)
    header.writeUInt16LE(0, 12)
    header.writeUInt16LE(0x2100, 14)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(compressed.length, 20)
    header.writeUInt32LE(entry.data.length, 24)
    header.writeUInt16LE(nameBytes.length, 28)
    header.writeUInt16LE(0, 30) // 扩展字段
    header.writeUInt16LE(0, 32) // 注释
    header.writeUInt16LE(0, 34) // 磁盘号
    header.writeUInt16LE(0, 36) // 内部属性
    header.writeUInt32LE(0, 38) // 外部属性
    header.writeUInt32LE(offset, 42) // 本地头偏移
    central.push(header, nameBytes)

    offset += local.length + nameBytes.length + compressed.length
  }

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // 中央目录结束记录
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, centralBuffer, end])
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // XML 1.0 不允许的控制字符，直接剔掉，否则整份文件会被 Excel 判为损坏
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

/** 列号 → Excel 字母（0 → A，26 → AA） */
function columnName(index: number): string {
  let value = index + 1
  let name = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

export type CellValue = string | number

/** 生成 sheet1.xml：表头用样式 1（加粗），正文数字写成数值、其它写内联字符串 */
function sheetXml(rows: CellValue[][]): string {
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
  lines.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
  lines.push('<sheetData>')

  rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 1
    lines.push(`<row r="${rowNumber}">`)
    row.forEach((cell, cellIndex) => {
      const ref = `${columnName(cellIndex)}${rowNumber}`
      const style = rowIndex === 0 ? ' s="1"' : ''
      if (typeof cell === 'number' && Number.isFinite(cell)) {
        lines.push(`<c r="${ref}"${style}><v>${cell}</v></c>`)
      } else {
        const text = xmlEscape(String(cell ?? ''))
        lines.push(`<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`)
      }
    })
    lines.push('</row>')
  })

  lines.push('</sheetData>')
  lines.push('</worksheet>')
  return lines.join('')
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="记录" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

/** 一行数据 → xlsx 里的单元格值（数字保持数字，方便 Excel 求和） */
export function buildXlsx(headers: string[], rows: CellValue[][]): Buffer {
  const xml = sheetXml([headers, ...rows])
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf-8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf-8') },
    { name: 'xl/workbook.xml', data: Buffer.from(WORKBOOK, 'utf-8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WORKBOOK_RELS, 'utf-8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES_XML, 'utf-8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(xml, 'utf-8') }
  ])
}

/** 自检用：把 zip 中央目录里登记的文件名读出来（验证容器结构是否合法） */
export function listZipEntries(buffer: Buffer): string[] {
  const names: string[] = []
  for (let i = 0; i + 4 <= buffer.length; i++) {
    if (buffer.readUInt32LE(i) !== 0x02014b50) continue
    const nameLength = buffer.readUInt16LE(i + 28)
    const extraLength = buffer.readUInt16LE(i + 30)
    const commentLength = buffer.readUInt16LE(i + 32)
    names.push(buffer.subarray(i + 46, i + 46 + nameLength).toString('utf-8'))
    i += 45 + nameLength + extraLength + commentLength
  }
  return names
}

/** 自检用：解开一个 entry（只支持 deflate / store） */
export function readZipEntry(buffer: Buffer, name: string): Buffer | null {
  const target = Buffer.from(name, 'utf-8')
  for (let i = 0; i + 30 <= buffer.length; i++) {
    if (buffer.readUInt32LE(i) !== 0x04034b50) continue
    const method = buffer.readUInt16LE(i + 8)
    const compressedSize = buffer.readUInt32LE(i + 18)
    const nameLength = buffer.readUInt16LE(i + 26)
    const extraLength = buffer.readUInt16LE(i + 28)
    const stored = buffer.subarray(i + 30, i + 30 + nameLength)
    if (!stored.equals(target)) continue
    const start = i + 30 + nameLength + extraLength
    const raw = buffer.subarray(start, start + compressedSize)
    if (method === 8) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('node:zlib').inflateRawSync(raw) as Buffer
    }
    return Buffer.from(raw)
  }
  return null
}
