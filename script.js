(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };

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
        price: 550,
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

    var DEFAULT_MAX_STOCK = 2;   // fallback cap, used only if the server call below fails

    // Preorders stop being accepted after this moment (IST). Update this for
    // every new drop. Format: 'YYYY-MM-DDTHH:MM:SS+05:30'.
    var PREORDER_CUTOFF = new Date('2026-08-21T19:00:00+05:30');

    // ═══════════════════════════════════════════════════════════════════════
    // Below this line is site logic — safe to leave alone.
    // ═══════════════════════════════════════════════════════════════════════

    // QR tracking
    var params = new URLSearchParams(window.location.search);
    var refFromURL = params.get('ref');
    if (refFromURL) { try { localStorage.setItem('order_ref', refFromURL.toLowerCase()); } catch (e) {} }

    var maxStock = DEFAULT_MAX_STOCK;
    var stockRemaining = DEFAULT_MAX_STOCK;
    var cartQty = 0;              // there's only ever one item in the bag: CURRENT_ITEM
    var DELIVERY_FEES = { koramangala: 0, '7km': 100, '10km': 150 };
    var preorderClosed = false;   // flips true once PREORDER_CUTOFF passes

    var isGift = false;           // true once "Sending to someone else?" is toggled on

    // Coupons — validated one at a time on the server, never listed publicly.
    var appliedCoupon = null;     // { code, type, value } once a valid code is applied
    var lastDiscount = 0;         // last computed discount amount, sent along with the order

    var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby-FcX9uvZeOD8TYsVTSlGRZJ3hRISMscWk3p2k_WtAuWH2a7zdAGNhQc6f_Td6j5_T/exec';

    function digits(s) { return (s || '').replace(/\D/g, ''); }

    // ── Render product info + past drops from the config above ─────────────
    function renderProductInfo() {
        $('itemName').textContent = CURRENT_ITEM.name;
        $('itemNameCard').textContent = CURRENT_ITEM.name;
        $('itemServesText').textContent = CURRENT_ITEM.servesText;
        $('itemDescription').textContent = CURRENT_ITEM.description;
        $('itemAllergens').textContent = CURRENT_ITEM.allergens;
        $('itemPrice').textContent = '₹' + CURRENT_ITEM.price;

        var gallery = $('itemGallery');
        var slidesHtml = '<span class="gallery-fallback">' + CURRENT_ITEM.name + '</span>';
        CURRENT_ITEM.images.forEach(function (src, i) {
            slidesHtml += '<img src="' + src + '" alt="' + CURRENT_ITEM.name + '" class="mango-slide' + (i === 0 ? ' active' : '') + '" onerror="this.style.display=\'none\'">';
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
                return '<img src="' + src + '" alt="' + drop.name + '" class="mango-slide' + (i === 0 ? ' active' : '') + '" data-gallery="' + di + '" data-index="' + i + '" onerror="this.style.display=\'none\'">';
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
    function loadStock() {
        fetch(SCRIPT_URL, { method: 'GET' })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                var m = Number(data.maxStock);
                if (Number.isFinite(m) && m > 0) maxStock = m;

                var remaining = Number(data.remaining);
                applyStock(Number.isFinite(remaining) ? remaining : maxStock);
            })
            .catch(function (err) {
                console.warn('Stock fetch failed — falling back to defaults.', err);
                applyStock(maxStock);
            });
    }

    function applyStock(remaining) {
        stockRemaining = Math.max(0, Math.min(maxStock, remaining));
        if (cartQty > stockRemaining) cartQty = stockRemaining;
        updateUI();
    }

    // ── Preorder countdown ──────────────────────────────────────────────────
    function updateCountdown() {
        var msLeft = PREORDER_CUTOFF.getTime() - Date.now();
        var countdownEl = $('countdownText');

        if (msLeft <= 0) {
            var wasOpen = !preorderClosed;
            preorderClosed = true;
            countdownEl.textContent = '';
            if (wasOpen) updateUI();
            return;
        }

        var totalMinutes = Math.floor(msLeft / 60000);
        var days = Math.floor(totalMinutes / 1440);
        var hours = Math.floor((totalMinutes % 1440) / 60);
        var minutes = totalMinutes % 60;
        var parts = [];
        if (days > 0) parts.push(days + 'd');
        if (days > 0 || hours > 0) parts.push(hours + 'h');
        parts.push(minutes + 'm');
        countdownEl.textContent = 'Preorders close in ' + parts.join(' ') + ' — order before it sells out!';
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

    function copyUPI() {
        var tip = $('copyTooltip');
        var show = function () { tip.classList.add('show'); setTimeout(function () { tip.classList.remove('show'); }, 2000); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText("9527371656@yescred").then(show).catch(show);
        } else { show(); }
    }

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
        if (phone.length < 10) {
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
        if (phone.length < 10) { msg.textContent = 'Enter a valid 10-digit WhatsApp number.'; msg.className = 'text-[11px] mt-2 text-red-500'; return; }

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
        var qtyBox = $('main-qty-mango');
        var waitlistForm = $('waitlistForm');

        if (stockRemaining <= 0) {
            banner.textContent = 'This Drop Is Sold Out · Join the Waitlist Below';
            badge.textContent = '⚑ Sold Out';
            badge.style.background = '#fee2e2';
            badge.style.color = '#991b1b';
            cardMsg.textContent = '';
            qtyBox.innerHTML = '<button type="button" class="btn-luxury" disabled>Sold Out</button>';
            waitlistForm.style.display = 'block';
        } else if (preorderClosed) {
            banner.textContent = 'Preorders Closed';
            badge.textContent = '⚑ Closed';
            badge.style.background = '#e5e7eb';
            badge.style.color = '#374151';
            cardMsg.textContent = '';
            qtyBox.innerHTML = '<button type="button" class="btn-luxury" disabled>Preorders Closed</button>';
            waitlistForm.style.display = 'none';
        } else {
            waitlistForm.style.display = 'none';
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

        var discountRow = $('discountRow');
        if (discount > 0) {
            discountRow.style.display = 'flex';
            $('discountAmt').textContent = discountLabel;
            $('discountCodeLabel').textContent = ' (' + appliedCoupon.code + ')';
        } else {
            discountRow.style.display = 'none';
        }

        $('finalT').innerText = '₹' + Math.max(0, sub + fee - discount);
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
        var slides = document.querySelectorAll('#itemGallery .mango-slide');
        var dots = document.querySelectorAll('#itemGallery .g-dot');
        slides.forEach(function (s, i) { s.classList.toggle('active', i === galleryIdx); });
        dots.forEach(function (d, i) { d.classList.toggle('active', i === galleryIdx); });
    }
    function galleryGo(i) {
        var n = document.querySelectorAll('#itemGallery .mango-slide').length;
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
        else if (action === 'copy-upi')    { copyUPI(); }
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
        if (sPhone.length < 10) { alert("Please enter a valid 10-digit WhatsApp number."); form.sender_phone.focus(); return; }
        if (isGift) {
            var rPhone = digits($('receiverPhone').value);
            if (rPhone.length < 10) { alert("Please enter a valid 10-digit number for the receiver."); $('receiverPhone').focus(); return; }
        }

        if (cartQty === 0) { alert("Your bag is empty."); return; }
        if (cartQty > stockRemaining) { alert("Only " + stockRemaining + " " + CURRENT_ITEM.name + " available. Please reduce your quantity."); return; }

        var btn = form.querySelector('button[type="submit"]');
        btn.innerText = "Processing...";
        btn.disabled = true;

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

        fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(orderData) })
            .then(function () {
                $('checkoutModal').style.display = 'none';
                $('confirmModal').style.display = 'flex';
            })
            .catch(function (err) {
                alert("Couldn't reach the server: " + (err && err.message ? err.message : err) + "\nPlease check your connection or contact us on WhatsApp.");
                console.error("Order submit failed:", err);
                btn.innerText = "I've Paid — Confirm Preorder";
                btn.disabled = false;
            });
    });

    setInterval(function () { galleryNav(1); }, 4500);
    setInterval(updateCountdown, 30000);

    renderProductInfo();
    renderPastDrops();
    updateCountdown();
    loadStock();
})();
