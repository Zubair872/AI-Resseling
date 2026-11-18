// Purpose: safe CSV writer (quotes, newlines, and spreadsheet formula injection).
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
}

// Excel-compatible export (SpreadsheetML 2003 XML, opens in Excel/LibreOffice). Every cell is written as a String, so nothing can run as a formula.
const xmlEscape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
export function toExcelXml(sheetName: string, headers: string[], rows: unknown[][]) {
  const cell = (v: unknown) => `<Cell><Data ss:Type="String">${xmlEscape(v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v))}</Data></Cell>`
  const row = (r: unknown[]) => `<Row>${r.map(cell).join('')}</Row>`
  const name = xmlEscape(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${name}"><Table>${[headers, ...rows].map(row).join('')}</Table></Worksheet></Workbook>\n`
}
