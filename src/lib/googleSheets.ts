import { google } from 'googleapis';

// Lazy-initialize the Sheets client so env vars are always read at request time
// (not at module load time, which can be before .env.local is processed)
function getSheetsClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || '';

  if (!clientEmail || !privateKey || !spreadsheetId) {
    return { sheets: null, spreadsheetId: '' };
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    spreadsheetId,
  };
}

export function getSheets() {
  return getSheetsClient();
}

// Sheet tab names — override in .env.local if your tabs have different names
// e.g. GOOGLE_SHEET_ITEMS=Sheet1  or  GOOGLE_SHEET_ITEMS=สินค้า
export function getSheetNames() {
  return {
    SHEET_ITEMS: process.env.GOOGLE_SHEET_ITEMS || 'Items',
    SHEET_REQUISITIONS: process.env.GOOGLE_SHEET_REQUISITIONS || 'Requisitions',
    SHEET_REQUISITION_ITEMS: process.env.GOOGLE_SHEET_REQUISITION_ITEMS || 'RequisitionItems',
  };
}

// Keep legacy named exports for backward compatibility with old imports
export const sheets = (() => {
  try { return getSheetsClient().sheets; } catch { return null; }
})();
export const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || '';
export const SHEET_ITEMS = process.env.GOOGLE_SHEET_ITEMS || 'Items';
export const SHEET_REQUISITIONS = process.env.GOOGLE_SHEET_REQUISITIONS || 'Requisitions';
export const SHEET_REQUISITION_ITEMS = process.env.GOOGLE_SHEET_REQUISITION_ITEMS || 'RequisitionItems';
