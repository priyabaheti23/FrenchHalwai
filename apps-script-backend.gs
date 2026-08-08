/**
 * ── APPS SCRIPT BACKEND for the "FH Orders" sheet ──────────────────────────
 * This is NOT part of the website itself — it's the code behind the Web App
 * URL that script.js talks to (order submissions + stock + coupon checks).
 *
 * This file mirrors what is pasted into the live Apps Script project
 * (script.google.com, opened via Sheet > Extensions > Apps Script). Keep
 * this file and the live one in sync when you make changes.
 *
 * SHEET LAYOUT THIS EXPECTS:
 *   Tab "Sheet1"  — orders. Header row must include an "Opera Qty" column
 *                   (this is where units-per-order are counted from).
 *   Tab "Config"  — A1: "MaxStock", B1: <number of units for this drop>.
 *   Tab "Coupons" — header row: Code | Type | Value | Active | Phone | ValidTill
 *       - Type: "percent" (Value = % off), "flat" (Value = ₹ off), or
 *         "free_delivery" (Value ignored).
 *       - Phone: leave blank for a code anyone can use. Fill in a phone
 *         number (any format, digits are matched) to lock the code to that
 *         one customer — they must enter the same number in the order form.
 *       - ValidTill: leave blank for no expiry, or set a date — the code
 *         stops working the day after.
 *       - Active: TRUE/FALSE — flip to FALSE to disable a code without
 *         deleting it.
 *
 * TO CHANGE THE CURRENT ITEM LATER: update QTY_COLUMN_HEADER below to match
 * a column header in Sheet1 (add a new column there if it's a brand new
 * item), then redeploy (see bottom of this file).
 * ────────────────────────────────────────────────────────────────────────── */

