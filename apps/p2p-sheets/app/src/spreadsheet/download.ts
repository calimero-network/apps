/**
 * Pure CSV serialization for the workbook download. One `# <sheet name>` header
 * per sheet followed by its cells as a quoted, comma-separated grid padded to
 * the used bounding box; a trailing blank line separates sheets. Cell values are
 * display-formatted (formatValue) and inner double-quotes are doubled per CSV.
 */
import { formatValue } from './format';

export interface CsvCell {
  row: number;
  col: number;
  computed_value: string;
  format: string;
}

export interface CsvSheet {
  name: string;
  cells: CsvCell[];
}

export function sheetsToCsv(sheets: CsvSheet[]): string {
  const lines: string[] = [];
  for (const sheet of sheets) {
    lines.push(`# ${sheet.name}`);
    if (sheet.cells.length > 0) {
      const maxRow = sheet.cells.reduce((m, c) => Math.max(m, c.row), 0);
      const maxCol = sheet.cells.reduce((m, c) => Math.max(m, c.col), 0);
      for (let r = 0; r <= maxRow; r++) {
        const rowData: string[] = [];
        for (let c = 0; c <= maxCol; c++) {
          const cell = sheet.cells.find((x) => x.row === r && x.col === c);
          const val = cell
            ? formatValue(cell.computed_value, cell.format).replace(/"/g, '""')
            : '';
          rowData.push(`"${val}"`);
        }
        lines.push(rowData.join(','));
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
