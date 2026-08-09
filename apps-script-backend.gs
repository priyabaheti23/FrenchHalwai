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
 *   Tab "Bookings" — orders. Header row (in order):
 *     Timestamp | Sender Name | Sender Phone | Method | Items Ordered | Qty |
 *     Delivery Zone | Delivery Fee | Coupon Code | Discount Amount | Address |
 *     Maps Link | How Did You Hear | Notes | Referral Source | Total
 *     The "Qty" column is generic — it's where units-per-order are counted
 *     from, no matter what item is currently being sold. Nothing needs
 *     renaming here when you switch to a new drop.
 *   Tab "Sheet1"  — old order log, kept as an archive. Not written to anymore.
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
 * TO CHANGE THE CURRENT ITEM LATER: just update script.js's CURRENT_ITEM.
 * Nothing here needs to change — the Qty column and this backend are generic.
 * ────────────────────────────────────────────────────────────────────────── */

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Bookings');
  var data = JSON.parse(e.postData.contents);

  var row;

  if (data.form_type === 'waitlist') {
    // Columns: Timestamp | Sender Name | Sender Phone | Method | Items Ordered |
    // Qty | Delivery Zone | Delivery Fee | Coupon Code | Discount Amount |
    // Address | Maps Link | How Did You Hear | Notes | Referral Source | Total
    row = [
      new Date(),                                              // Timestamp
      data.name || '',                                          // Sender Name
      data.phone || '',                                         // Sender Phone
      '',                                                        // Method
      'WAITLIST SIGNUP',                                        // Items Ordered
      '',                                                        // Qty
      '', '',                                                   // Delivery Zone / Delivery Fee
      '', '',                                                   // Coupon Code / Discount Amount
      '',                                                        // Address
      '',                                                        // Maps Link
      '',                                                        // How Did You Hear
      'Waiting for ' + (data.next_drop_date || 'next drop'),    // Notes
      '',                                                        // Referral Source
      ''                                                         // Total
    ];
  } else {
    row = [
      new Date(),
      data.sender_name || '',
      data.sender_phone || '',
      data.method || '',
      data.items_ordered || '',
      data.qty || '',
      data.delivery_zone || '',
      data.delivery_fee || '',
      data.coupon_code || '',
      data.discount_amount || '',
      data.address || '',
      data.maps_link || '',
      data.heard_from || '',
      data.notes || '',
      data.referral_source || '',
      data.total || ''
    ];
  }

  sheet.appendRow(row);

  return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Config for the site's checkout page (GET requests) ─────────────────────
var SHEET_ID = '1B3suLNr2NZDOPfpsLndI-Y4DMVrlwqFfCz_6gRy3XHc';  // "FH Orders" sheet
var ORDERS_SHEET_NAME = 'Bookings';
var QTY_COLUMN_HEADER = 'Qty';         // generic now — no renaming needed between drops
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
