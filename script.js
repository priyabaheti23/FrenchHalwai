(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };

    // ── First-paint loading overlay ─────────────────────────────────────────
    // Hidden the first time `known` (see updateUI) is true — i.e. as soon as
    // we've heard from the Sheet, given up trying, or are previewing.
    var loadingOverlayHidden = false;
    function hideLoadingOverlay() {
        if (loadingOverlayHidden) return;
        loadingOverlayHidden = true;
        var el = $('loadingOverlay');
        if (!el) return;
        el.classList.add('is-hidden');
        setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 600);
    }

    // ── Payment-confirmation state ──────────────────────────────────────────
    // Swaps the checkout form out for the same drawing-tower animation used
    // on first paint, from the moment Razorpay hands back a successful
    // payment until the backend has verified it and the order is recorded.
    function showConfirmingState() {
        var area = $('checkoutFormArea');
        var state = $('confirmingState');
        if (area) area.style.display = 'none';
        if (state) state.style.display = 'flex';
    }
    function hideConfirmingState() {
        var area = $('checkoutFormArea');
        var state = $('confirmingState');
        if (state) state.style.display = 'none';
        if (area) area.style.display = '';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // EDIT ME — this is the only section you should need to touch to change
    // the item being sold, its price/description, the past drops archive,
    // or the preorder cutoff.
    // ═══════════════════════════════════════════════════════════════════════

    // The item currently being sold. To launch a new drop, just change these
    // values — no other file needs editing (the Sheet's "Qty" column and the
    // Apps Script are generic now, not tied to any one item's name).
    var CURRENT_ITEM = {
        key: 'opera',
        name: 'Opera',
        price: 915,
        servesText: 'Limited Edition · Serves 1',
        description: 'Almond joconde, coffee buttercream, and dark chocolate ganache — seven delicate layers.',
        allergens: 'Dairy, Gluten, Eggs, Almonds',
        // Add your own photos to /assets with these exact filenames (or change the paths here).
        images: ['assets/opera_1.jpeg', 'assets/opera_2.jpeg']
    };

    // Past drops shown in the archive grid. Add, remove, or reorder freely —
    // the grid is built from this list, no HTML editing needed. `images` can
    // have 1 or 2 photos — with 2, arrows appear so people can flip between them.
    var PAST_DROPS = [
        { name: 'Tiramisu', images: ['assets/tiramisu_1.jpeg', 'assets/tiramisu_2.jpeg'], description: 'Espresso-soaked sponge layered with airy mascarpone and bittersweet cocoa.' },
        { name: 'Mango Fraisier', images: ['assets/mango_fraisier_3.jpeg', 'assets/mango_fraisier_2.jpeg'], description: 'Vanilla mousseline and fresh mango over delicate almond sponge.' },
        { name: 'Forêt Noire Tart', images: ['assets/Forêt_Noire_Tart.jpeg', 'assets/Forêt_Noire_Tart2.jpeg'], description: 'Dark chocolate tart with black forest cherries and kirsch cream.' },
        { name: 'Matcha Misu', images: ['assets/matcha_misu.jpeg'], description: 'Ceremonial-grade matcha meets classic tiramisu.' },
        { name: 'Madeleine', images: ['assets/madeline_box_of_4.jpeg', 'assets/madeline_box_of_6.jpeg'], description: 'Buttery French madeleines, golden-edged, baked to order.' }
    ];

    // Stock ALWAYS comes from the "MaxStock" cell in the Sheet's Config tab.
    // The number below is used only if that call fails outright. It is NOT a
    // second source of truth — and since the backend re-checks stock on every
    // order, a stale value here can no longer oversell the drop.
    var STOCK_FALLBACK_IF_OFFLINE = 2;

    // ── Drop schedule (IST) ────────────────────────────────────────────────
    // These three lines run the entire drop. To schedule the next one, change
    // them and nothing else.
    //   BOOKING_OPENS   — before this the page counts down and takes waitlist
    //                     signups; ordering is closed
    //   PREORDER_CUTOFF — after this ordering closes again
    //   DELIVERY_SLOT   — the pickup/delivery line shown on the page
    var BOOKING_OPENS   = new Date('2026-08-01T00:00:00+05:30');  // already passed — booking is OPEN
    var PREORDER_CUTOFF = new Date('2026-09-04T21:00:00+05:30');
    var DELIVERY_SLOT   = '5 September · 9am – 11am';

    // Where people are sent once this drop sells out.
    var NEXT_DROP_DATE  = new Date('2026-09-19T11:00:00+05:30');

    // ═══════════════════════════════════════════════════════════════════════
    // Below this line is site logic — safe to leave alone.
    // ═══════════════════════════════════════════════════════════════════════

    // QR tracking
    var params = new URLSearchParams(window.location.search);
    var refFromURL = params.get('ref');

    // ── Preview mode ───────────────────────────────────────────────────────
    // Add ?preview=preopen | live | soldout | closed to the URL to see that
    // phase of the drop immediately, without touching dates or stock.
    // Ordering is disabled while previewing, so this can't be used to sneak
    // an order in before the drop opens.
    var PREVIEW = (params.get('preview') || '').trim().toLowerCase();
    if (['preopen', 'live', 'soldout', 'closed', 'betweendrops'].indexOf(PREVIEW) === -1) PREVIEW = '';
    if (refFromURL) { try { localStorage.setItem('order_ref', refFromURL.toLowerCase()); } catch (e) {} }

    var maxStock = STOCK_FALLBACK_IF_OFFLINE;
    var stockRemaining = STOCK_FALLBACK_IF_OFFLINE;
    var cartQty = 0;              // there's only ever one item in the bag: CURRENT_ITEM
    var DELIVERY_FEES = { koramangala: 0, '7km': 100, '10km': 150 };
    var dropInactive = false;     // true when the Sheet's MaxStock is 0 — no drop is running
    var stockLoaded = false;      // false until the Sheet has answered once
    var preorderClosed = false;   // flips true once PREORDER_CUTOFF passes
    var bookingOpen = false;      // flips true once BOOKING_OPENS passes

    var isGift = false;           // true once "Sending to someone else?" is toggled on

    // Coupons — validated one at a time on the server, never listed publicly.
    var SHEET_CONFIG = {};        // whatever the Config tab supplied, kept for copy lookups
    var stockUnknown = false;     // true when we couldn't reach the Sheet at all
    var appliedCoupon = null;     // { code, type, value } once a valid code is applied
    var lastDiscount = 0;         // last computed discount amount, sent along with the order

    var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby-FcX9uvZeOD8TYsVTSlGRZJ3hRISMscWk3p2k_WtAuWH2a7zdAGNhQc6f_Td6j5_T/exec';

    function digits(s) { return (s || '').replace(/\D/g, ''); }

    // ── Payment ─────────────────────────────────────────────────────────────
    // The browser never decides what anything costs. We ask the backend to
    // create a Razorpay order — it recalculates the amount from the Sheet and
    // the Coupons tab — open checkout with what it hands back, then send the
    // signed result to be verified. Only a payment whose signature verifies
    // server-side is written to the Sheet, so an abandoned or faked checkout
    // leaves no order behind.
    function postJson(payload) {
        return fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        }).then(function (res) { return res.json(); });
    }

    function showPayError(message) {
        var box = $('payError');
        var waText = 'Reach out to us on WhatsApp';

        if (!box) { alert(message + '\n\n' + waText + '.'); return; }

        // Built as DOM nodes rather than innerHTML — some of these messages
        // carry a payment ID from the gateway, and that should never be able
        // to inject markup into the page.
        box.innerHTML = '';

        var line = document.createElement('div');
        line.textContent = message;
        box.appendChild(line);

        var wrap = document.createElement('div');
        wrap.style.marginTop = '6px';

        var link = document.createElement('a');
        link.href = whatsappOrderLink();
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'gold-text underline font-semibold';
        link.textContent = waText;
        wrap.appendChild(link);

        box.appendChild(wrap);
        box.style.display = 'block';
    }

    function hidePayError() {
        var box = $('payError');
        if (box) box.style.display = 'none';
    }

    function payWithRazorpay(orderData, btn) {
        var label = btn.getAttribute('data-label') || 'Pay Securely';
        function restore() { btn.disabled = false; btn.innerText = label; }
        function fail(message) { showPayError(message); restore(); }

        hidePayError();

        if (typeof Razorpay === 'undefined') {
            return fail("The payment window couldn't load. Check your connection and try again.");
        }

        postJson({
            action: 'createOrder',
            qty: orderData.qty,
            method: orderData.method,
            delivery_zone: orderData.delivery_zone,
            coupon_code: orderData.coupon_code,
            sender_phone: orderData.sender_phone,
            items_ordered: orderData.items_ordered
        })
        .then(function (order) {
            if (!order || order.error) {
                if (order && typeof order.remaining === 'number') applyStock(order.remaining);
                return fail((order && order.error) || "We couldn't start the payment.");
            }

            // The backend is the only thing that decides the amount. If what
            // it worked out differs from what the page was showing — a coupon
            // that expired between Apply and Pay, a price changed in the Sheet
            // mid-session — correct the figure here rather than letting the
            // Razorpay window be the first place they see a different number.
            if (typeof order.total === 'number') {
                var shown = Number(String($('finalT').innerText).replace(/[^0-9.]/g, ''));
                if (shown && Math.round(order.total) !== Math.round(shown)) {
                    $('finalT').innerText = '₹' + order.total;
                    showPayError('The amount has been updated to ₹' + order.total +
                                 ' — that is what you will be charged.');
                }
            }

            var rzp = new Razorpay({
                key:         order.keyId,
                amount:      order.amount,
                currency:    order.currency,
                name:        'French Halwai',
                description: orderData.items_ordered,
                order_id:    order.orderId,
                prefill: {
                    name:    orderData.sender_name,
                    contact: orderData.sender_phone ? '+91' + orderData.sender_phone : ''
                },
                theme: { color: '#7a4900' },
                modal: { ondismiss: restore },
                handler: function (response) {
                    btn.innerText = 'Confirming...';
                    showConfirmingState();

                    var payload = {};
                    for (var key in orderData) {
                        if (Object.prototype.hasOwnProperty.call(orderData, key)) payload[key] = orderData[key];
                    }
                    payload.action = 'verifyOrder';
                    payload.razorpay_order_id   = response.razorpay_order_id;
                    payload.razorpay_payment_id = response.razorpay_payment_id;
                    payload.razorpay_signature  = response.razorpay_signature;

                    postJson(payload)
                        .then(function (result) {
                            if (result && result.verified) {
                                var body = $('confirmBody');
                                if (body && result.oversold && result.message) body.textContent = result.message;
                                $('checkoutModal').style.display = 'none';
                                $('confirmModal').style.display = 'flex';
                                loadStock();
                            } else {
                                // Money may have left their account. Never tell
                                // them to just try again.
                                hideConfirmingState();
                                fail("We couldn't verify your payment. If you were charged, quote payment ID " +
                                     response.razorpay_payment_id + " and we'll sort it out.");
                            }
                        })
                        .catch(function () {
                            hideConfirmingState();
                            fail("Your payment went through, but we couldn't confirm it here. Please DON'T pay again — quote payment ID " +
                                 response.razorpay_payment_id + ".");
                        });
                }
            });

            rzp.on('payment.failed', function (resp) {
                fail('Payment failed: ' + ((resp && resp.error && resp.error.description) || 'please try again.'));
            });

            rzp.open();
        })
        .catch(function () {
            fail("We couldn't reach the payment server. Please try again.");
        });
    }

    function whatsappOrderLink() {
        var number = String(SHEET_CONFIG.whatsappnumber || '919527371656').replace(/\D/g, '');
        return 'https://wa.me/' + number +
               '?text=' + encodeURIComponent("Hi, I'd like to order the " + CURRENT_ITEM.name + '.');
    }

    // Indian mobile numbers are exactly 10 digits and start 6, 7, 8 or 9.
    // The old check was `length < 10`, which happily accepted a 15-digit
    // number or a landline — and those orders can't be reached on WhatsApp.
    function isIndianMobile(value) { return /^[6-9]\d{9}$/.test(digits(value)); }

    // "3rd September" — used in banners so the date is never typed twice.
    function formatDropDate(date) {
        var months = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
        var ist = new Date(date.getTime() + (5.5 * 3600 * 1000));
        var d = ist.getUTCDate();
        var suffix = (d % 100 >= 11 && d % 100 <= 13) ? 'th'
                   : ['th','st','nd','rd'][d % 10] || 'th';
        return d + suffix + ' ' + months[ist.getUTCMonth()];
    }

    // ── Render product info + past drops from the config above ─────────────
    function renderProductInfo() {
        $('itemName').textContent = CURRENT_ITEM.name;
        $('itemNameCard').textContent = CURRENT_ITEM.name;
        $('itemServesText').textContent = CURRENT_ITEM.servesText;
        $('itemDescription').textContent = CURRENT_ITEM.description;
        $('itemAllergens').textContent = CURRENT_ITEM.allergens;
        $('itemPrice').textContent = '₹' + CURRENT_ITEM.price;

        var slotEl = $('deliverySlotText');
        if (slotEl) slotEl.textContent = DELIVERY_SLOT;


        var gallery = $('itemGallery');
        var slidesHtml = '<span class="gallery-fallback">' + CURRENT_ITEM.name + '</span>';
        CURRENT_ITEM.images.forEach(function (src, i) {
            slidesHtml += '<img src="' + src + '" alt="' + CURRENT_ITEM.name + '" class="gallery-slide' + (i === 0 ? ' active' : '') + '" onerror="this.style.display=\'none\'">';
        });
        slidesHtml +=
            '<button type="button" class="g-nav g-prev" data-action="gallery-prev" aria-label="Previous photo">‹</button>' +
            '<button type="button" class="g-nav g-next" data-action="gallery-next" aria-label="Next photo">›</button>' +
            '<div class="g-dots">' +
            CURRENT_ITEM.images.map(function (_, i) {
                return '<span class="g-dot' + (i === 0 ? ' active' : '') + '" data-action="gallery-go" data-index="' + i + '"></span>';
            }).join('') +
            '</div>';
        gallery.innerHTML = slidesHtml;
    }

    function renderPastDrops() {
        var grid = $('pastDropsGrid');
        grid.innerHTML = PAST_DROPS.map(function (drop, di) {
            var imgs = drop.images || [];
            var slidesHtml = imgs.map(function (src, i) {
                return '<img src="' + src + '" alt="' + drop.name + '" class="gallery-slide' + (i === 0 ? ' active' : '') + '" data-gallery="' + di + '" data-index="' + i + '" onerror="this.style.display=\'none\'">';
            }).join('');
            var navHtml = '';
            if (imgs.length > 1) {
                navHtml =
                    '<button type="button" class="g-nav g-prev" style="width:22px;height:22px;font-size:12px;" data-action="past-prev" data-gallery="' + di + '" aria-label="Previous photo">‹</button>' +
                    '<button type="button" class="g-nav g-next" style="width:22px;height:22px;font-size:12px;" data-action="past-next" data-gallery="' + di + '" aria-label="Next photo">›</button>';
            }
            return (
                '<div class="bg-white border border-stone-100 shadow-sm overflow-hidden">' +
                    '<div class="gallery-fallback-box">' +
                        '<span>' + drop.name + '</span>' +
                        slidesHtml +
                        navHtml +
                    '</div>' +
                    '<div class="p-4 text-center">' +
                        '<p class="past-badge mb-2">Past Drop</p>' +
                        '<h4 class="font-serif italic text-lg">' + drop.name + '</h4>' +
                        '<p class="text-[11px] text-stone-400 italic mt-1">' + drop.description + '</p>' +
                    '</div>' +
                '</div>'
            );
        }).join('');
    }

    // ── Past-drop mini galleries (each tile navigates independently) ───────
    function pastGalleryGo(dropIdx, slideIdx) {
        var slides = document.querySelectorAll('#pastDropsGrid img[data-gallery="' + dropIdx + '"]');
        if (!slides.length) return;
        var n = slides.length;
        var idx = ((slideIdx % n) + n) % n;
        slides.forEach(function (s) { s.classList.toggle('active', Number(s.getAttribute('data-index')) === idx); });
    }
    function pastGalleryNav(dropIdx, step) {
        var slides = document.querySelectorAll('#pastDropsGrid img[data-gallery="' + dropIdx + '"]');
        var current = 0;
        slides.forEach(function (s) { if (s.classList.contains('active')) current = Number(s.getAttribute('data-index')); });
        pastGalleryGo(dropIdx, current + step);
    }

    // ── Stock ────────────────────────────────────────────────────────────────
    // Reads a date cell from the Sheet. Accepts an ISO string (a real date
    // cell) or plain text like "2026-09-03 11:00", which is read as IST — not
    // as the visitor's local time, so someone opening the page from abroad
    // doesn't see the drop open hours early.
    function parseSheetDate(value) {
        if (!value) return null;
        var text = String(value).trim();
        if (!text) return null;

        if (/(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
            var iso = new Date(text);
            return isNaN(iso.getTime()) ? null : iso;
        }
        var m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
        if (m) {
            var pad = function (v) { return String(v).length < 2 ? '0' + v : String(v); };
            var built = new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' +
                                 pad(m[4] || '00') + ':' + pad(m[5] || '00') + ':00+05:30');
            return isNaN(built.getTime()) ? null : built;
        }
        var loose = new Date(text);
        return isNaN(loose.getTime()) ? null : loose;
    }

    // Overlays whatever the Sheet supplies on top of the defaults above.
    // Anything the Sheet doesn't mention keeps its built-in value, so a blank
    // or half-filled Config tab degrades quietly instead of blanking the page.
    function applySheetConfig(cfg) {
        if (!cfg) return;
        SHEET_CONFIG = cfg;

        if (cfg.itemname)        CURRENT_ITEM.name        = String(cfg.itemname);
        if (cfg.itemdescription) CURRENT_ITEM.description = String(cfg.itemdescription);
        if (cfg.itemserves)      CURRENT_ITEM.servesText  = String(cfg.itemserves);
        if (cfg.itemallergens)   CURRENT_ITEM.allergens   = String(cfg.itemallergens);

        var price = Number(cfg.itemprice);
        if (Number.isFinite(price) && price > 0) CURRENT_ITEM.price = price;

        if (cfg.itemimages) {
            var imgs = String(cfg.itemimages).split(',')
                .map(function (x) { return x.trim(); })
                .filter(function (x) { return x.length; });
            if (imgs.length) CURRENT_ITEM.images = imgs;
        }

        var opens  = parseSheetDate(cfg.bookingopens);
        var cutoff = parseSheetDate(cfg.preordercutoff);
        if (opens)  BOOKING_OPENS   = opens;
        if (cutoff) PREORDER_CUTOFF = cutoff;

        if (cfg.deliveryslot) DELIVERY_SLOT = String(cfg.deliveryslot);

        var nextDrop = parseSheetDate(cfg.nextdropdate);
        if (nextDrop) NEXT_DROP_DATE = nextDrop;
    }

    function loadStock() {
        fetch(SCRIPT_URL, { method: 'GET' })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                applySheetConfig(data.config);

                if (Array.isArray(data.pastDrops) && data.pastDrops.length) {
                    PAST_DROPS = data.pastDrops;
                }

                // The item, dates and archive may all have just changed.
                renderProductInfo();
                renderPastDrops();
                refreshDropPhase();

                // MaxStock comes from the Config tab and always wins. The
                // number in this file is only ever a last resort.
                // ">= 0", not "> 0". MaxStock 0 in the Config tab is an
                // instruction — "there is no drop on" — and treating it as
                // missing is what used to leave a finished drop on sale.
                var m = Number(data.maxStock);
                if (Number.isFinite(m) && m >= 0) maxStock = m;
                dropInactive = maxStock <= 0;

                stockUnknown = false;
                stockLoaded = true;
                var remaining = Number(data.remaining);
                applyStock(Number.isFinite(remaining) ? remaining : maxStock);
            })
            .catch(function (err) {
                // We could NOT read the Sheet. Previously this quietly carried
                // on with the number baked into this file — so a drop of 7
                // would advertise 2, and a sold-out drop would still take
                // orders. Say we don't know instead of inventing a figure.
                console.warn('Could not reach the Sheet — availability is unknown.', err);
                stockUnknown = true;
                updateUI();
            });
    }

    function applyStock(remaining) {
        stockRemaining = dropInactive ? 0 : Math.max(0, Math.min(maxStock, remaining));
        if (cartQty > stockRemaining) cartQty = stockRemaining;
        updateUI();
    }

    // ── Which phase is the drop in? ─────────────────────────────────────────
    // Works out whether booking is open or closed. Deliberately displays
    // NOTHING — there is no countdown on this site. The dates still govern
    // when ordering opens and closes; they just do it silently.
    function refreshDropPhase() {
        var now = Date.now();

        if (PREVIEW) { updateUI(); return; }

        // A manual BookingMode in the Sheet beats the clock.
        var forced = String(SHEET_CONFIG.bookingmode || 'auto').trim().toLowerCase();
        if (forced !== 'auto' && forced !== '') {
            bookingOpen = (forced !== 'waitlist');
            preorderClosed = (forced === 'closed');
            updateUI();
            return;
        }

        var wasOpen = bookingOpen;
        var wasClosed = preorderClosed;

        bookingOpen = now >= BOOKING_OPENS.getTime();
        preorderClosed = bookingOpen && (now >= PREORDER_CUTOFF.getTime());

        if (bookingOpen !== wasOpen || preorderClosed !== wasClosed) updateUI();
    }

    // ── "Sending to someone else?" toggle ────────────────────
    function toggleGift() {
        isGift = !isGift;
        $('giftTogglePill').classList.toggle('on', isGift);
        $('receiverSection').classList.toggle('open', isGift);
        $('receiverName').required = isGift;
        $('receiverPhone').required = isGift;
    }

    // ── Cart ────────────────────────────────────────────────
    function addToCart() {
        if (dropInactive) { alert('There is no drop running right now. Join the waitlist and we\u2019ll message you when the next one opens.'); return; }
        if (!bookingOpen) { alert('Booking opens ' + formatDropDate(BOOKING_OPENS) + ' at 11am. Join the waitlist and we\'ll message you.'); return; }
        if (preorderClosed) { alert('Preorders have closed for this drop.'); return; }
        if (stockRemaining <= 0) { return; }
        if (cartQty >= stockRemaining) {
            alert("Only " + stockRemaining + " " + CURRENT_ITEM.name + " available for this drop. You've added the maximum.");
            return;
        }
        cartQty++;
        updateUI();
    }

    function removeFromCart() { if (cartQty > 0) { cartQty--; updateUI(); } }
    function clearItem() { cartQty = 0; updateUI(); }

    // ── Coupons — always validated on the server, one code at a time ───────
    function applyCoupon() {
        var input = $('couponInput');
        var msg = $('couponMsg');
        var code = (input.value || '').trim().toUpperCase();
        var phone = digits(document.querySelector('[name="sender_phone"]').value);

        if (!code) {
            msg.textContent = 'Enter a code first.';
            msg.className = 'text-[11px] mt-2 text-red-500';
            return;
        }
        if (!isIndianMobile(phone)) {
            msg.textContent = 'Enter your WhatsApp number above first, then apply the code.';
            msg.className = 'text-[11px] mt-2 text-red-500';
            return;
        }

        msg.textContent = 'Checking…';
        msg.className = 'text-[11px] mt-2 text-stone-400';

        var url = SCRIPT_URL + '?action=checkCoupon&code=' + encodeURIComponent(code) + '&phone=' + encodeURIComponent(phone);
        fetch(url, { method: 'GET' })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.ok) {
                    appliedCoupon = { code: code, type: data.type, value: data.value };
                    msg.textContent = 'Applied "' + code + '"!';
                    msg.className = 'text-[11px] mt-2 text-green-600 font-semibold';
                } else {
                    appliedCoupon = null;
                    msg.textContent = data.message || 'Invalid or expired code.';
                    msg.className = 'text-[11px] mt-2 text-red-500';
                }
                refreshFulfilmentAndTotal();
            })
            .catch(function () {
                appliedCoupon = null;
                msg.textContent = "Couldn't check that code — check your connection and try again.";
                msg.className = 'text-[11px] mt-2 text-red-500';
                refreshFulfilmentAndTotal();
            });
    }

    // ── Waitlist (shown automatically once sold out) ────────────────────────
    function joinWaitlist() {
        var name = $('waitlistName').value.trim();
        var phone = digits($('waitlistPhone').value);
        var msg = $('waitlistMsg');

        if (name.length < 2) { msg.textContent = 'Enter your name.'; msg.className = 'text-[11px] mt-2 text-red-500'; return; }
        if (!isIndianMobile(phone)) { msg.textContent = 'Enter a valid 10-digit WhatsApp number.'; msg.className = 'text-[11px] mt-2 text-red-500'; return; }

        var btn = $('waitlistBtn');
        btn.disabled = true;
        btn.textContent = 'Joining…';

        fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({ form_type: 'waitlist', name: name, phone: phone, next_drop_date: '' })
        }).then(function () {
            $('waitlistForm').innerHTML = '<p class="text-xs text-emerald-700 font-semibold text-center py-2">You\'re on the list! We\'ll message you on WhatsApp for the next drop.</p>';
        }).catch(function () {
            msg.textContent = "Couldn't reach the server — please message us on WhatsApp instead.";
            msg.className = 'text-[11px] mt-2 text-red-500';
            btn.disabled = false;
            btn.textContent = 'Join Waitlist';
        });
    }

    // ── Main UI state ────────────────────────────────────────────────────────
    function updateUI() {
        var left = stockRemaining - cartQty;

        var banner = $('topBanner');
        var badge = $('stockBadge');
        var cardMsg = $('cardStockMsg');
        var qtyBox = $('main-qty');

        // ── The switch in your Sheet ───────────────────────────────────────
        // Config tab, "BookingMode". Leave it as auto and the two dates run
        // the drop by themselves. Set anything else and it overrides them —
        // useful for opening early, or shutting the drop mid-flight without
        // having to invent a date.
        //
        //   auto      follow BookingOpens / PreorderCutoff  (normal)
        //   waitlist  force the pre-launch page (product hidden)
        //   open      force ordering open, ignoring the dates
        //   closed    force preorders closed
        //   soldout   show the product as sold out + waitlist
        var sheetMode = String(SHEET_CONFIG.bookingmode || 'auto').trim().toLowerCase();
        if (!PREVIEW) {
            if (sheetMode === 'open')          { bookingOpen = true;  preorderClosed = false; }
            else if (sheetMode === 'closed')   { bookingOpen = true;  preorderClosed = true; }
            else if (sheetMode === 'waitlist') { bookingOpen = false; preorderClosed = false; }
            else if (sheetMode === 'soldout')  { bookingOpen = true;  preorderClosed = false;
                                                 stockRemaining = 0; }
        }

        // Preview forces a phase. Real visitors never hit this branch.
        if (PREVIEW === 'preopen')      { bookingOpen = false; preorderClosed = false; }
        else if (PREVIEW === 'live')    { bookingOpen = true;  preorderClosed = false;
                                          if (stockRemaining <= 0) stockRemaining = maxStock || 1; }
        else if (PREVIEW === 'soldout') { bookingOpen = true;  preorderClosed = false; stockRemaining = 0; }
        else if (PREVIEW === 'closed')  { bookingOpen = true;  preorderClosed = true; }
        else if (PREVIEW === 'betweendrops') { dropInactive = true; }

        // ── Two states. Only ever two. ─────────────────────────────────────
        // Either the dessert is on sale, or it isn't and the page is the
        // waitlist — the same page index.html shows between drops. Four things
        // can put us in that second state (no drop configured, sold out, not
        // open yet, past the cutoff) but they are NOT four pages. Same layout
        // every time; one line of copy says which one it is.
        if (dropInactive) stockRemaining = 0;

        var soldOut = stockRemaining <= 0;
        var canBuy  = !dropInactive && bookingOpen && !preorderClosed && !soldOut;

        var reason = dropInactive     ? 'nodrop'
                   : soldOut          ? 'soldout'
                   : !bookingOpen     ? 'notyet'
                   : preorderClosed   ? 'closed'
                   :                    '';

        var nextDrop = formatDropDate(NEXT_DROP_DATE);

        // COPY[reason] — every word the waitlist page changes, in one place.
        var COPY = {
            nodrop: {
                banner:   'Next Drop · ' + nextDrop + ' · Join The Waitlist',
                badge:    '⚑ Between Drops',
                bg: '#f1f1ef', fg: '#78716c',
                heading:  SHEET_CONFIG.prelaunchheadline || 'Something\u2019s Coming',
                tagline:  'We\u2019re between dessert drops right now. Pop your name down below and ' +
                          'we\u2019ll message you the moment the next one opens.',
                waitlist: 'Be first to know when the ' + nextDrop + ' drop opens'
            },
            soldout: {
                banner:   'Sold Out For This Drop · Join The Waitlist',
                badge:    '⚑ Sold Out',
                bg: '#fee2e2', fg: '#991b1b',
                heading:  'Sold Out',
                tagline:  'We\u2019re sold out for this drop. Pop your name down below and we\u2019ll ' +
                          'message you the moment the next one opens.',
                waitlist: 'Sold out \u2014 join the waitlist for our next drop on ' + nextDrop
            },
            notyet: {
                banner:   'Next Drop · ' + formatDropDate(BOOKING_OPENS) + ' · Join The Waitlist',
                badge:    '⚑ Opening Soon',
                bg: '#fef3c7', fg: '#92400e',
                heading:  SHEET_CONFIG.prelaunchheadline || 'Something\u2019s Coming',
                tagline:  'Our next drop opens ' + formatDropDate(BOOKING_OPENS) +
                          '. Pop your name down below and we\u2019ll message you.',
                waitlist: 'Be first to know when this drop opens'
            },
            closed: {
                banner:   'Preorders Closed · Join The Waitlist',
                badge:    '⚑ Closed',
                bg: '#e5e7eb', fg: '#374151',
                heading:  'Preorders Closed',
                tagline:  'Preorders have closed for this drop. Pop your name down below and we\u2019ll ' +
                          'message you the moment the next one opens.',
                waitlist: 'Join the waitlist for our next drop on ' + nextDrop
            }
        };
        var copy = COPY[reason] || null;

        // The dessert is never painted before the Sheet has answered — on a
        // waitlist page, flashing the item for a second is the one thing
        // hiding it was supposed to prevent.
        // True once we've actually heard from the Sheet (or are unreachable, or
        // previewing) — false during the gap right after page load while the
        // fetch to Apps Script is still in flight. Nothing that reveals the
        // item name, price, or a guessed stock count should render before this
        // flips true, even outside the (already-hidden) product card.
        var known = stockLoaded || stockUnknown || !!PREVIEW;
        if (known) hideLoadingOverlay();
        var showProduct  = canBuy && known;
        var showWaitlist = !!copy && !stockUnknown;

        var productSection  = $('productSection');
        var waitlistSection = $('waitlistSection');
        if (productSection)  productSection.style.display  = showProduct  ? '' : 'none';
        if (waitlistSection) waitlistSection.style.display = showWaitlist ? '' : 'none';

        var heading = $('itemName');
        if (heading) heading.textContent = !known ? '' : (copy ? copy.heading : CURRENT_ITEM.name);

        var waitlistHeading = $('waitlistHeading');
        if (waitlistHeading) waitlistHeading.textContent = copy ? copy.waitlist : 'Join the Waitlist for our next dessert drop';

        var tagline = $('heroTagline');
        if (tagline) tagline.textContent = !known ? '' : (copy ? copy.tagline : 'Freshly made to order. Preorders open now.');

        if (!known) {
            // First paint, before the Sheet has answered at all. Show the same
            // neutral "checking" look as the unreachable-backend case below —
            // just without the WhatsApp fallback, since we haven't given up yet.
            banner.textContent = 'Checking Availability';
            badge.textContent = '⚑ Checking availability';
            badge.style.background = '#f1f1ef';
            badge.style.color = '#78716c';
            cardMsg.textContent = '';
        } else if (stockUnknown) {
            // Ordering is disabled rather than guessed at — taking an order we
            // can't check against the Sheet is how a drop gets oversold.
            banner.textContent = 'Checking Availability';
            badge.textContent = '⚑ Checking availability';
            badge.style.background = '#f1f1ef';
            badge.style.color = '#78716c';
            cardMsg.textContent = "We couldn't load availability just now.";
            qtyBox.innerHTML = '<a href="' + whatsappOrderLink() +
                '" target="_blank" rel="noopener" class="btn-luxury inline-block">Order on WhatsApp</a>';
        } else if (copy) {
            banner.textContent = copy.banner;
            badge.textContent = copy.badge;
            badge.style.background = copy.bg;
            badge.style.color = copy.fg;
            cardMsg.textContent = '';
        } else {
            banner.textContent = 'Preorder is Live';

            if (cartQty >= stockRemaining) {
                badge.textContent = '⚑ Fully Allocated';
                badge.style.background = '#fee2e2';
                badge.style.color = '#991b1b';
                cardMsg.textContent = '⚠ You have reserved all available units.';
            } else if (left <= 3) {
                badge.textContent = '⚑ Only ' + left + ' left!';
                badge.style.background = '#fef3c7';
                badge.style.color = '#92400e';
                cardMsg.textContent = 'Only ' + left + ' left — grab yours now.';
            } else {
                badge.textContent = '⚑ Only ' + stockRemaining + ' Left';
                badge.style.background = '#fef3c7';
                badge.style.color = '#92400e';
                cardMsg.textContent = '';
            }

            if (cartQty > 0) {
                qtyBox.innerHTML =
                    '<div class="flex items-center gap-3">' +
                        '<svg data-action="clear" class="delete-icon w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>' +
                        '</svg>' +
                        '<div class="qty-control">' +
                            '<span class="qty-btn" data-action="dec">−</span>' +
                            '<span class="font-bold">' + cartQty + '</span>' +
                            '<span class="qty-btn" data-action="add">+</span>' +
                        '</div>' +
                    '</div>';
            } else {
                qtyBox.innerHTML = '<button type="button" data-action="add" class="btn-luxury">Add to Bag</button>';
            }
        }

        $('bagCount').innerText = cartQty;
        $('floatCount').innerText = cartQty;
        $('floatingCart').style.display = cartQty > 0 ? 'block' : 'none';

        refreshFulfilmentAndTotal();

        if ($('checkoutModal').style.display === 'block') renderModalItems();
    }

    function refreshFulfilmentAndTotal() {
        var isDel = $('methodSelect').value === 'delivery';
        $('deliveryFields').classList.toggle('hidden', !isDel);
        $('addrInput').required = isDel;
        $('zoneSelect').required = isDel;

        // Switching to pickup empties the delivery fields rather than just
        // hiding them. Otherwise a half-filled address stays in the form and
        // rides along to the Sheet on a pickup order, which reads as a
        // delivery request nobody placed.
        if (!isDel) {
            $('addrInput').value = '';
            $('zoneSelect').value = '';
            var mapsField = document.querySelector('[name="maps_link"]');
            if (mapsField) mapsField.value = '';
        }

        var sub = CURRENT_ITEM.price * cartQty;
        var fee = isDel ? (DELIVERY_FEES[$('zoneSelect').value] || 0) : 0;

        var discount = 0;
        var discountLabel = '';
        if (appliedCoupon) {
            if (appliedCoupon.type === 'percent') {
                discount = Math.round(sub * appliedCoupon.value / 100);
                discountLabel = '−₹' + discount;
            } else if (appliedCoupon.type === 'flat') {
                discount = appliedCoupon.value;
                discountLabel = '−₹' + discount;
            } else if (appliedCoupon.type === 'free_delivery') {
                discount = fee;   // waive whatever the delivery fee is
                discountLabel = fee > 0 ? 'Free Delivery' : '—';
            }
            discount = Math.max(0, Math.min(discount, sub + fee));
        }
        lastDiscount = discount;

        var subEl = $('subtotalAmt');
        if (subEl) subEl.textContent = '₹' + sub;

        // Delivery is now shown as its own line rather than folded silently
        // into the total. People were watching the figure jump when they
        // picked a zone with nothing on the page explaining why.
        var delRow = $('deliveryRow');
        if (delRow) {
            if (isDel) {
                delRow.style.display = 'flex';
                $('deliveryAmt').textContent = fee > 0 ? '₹' + fee : 'Free';
                var zoneLabels = { koramangala: ' (Koramangala 4th Block)', '7km': ' (up to 7 km)', '10km': ' (7–12 km)' };
                $('deliveryZoneLabel').textContent = zoneLabels[$('zoneSelect').value] || '';
            } else {
                delRow.style.display = 'none';
            }
        }

        var discountRow = $('discountRow');
        if (discount > 0) {
            discountRow.style.display = 'flex';
            $('discountAmt').textContent = discountLabel;
            $('discountCodeLabel').textContent = ' (' + appliedCoupon.code + ')';
        } else {
            discountRow.style.display = 'none';
        }

        var payable = Math.max(0, sub + fee - discount);
        $('finalT').innerText = '₹' + payable;

        var payBtn = $('payBtn');
        if (payBtn && !payBtn.disabled) {
            var payLabel = payable > 0 ? 'Pay ₹' + payable + ' Securely' : 'Pay Securely';
            payBtn.setAttribute('data-label', payLabel);
            payBtn.innerText = payLabel;
        }
    }

    function renderModalItems() {
        var items = '';
        if (cartQty > 0) {
            items +=
                '<div class="flex justify-between items-center border-b pb-4">' +
                    '<div class="flex items-center gap-3">' +
                        '<svg data-action="clear" class="delete-icon w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>' +
                        '</svg>' +
                        '<span class="font-serif italic text-lg">' + CURRENT_ITEM.name + '</span>' +
                    '</div>' +
                    '<div class="qty-control">' +
                        '<span class="qty-btn" data-action="dec">−</span>' +
                        '<span class="font-bold text-sm">' + cartQty + '</span>' +
                        '<span class="qty-btn" data-action="add">+</span>' +
                    '</div>' +
                '</div>';
        }
        $('modalItems').innerHTML = items;
    }

    function openCart() {
        if (cartQty === 0) { alert("Bag is empty"); return; }
        hideConfirmingState();
        $('checkoutModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
        updateUI();
    }

    function closeCart() {
        $('checkoutModal').style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    // ── Gallery ─────────────────────────────────────────────
    var galleryIdx = 0;
    function galleryRender() {
        var slides = document.querySelectorAll('#itemGallery .gallery-slide');
        var dots = document.querySelectorAll('#itemGallery .g-dot');
        slides.forEach(function (s, i) { s.classList.toggle('active', i === galleryIdx); });
        dots.forEach(function (d, i) { d.classList.toggle('active', i === galleryIdx); });
    }
    function galleryGo(i) {
        var n = document.querySelectorAll('#itemGallery .gallery-slide').length;
        if (!n) return;
        galleryIdx = ((i % n) + n) % n;
        galleryRender();
    }
    function galleryNav(step) { galleryGo(galleryIdx + step); }

    // ── One delegated click handler for every control ───────
    document.addEventListener('click', function (e) {
        var el = e.target.closest ? e.target.closest('[data-action]') : null;
        if (!el) return;
        var action = el.getAttribute('data-action');

        if (action === 'add')              { addToCart(); }
        else if (action === 'dec')         { removeFromCart(); }
        else if (action === 'clear')       { clearItem(); }
        else if (action === 'open-cart')   { openCart(); }
        else if (action === 'close-cart')  { closeCart(); }
        else if (action === 'toggle-gift') { toggleGift(); }
        else if (action === 'apply-coupon'){ applyCoupon(); }
        else if (action === 'join-waitlist'){ joinWaitlist(); }
        else if (action === 'gallery-prev'){ galleryNav(-1); }
        else if (action === 'gallery-next'){ galleryNav(1); }
        else if (action === 'gallery-go')  { galleryGo(Number(el.getAttribute('data-index')) || 0); }
        else if (action === 'past-prev')   { pastGalleryNav(Number(el.getAttribute('data-gallery')), -1); }
        else if (action === 'past-next')   { pastGalleryNav(Number(el.getAttribute('data-gallery')), 1); }
    });

    $('methodSelect').addEventListener('change', refreshFulfilmentAndTotal);
    $('zoneSelect').addEventListener('change', refreshFulfilmentAndTotal);
    $('couponInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); }
    });

    // ── Order submit ────────────────────────────────────────
    $('orderForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var form = e.target;

        if (preorderClosed) { alert('Preorders have closed for this drop. Please check back for the next one!'); return; }

        // Note: we don't rely on form.reportValidity()'s native tooltip here —
        // inside this fixed/scrolling modal, Chrome often fails to render it,
        // which makes the form look like it's doing nothing when a required
        // field is just empty. So we scroll to the field AND show a clear alert.
        if (!form.checkValidity()) {
            var invalid = form.querySelector(':invalid');
            if (invalid) {
                invalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
                invalid.focus();
            }
            alert('Please fill in all required fields (marked *) before submitting.');
            return;
        }

        var sPhone = digits(form.sender_phone.value);
        if (!isIndianMobile(sPhone)) { alert("Please enter a valid 10-digit Indian mobile number (starting 6, 7, 8 or 9)."); form.sender_phone.focus(); return; }
        if (isGift && !isIndianMobile(form.receiver_phone.value)) {
            alert("Please enter a valid 10-digit mobile number for the person receiving this.");
            form.receiver_phone.focus(); return;
        }
        if (isGift) {
            var rPhone = digits($('receiverPhone').value);
            if (rPhone.length < 10) { alert("Please enter a valid 10-digit number for the receiver."); $('receiverPhone').focus(); return; }
        }

        if (cartQty === 0) { alert("Your bag is empty."); return; }
        if (cartQty > stockRemaining) { alert("Only " + stockRemaining + " " + CURRENT_ITEM.name + " available. Please reduce your quantity."); return; }

        var btn = form.querySelector('button[type="submit"]');
        btn.innerText = "Processing...";
        btn.disabled = true;

        if (PREVIEW) {
            alert('Preview mode — this order was not submitted. Remove ?preview= from the URL to order for real.');
            btn.disabled = false;
            btn.innerText = btn.getAttribute('data-label') || 'Pay Securely';
            return;
        }

        var fd = new FormData(form);
        var isDel = $('methodSelect').value === 'delivery';

        var orderData = {
            sender_name:     fd.get('sender_name'),
            sender_phone:    fd.get('sender_phone'),
            is_gift:         isGift ? "Yes" : "No",
            receiver_name:   isGift ? fd.get('receiver_name')  : "N/A",
            receiver_phone:  isGift ? fd.get('receiver_phone') : "N/A",
            method:          $('methodSelect').value,
            items_ordered:   CURRENT_ITEM.name + ' x' + cartQty,
            qty:             cartQty,
            delivery_zone:   isDel ? $('zoneSelect').value : "N/A",
            delivery_fee:    isDel ? (DELIVERY_FEES[$('zoneSelect').value] || 0) : 0,
            coupon_code:     appliedCoupon ? appliedCoupon.code : "None",
            discount_amount: lastDiscount,
            address:         fd.get('address') || "N/A",
            maps_link:       fd.get('maps_link') || "",
            notes:           fd.get('notes') || "",
            heard_from:      fd.get('heard_from') || "",
            referral_source: (function () { try { return localStorage.getItem('order_ref') || "Direct"; } catch (err) { return "Direct"; } })(),
            total:           $('finalT').innerText
        };

        payWithRazorpay(orderData, btn);
    });

    setInterval(function () { galleryNav(1); }, 4500);
    setInterval(refreshDropPhase, 30000);

    renderProductInfo();
    renderPastDrops();
    refreshDropPhase();
    loadStock();
})();
