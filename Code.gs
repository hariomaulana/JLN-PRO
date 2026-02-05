/**
 * JLN PRO - Single Source
 * Files: Index.html, Partials_Head.html, Partials_Navbar.html, Modals.html, AppCore.html
 */

const CONFIG = {
  ROOT_UPLOAD_FOLDER: "JLN_Attachments",
  SHEETS: {
    CUSTOMERS: "Customers",
    PACKAGES: "Packages",
    USERS: "Users",
    LOCATIONS: "Locations",
    REPORTS: "Reports",
    ANNOUNCEMENTS: "Announcements",
  },
  // Sheets yang hanya boleh ADMIN CRUD
  ADMIN_ONLY_SHEETS: ["Packages", "Locations", "Users", "Announcements"]
};

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? String(e.parameter.page) : "customers";
  const t = HtmlService.createTemplateFromFile("Index");
  t.page = page;

  return t.evaluate()
    .setTitle("JLN PRO")
    .setSandboxMode(HtmlService.SandboxMode.NATIVE)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* =========================
   AUTH
========================= */
function loginUser(username, password) {
  const sh = _sheet_(CONFIG.SHEETS.USERS);
  const values = sh.getDataRange().getValues();
  const header = values.shift().map(h => String(h).trim());
  const idx = (name) => header.indexOf(name);

  const iUser = idx("USERNAME");
  const iPass = idx("PASSWORD");
  const iRole = idx("ROLE");
  const iName = idx("FULL_NAME");

  const u = String(username || "").trim();
  const p = String(password || "").trim();
  if (!u || !p) return { ok: false, message: "Username/password kosong." };

  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    if (String(row[iUser]).trim() === u && String(row[iPass]).trim() === p) {
      return {
        ok: true,
        user: { username: u, role: String(row[iRole] || "SALES").toUpperCase(), fullName: String(row[iName] || "") }
      };
    }
  }
  return { ok: false, message: "Username / password salah." };
}

function loginWithGoogle() {
  const email = Session.getActiveUser().getEmail();
  if (!email) return { ok: false, message: "Tidak bisa mengambil email Google." };

  const sh = _sheet_(CONFIG.SHEETS.USERS);
  const values = sh.getDataRange().getValues();
  const header = values.shift().map(h => String(h).trim());
  const idx = (name) => header.indexOf(name);

  const iEmail = idx("EMAIL_GOOGLE");
  const iUser = idx("USERNAME");
  const iRole = idx("ROLE");
  const iName = idx("FULL_NAME");

  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    if (String(row[iEmail] || "").trim().toLowerCase() === String(email).trim().toLowerCase()) {
      return {
        ok: true,
        user: { username: String(row[iUser] || email), role: String(row[iRole] || "SALES").toUpperCase(), fullName: String(row[iName] || "") }
      };
    }
  }
  return { ok: false, message: "Email Google belum didaftarkan di Users." };
}

/* =========================
   DATA CORE
========================= */
function _sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`Sheet '${name}' tidak ditemukan.`);
  return sh;
}

function _getAll_(sheetName) {
  const sh = _sheet_(sheetName);
  const values = sh.getDataRange().getValues();
  const header = values.shift().map(h => String(h).trim());

  const out = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const obj = {};
    header.forEach((h, idx) => (obj[h] = row[idx]));
    obj.ROW_INDEX = i + 2;
    out.push(obj);
  }
  return out;
}

function getGlobalData(role, username) {
  const r = String(role || "").toUpperCase();
  const isAdmin = r === "ADMIN";

  const customers = _getAll_(CONFIG.SHEETS.CUSTOMERS);
  const packages = _getAll_(CONFIG.SHEETS.PACKAGES);
  const locations = _getAll_(CONFIG.SHEETS.LOCATIONS);
  const announcements = _getAll_(CONFIG.SHEETS.ANNOUNCEMENTS);

  let users = [];
  if (isAdmin) users = _getAll_(CONFIG.SHEETS.USERS);

  let reports = _getAll_(CONFIG.SHEETS.REPORTS);
  if (!isAdmin) reports = reports.filter(x => String(x.SALES_USERNAME || "").trim() === String(username || "").trim());

  return { customers, packages, locations, users, reports, announcements };
}

function saveData(sheetName, dataObj, rowIndex) {
  const sh = _sheet_(sheetName);
  const values = sh.getDataRange().getValues();
  const header = values[0].map(h => String(h).trim());
  const row = header.map(h => (dataObj[h] !== undefined ? dataObj[h] : ""));

  if (rowIndex) sh.getRange(Number(rowIndex), 1, 1, header.length).setValues([row]);
  else sh.appendRow(row);

  return true;
}

