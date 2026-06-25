/**
 * Minimal RFC-4180 CSV parser (handles quoted fields, embedded commas/newlines,
 * escaped quotes, CRLF, and a BOM). Used for GTFS static and the official NJT
 * performance CSVs. No dependency needed.
 */
export function parseCsvRows(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // Flush trailing field/row if the file didn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse CSV into objects keyed by the header row, skipping blank lines. */
export function parseCsv(input: string): Record<string, string>[] {
  const rows = parseCsvRows(input);
  const header = rows[0];
  if (!header) return [];
  return rows
    .slice(1)
    .filter((cells) => !(cells.length === 1 && cells[0] === ""))
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((key, i) => {
        record[key.trim()] = (cells[i] ?? "").trim();
      });
      return record;
    });
}
