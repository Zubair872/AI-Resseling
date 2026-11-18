export type ProductImportRow = {
  name: string
  description?: string
  category: string
  wholesalePrice: number
  sellingPrice: number
  stock: number
  supplierUrl?: string
}

export function splitCsvLine(line: string) {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"' && line[index + 1] === '"') {
      cell += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += character
    }
  }
  cells.push(cell.trim())
  return cells
}

export function parseProductCsv(csv: string): ProductImportRow[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) throw new Error('CSV must contain a header and at least one product row')
  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/[\s_-]+/g, ''))
  const required = ['name', 'category', 'wholesaleprice', 'sellingprice', 'stock']
  for (const header of required) if (!headers.includes(header)) throw new Error(`CSV is missing required column: ${header}`)
  return lines.slice(1).map((line, rowIndex) => {
    const values = splitCsvLine(line)
    const value = (name: string) => values[headers.indexOf(name)]?.trim() ?? ''
    const wholesalePrice = Number(value('wholesaleprice'))
    const sellingPrice = Number(value('sellingprice'))
    const stock = Number(value('stock'))
    if (!value('name') || !value('category') || !Number.isFinite(wholesalePrice) || wholesalePrice < 0 || !Number.isFinite(sellingPrice) || sellingPrice < 0 || !Number.isInteger(stock) || stock < 0) {
      throw new Error(`Invalid product data at CSV row ${rowIndex + 2}`)
    }
    const row: ProductImportRow = {
      name: value('name'),
      category: value('category'),
      wholesalePrice,
      sellingPrice,
      stock,
    }
    const description = value('description')
    const supplierUrl = value('supplierurl')
    if (description) row.description = description
    if (supplierUrl) row.supplierUrl = supplierUrl
    return row
  })
}