function deleteRow(sheetName, rowIndex) {
  _sheet_(sheetName).deleteRow(Number(rowIndex));
  return true;
}

/* =========================
   SECURE WRAPPERS (role checks)
========================= */
function _assertAdmin_(role) {
  if (String(role || "").toUpperCase() !== "ADMIN") throw new Error("Akses ditolak: hanya ADMIN.");
}

function saveDataSecure(sheetName, dataObj, rowIndex, role, username) {
  const isAdmin = String(role || "").toUpperCase() === "ADMIN";

  // Admin-only sheets
  if (CONFIG.ADMIN_ONLY_SHEETS.includes(String(sheetName))) _assertAdmin_(role);

  // Customers: Sales boleh add/edit, tapi delete via deleteRowSecure
  if (String(sheetName) === CONFIG.SHEETS.CUSTOMERS) {
    // kalau sales mengedit customer: boleh (biar fleksibel)
    // kalau mau dibatasi lebih ketat nanti kita kunci berdasarkan SALES_REKRUTER
  }

  return saveData(sheetName, dataObj, rowIndex);
}

function deleteRowSecure(sheetName, rowIndex, role) {
  // Hapus master data & users: admin only
  if (CONFIG.ADMIN_ONLY_SHEETS.includes(String(sheetName))) _assertAdmin_(role);

  // Hapus customer: admin only
  if (String(sheetName) === CONFIG.SHEETS.CUSTOMERS) _assertAdmin_(role);

  return deleteRow(sheetName, rowIndex);
}

/* =========================
   REPORTS (sales terkunci setelah verified)
========================= */
function saveReport(formData, rowIndex, role, username) {
  const r = String(role || "").toUpperCase();
  const isAdmin = r === "ADMIN";

  if (rowIndex && !isAdmin) {
    const sh = _sheet_(CONFIG.SHEETS.REPORTS);
    const values = sh.getDataRange().getValues();
    const header = values[0].map(h => String(h).trim());
    const idx = (name) => header.indexOf(name);

    const iVerifiedAt = idx("VERIFIED_AT");
    const iSales = idx("SALES_USERNAME");

    const row = values[Number(rowIndex) - 1];
    if (row && row[iVerifiedAt]) throw new Error("Laporan sudah diverifikasi Admin, tidak bisa diedit.");
    if (row && String(row[iSales] || "") !== String(username || "")) throw new Error("Tidak boleh mengedit laporan sales lain.");
  }

  return saveData(CONFIG.SHEETS.REPORTS, formData, rowIndex);
}

function deleteReport(rowIndex, role) {
  _assertAdmin_(role);
  return deleteRow(CONFIG.SHEETS.REPORTS, rowIndex);
}

function verifyReport(rowIndex, adminUsername, role) {
  _assertAdmin_(role);

  const sh = _sheet_(CONFIG.SHEETS.REPORTS);
  const values = sh.getDataRange().getValues();
  const header = values[0].map(h => String(h).trim());
  const idx = (name) => header.indexOf(name);

  const iVerifiedBy = idx("VERIFIED_BY");
  const iVerifiedAt = idx("VERIFIED_AT");
  if (iVerifiedBy < 0 || iVerifiedAt < 0) throw new Error("Kolom VERIFIED_BY / VERIFIED_AT tidak ada.");

  const now = new Date().toISOString();
  sh.getRange(Number(rowIndex), iVerifiedBy + 1).setValue(String(adminUsername || ""));
  sh.getRange(Number(rowIndex), iVerifiedAt + 1).setValue(now);
  return true;
}

/* =========================
   UPLOAD DRIVE
========================= */
function uploadFileToDrive(base64Data, filename, customerId, docType) {
  const folder = _getOrCreateFolder_(CONFIG.ROOT_UPLOAD_FOLDER);
  const sub = _getOrCreateFolder_(String(customerId), folder);

  const contentType = _detectMimeFromBase64_(base64Data) || "image/jpeg";
  const bytes = Utilities.base64Decode(String(base64Data).split(",")[1]);
  const blob = Utilities.newBlob(bytes, contentType, `${docType}_${filename}`);

  const file = sub.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function _getOrCreateFolder_(name, parent) {
  const it = (parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name));
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function _detectMimeFromBase64_(b64) {
  const head = String(b64 || "").slice(0, 60);
  if (head.includes("data:image/png")) return "image/png";
  if (head.includes("data:image/jpeg")) return "image/jpeg";
  if (head.includes("data:image/jpg")) return "image/jpeg";
  if (head.includes("data:image/webp")) return "image/webp";
  return "";
}
