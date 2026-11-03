import { WORKER_URL } from '../config.js';

// Minimal RFC4180 CSV parser
export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function workbookToSheets(buf) {
  if (!window.XLSX) throw new Error('Spreadsheet reader failed to load. Check your connection and refresh.');
  const wb = window.XLSX.read(buf, { type: 'array' });
  return wb.SheetNames.map((name) => ({
    name,
    grid: window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }),
  }));
}

export async function readFile(file) {
  if (/\.csv$/i.test(file.name)) return [{ name: file.name, grid: parseCSV(await file.text()) }];
  return workbookToSheets(new Uint8Array(await file.arrayBuffer()));
}

export function parseSheetUrl(url) {
  const id = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/)?.[1] || (/^[a-zA-Z0-9_-]{30,}$/.test(url.trim()) ? url.trim() : null);
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] || null;
  return id ? { id, gid } : null;
}

export async function readGoogleSheet(url) {
  const ref = parseSheetUrl(url);
  if (!ref) throw new Error("That doesn't look like a Google Sheets link.");
  if (WORKER_URL) {
    const res = await fetch(`${WORKER_URL}/sheet?id=${encodeURIComponent(ref.id)}`);
    if (res.ok) return workbookToSheets(new Uint8Array(await res.arrayBuffer()));
    const msg = await res.text().catch(() => '');
    throw new Error(msg || `Couldn't read the sheet (${res.status}).`);
  }
  // No server configured: try Google's CSV endpoint (only reads one tab)
  const csvUrl = `https://docs.google.com/spreadsheets/d/${ref.id}/gviz/tq?tqx=out:csv&headers=0${ref.gid ? `&gid=${ref.gid}` : ''}`;
  let res;
  try { res = await fetch(csvUrl); } catch { res = null; }
  if (!res || !res.ok) throw new Error('Couldn\'t open the sheet. Make sure sharing is set to "Anyone with the link → Viewer", or download it as .xlsx and upload it instead.');
  const text = await res.text();
  if (/^\s*</.test(text)) throw new Error('Google returned a sign-in page. Set sharing to "Anyone with the link → Viewer".');
  return [{ name: 'Google Sheet', grid: parseCSV(text) }];
}

export async function readSample(path = 'sample/sample-plan.csv') {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Couldn't load ${path}`);
  return [{ name: 'Sample plan', grid: parseCSV(await res.text()) }];
}