function doPost(e) {
  // Change 'Sheet1' below if your tab is named something else.
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  const data = JSON.parse(e.postData.contents);

  let row;

  if (data.form_type === 'waitlist') {
    // Columns: Timestamp | Sender Name | Sender Phone | Is Gift? | Receiver Name |
    // Receiver Phone | Surprise? | Gift Message | How Did You Hear | Method | Slot |
    // Items Ordered | Tiramisu Qty | Opera Qty | Address | Notes | Referral Source | Total | Maps Link
    row = [
      new Date(),                                              // Timestamp
      data.name || '',                                          // Sender Name
      data.phone || '',                                         // Sender Phone
      '', '', '', '', '',                                       // Is Gift? / Receiver Name / Receiver Phone / Surprise? / Gift Message
      '',                                                        // How Did You Hear
      '', '',                                                   // Method / Slot
      'WAITLIST SIGNUP',                                        // Items Ordered
      '', '',                                                   // Tiramisu Qty / Opera Qty
      '',                                                        // Address
      'Waiting for ' + (data.next_drop_date || 'next drop'),    // Notes
      '',                                                        // Referral Source
      '',                                                        // Total
      ''                                                         // Maps Link
    ];
  } else {
    // Existing order flow — same field mapping you already had.
    row = [
      new Date(),
      data.sender_name || '',
      data.sender_phone || '',
      data.is_gift || '',
      data.receiver_name || '',
      data.receiver_phone || '',
      data.surprise || '',
      data.gift_message || '',
      data.heard_from || '',
      data.method || '',
      data.slot || '',
      data.items_ordered || '',
      data.tiramisu_qty || '',
      data.opera_qty || '',      // <-- was data.matcha_qty; now tracks the current item
      data.address || '',
      data.notes || '',
      data.referral_source || '',
      data.total || '',
      data.maps_link || ''       // new "Maps Link" column, added at the end
    ];
  }

  sheet.appendRow(row);

  return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Config for the site's checkout page (GET requests) ─────────────────────
var SHEET_ID = '1B3suLNr2NZDOPfpsLndI-Y4DMVrlwqFfCz_6gRy3XHc';  // "FH Orders" sheet
var ORDERS_SHEET_NAME = 'Sheet1';
var QTY_COLUMN_HEADER = 'Opera Qty';   // change this when the current item changes again
var CONFIG_SHEET_NAME = 'Config';
var COUPONS_SHEET_NAME = 'Coupons';
var MAX_TUBS_FALLBACK = 2;             // used only if the Config tab is missing/blank

function doGet(e) {
  var action = (e.parameter && e.parameter.action) || 'stock';

  if (action === 'checkCoupon') {
    return checkCoupon_(e.parameter.code, e.parameter.phone);
  }

  return getStock_();
}

// Returns { maxStock, remaining }. Deliberately does NOT return the coupon
// list — that would let anyone loading the site see every active code
// (including the "hard to guess" friends & family one) in the network tab.
function getStock_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  var maxStock = MAX_TUBS_FALLBACK;
  var configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (configSheet) {
    var cfgData = configSheet.getDataRange().getValues();
    for (var i = 0; i < cfgData.length; i++) {
      if (String(cfgData[i][0]).trim().toLowerCase() === 'maxstock') {
        var v = Number(cfgData[i][1]);
        if (Number.isFinite(v) && v > 0) maxStock = v;
      }
    }
  }

  var ordered = 0;
  var ordersSheet = ss.getSheetByName(ORDERS_SHEET_NAME);
  if (ordersSheet) {
    var data = ordersSheet.getDataRange().getValues();
    if (data.length > 1) {
      var headers = data[0];
      var qtyCol = headers.indexOf(QTY_COLUMN_HEADER);
      if (qtyCol !== -1) {
        for (var r = 1; r < data.length; r++) {
          ordered += Number(data[r][qtyCol]) || 0;
        }
      }
    }
  }
  var remaining = Math.max(0, maxStock - ordered);

  return ContentService
    .createTextOutput(JSON.stringify({ maxStock: maxStock, remaining: remaining }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Validates ONE coupon code (+ optional phone) at a time. Never exposes the
// full coupon list. Called by the site when the customer clicks "Apply".
function checkCoupon_(code, phone) {
  var result;
  code = String(code || '').trim().toUpperCase();
  var digitsOnly = String(phone || '').replace(/\D/g, '');

  if (!code) {
    result = { ok: false, message: 'Enter a code first.' };
  } else {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var couponsSheet = ss.getSheetByName(COUPONS_SHEET_NAME);
    var match = null;

    if (couponsSheet) {
      var cData = couponsSheet.getDataRange().getValues();
      var headers = cData[0].map(function (h) { return String(h).trim().toLowerCase(); });
      var codeIdx = headers.indexOf('code');
      var typeIdx = headers.indexOf('type');
      var valueIdx = headers.indexOf('value');
      var activeIdx = headers.indexOf('active');
      var phoneIdx = headers.indexOf('phone');
      var tillIdx = headers.indexOf('validtill');

      for (var i = 1; i < cData.length; i++) {
        var row = cData[i];
        if (codeIdx !== -1 && String(row[codeIdx]).trim().toUpperCase() === code) {
          match = {
            type: typeIdx === -1 ? 'percent' : String(row[typeIdx]).trim().toLowerCase(),
            value: valueIdx === -1 ? 0 : (Number(row[valueIdx]) || 0),
            active: activeIdx === -1 ? true : /^(true|yes|y|1)$/i.test(String(row[activeIdx]).trim()),
            phone: phoneIdx === -1 ? '' : String(row[phoneIdx]).replace(/\D/g, ''),
            validTill: tillIdx === -1 ? '' : row[tillIdx]
          };
          break;
        }
      }
    }

    if (!match || !match.active) {
      result = { ok: false, message: 'Invalid or expired code.' };
    } else if (match.validTill && new Date(match.validTill) < new Date()) {
      result = { ok: false, message: 'This code has expired.' };
    } else if (match.phone && match.phone !== digitsOnly) {
      result = { ok: false, message: 'Please use the phone number this coupon was issued to.' };
    } else {
      result = { ok: true, type: match.type, value: match.value };
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * TO DEPLOY A CHANGE TO THIS FILE:
 * 1. Paste the updated code into script.google.com (same project as before).
 * 2. Deploy > Manage deployments > pencil/edit icon on the active deployment
 *    > Version: "New version" > Deploy. The URL stays the same.
 */
