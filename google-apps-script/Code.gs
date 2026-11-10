/**
 * AURORA '26 Party Manager — Google Sheets connector
 * 1. Create a Google Sheet.
 * 2. Extensions > Apps Script.
 * 3. Paste this file into Code.gs and set SPREADSHEET_ID below.
 * 4. Deploy as a Web App (Execute as: Me; access: Anyone).
 */
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
const SHEET_NAME = 'Attendees';
const HEADERS = [
  'Record ID', 'Receipt No.', 'Attendee Name', 'Birth Year', 'Drinks',
  'Total Amount (LKR)', 'Advance Amount (LKR)', 'Outstanding Amount (LKR)',
  'Created At', 'Updated At'
];

function getSheet_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === 'YOUR_SPREADSHEET_ID') {
    throw new Error('Set SPREADSHEET_ID in Code.gs before deploying.');
  }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#38130d')
      .setFontColor('#f5cf70');
    sheet.autoResizeColumns(1, HEADERS.length);
  }
  return sheet;
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const sheet = getSheet_();
    const action = payload.action;

    if (action === 'ping') {
      return json_({ ok: true, message: 'AURORA 26 connector is active.' });
    }

    const person = payload.person || {};
    if (!person.id && action !== 'ping') {
      throw new Error('Missing record ID.');
    }

    const idColumn = 1;
    const lastRow = sheet.getLastRow();
    let targetRow = -1;
    if (lastRow >= 2) {
      const ids = sheet.getRange(2, idColumn, lastRow - 1, 1).getValues().flat();
      const index = ids.findIndex((id) => String(id) === String(person.id));
      if (index >= 0) targetRow = index + 2;
    }

    if (action === 'delete') {
      if (targetRow >= 2) sheet.deleteRow(targetRow);
      return json_({ ok: true, action: 'delete', id: person.id });
    }

    if (action !== 'upsert') throw new Error('Unsupported action: ' + action);

    const row = [
      person.id || '',
      person.receiptNo || '',
      person.name || '',
      Number(person.birthYear) || '',
      person.drinks || '',
      Number(person.totalAmount) || 0,
      Number(person.advanceAmount) || 0,
      Number(person.outstandingAmount) || 0,
      person.createdAt || new Date().toISOString(),
      person.updatedAt || new Date().toISOString()
    ];
    if (targetRow >= 2) {
      sheet.getRange(targetRow, 1, 1, HEADERS.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return json_({ ok: true, action: 'upsert', id: person.id });
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: String(error.message || error) });
  }
}

function doGet() {
  try {
    const sheet = getSheet_();
    const values = sheet.getDataRange().getValues();
    return json_({ ok: true, sheet: SHEET_NAME, rows: Math.max(0, values.length - 1) });
  } catch (error) {
    return json_({ ok: false, error: String(error.message || error) });
  }
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
