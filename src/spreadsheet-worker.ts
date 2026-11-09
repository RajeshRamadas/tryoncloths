import { read, utils } from "xlsx";
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const book = read(event.data, {
      type: "array",
      sheetRows: 10002,
      dense: true,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
    });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new Error("The workbook has no worksheets.");
    const range = utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
    if (range.e.r > 10000 || range.e.c > 31)
      throw new Error("Use at most 10,000 data rows and 32 columns in the first worksheet.");
    const rows = utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: false });
    const csv = utils.sheet_to_csv(utils.aoa_to_sheet(rows as unknown[][]));
    self.postMessage({ csv });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : "Spreadsheet could not be read." });
  }
};
