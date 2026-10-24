/**
 * DigiSplit — Smart POS Terminal Demo v4.0
 * 
 * Key Features & Fixes:
 * 1. Default starts at 0.00 AED with dual options: Pay Full Bill vs DigiSplit Bill.
 * 2. By Amount (Unequal Split):
 *    - Strict balance validation (unallocated vs overallocated warnings).
 *    - Order CANNOT close if total paid < total bill.
 *    - If all current payers are settled but bill still has remaining unpaid balance,
 *      prompts with "+ Add Payer for Remaining Balance".
 *    - Add and remove payers dynamically with auto-balanced defaults.
 * 3. Mixed Tender:
 *    - Cashier can edit Voucher, Cash, and Card amounts freely.
 *    - Voucher has direct "Apply Voucher" button that instantly redeems on the spot
 *      WITHOUT going to a payment screen, prints thermal slip, and updates balance!
 *    - Cash goes directly to cash entry with live change calculation.
 * 4. Professional Payer 1, Payer 2, Payer 3 labels throughout.
 */

const state = {
  // Order information
  parentOrderId: 'ORD-DXB-88421',
  currency: 'AED',
  totalBill: 0.00,
  enteredAmountStr: '0',
  vatRate: 0.05,
  isFullBillPay: false,
  
  // Active POS screen view
  currentView: 'view-enter-bill',
  
  // Split configuration
  currentMode: 'equal',
  equalPayerCount: 3,
  
  // Payers & settlement state
  payers: [],
  childTransactions: [],
  activePayer: null,
  editingPayerId: null,
  
  // Payment step selections
  selectedTipPct: 0,
  selectedMethod: 'card', // 'card' or 'cash'
  cashEntered: 0,
  
  // Menu items for By-Item mode
  menuItems: [
    { id: 1, name: 'Main Course A', price: 120.00, assignedTo: 0 },
    { id: 2, name: 'Main Course B', price: 95.00, assignedTo: 1 },
    { id: 3, name: 'Appetizer Platter', price: 65.00, assignedTo: 2 },
    { id: 4, name: 'Beverages (x2)', price: 50.00, assignedTo: 'shared' },
    { id: 5, name: 'Dessert Special', price: 120.00, assignedTo: 'shared' }
  ]
};

// Web Audio API Approval Chime
function playApprovalChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.1); // A5
    gain2.gain.setValueAtTime(0.18, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.5);
  } catch (e) {}
}

// Cash Drawer Chime
function playCashChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1046.5, now); // C6
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  } catch (e) {}
}

// Thermal paper slip ejection animation
function triggerReceiptPaperEjection(payerTitle, amountStr) {
  const slip = document.getElementById('printer-paper-slip');
  document.getElementById('slip-order-id').textContent = state.parentOrderId;
  document.getElementById('slip-amount').textContent = `${amountStr} PAID`;
  
  slip.classList.add('ejected');
  setTimeout(() => {
    slip.classList.remove('ejected');
  }, 4000);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initKeypad();
  initSplitModes();
  initPaymentStep();
  initOrderClosedActions();
  initAmountEditModal();
  
  // Set initial screen starting at 0 AED
  switchScreen('view-enter-bill');
  updateKeypadDisplay();
});

// Terminal Clock
function initClock() {
  const clockEl = document.getElementById('pos-clock');
  function update() {
    const d = new Date();
    clockEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  update();
  setInterval(update, 30000);
}

// Switch screen views
function switchScreen(viewId) {
  document.querySelectorAll('.screen-view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(viewId);
  if (target) {
    target.classList.add('active');
    state.currentView = viewId;
  }
}

// ==========================================================================
// SCREEN 1: BILL ENTRY KEYPAD & DUAL STARTING OPTIONS (Starts at 0.00 AED)
// ==========================================================================
function updateKeypadDisplay() {
  const display = document.getElementById('keypad-display-amount');
  const vatDisplay = document.getElementById('entry-vat-calc');
  const btnPayFull = document.getElementById('btn-pay-full');
  const btnDigisplit = document.getElementById('btn-proceed-to-split');

  const rawVal = parseFloat(state.enteredAmountStr) || 0;
  state.totalBill = rawVal;
  display.textContent = rawVal.toFixed(2);

  const vat = rawVal - (rawVal / (1 + state.vatRate));
  vatDisplay.textContent = `AED ${vat.toFixed(2)}`;

  if (rawVal > 0) {
    btnPayFull.removeAttribute('disabled');
    btnDigisplit.removeAttribute('disabled');
  } else {
    btnPayFull.setAttribute('disabled', 'true');
    btnDigisplit.setAttribute('disabled', 'true');
  }
}

function initKeypad() {
  // Keypad button clicks
  document.querySelectorAll('.key-btn[data-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-key');
      if (state.enteredAmountStr === '0') {
        state.enteredAmountStr = k;
      } else if (state.enteredAmountStr.length < 7) {
        state.enteredAmountStr += k;
      }
      updateKeypadDisplay();
    });
  });

  // Clear button
  document.getElementById('key-clear').addEventListener('click', () => {
    state.enteredAmountStr = '0';
    updateKeypadDisplay();
  });

  // Backspace button
  document.getElementById('key-back').addEventListener('click', () => {
    if (state.enteredAmountStr.length > 1) {
      state.enteredAmountStr = state.enteredAmountStr.slice(0, -1);
    } else {
      state.enteredAmountStr = '0';
    }
    updateKeypadDisplay();
  });

  // Option 1: Pay Full Bill (Single transaction)
  document.getElementById('btn-pay-full').addEventListener('click', () => {
    if (state.totalBill <= 0) return;
    state.isFullBillPay = true;
    state.parentOrderId = `ORD-DXB-${Math.floor(10000 + Math.random() * 90000)}`;
    
    // Create 1 single payer for full bill
    state.payers = [{
      id: 0,
      name: 'Full Order',
      share: state.totalBill,
      cardLast4: '4291',
      defaultMethod: 'card',
      settled: false,
      tip: 0,
      totalPaid: 0,
      authCode: null
    }];
    state.childTransactions = [];

    startPayerPayment(0);
  });

  // Option 2: DigiSplit Bill (Proceed to split modes)
  document.getElementById('btn-proceed-to-split').addEventListener('click', () => {
    if (state.totalBill <= 0) return;
    state.isFullBillPay = false;
    state.parentOrderId = `ORD-DXB-${Math.floor(10000 + Math.random() * 90000)}`;
    document.getElementById('active-parent-order-id').textContent = state.parentOrderId;
    
    recalculateSplit();
    switchScreen('view-split-flow');
  });
}

// ==========================================================================
// SCREEN 2: DIGISPLIT FLOW & MODES (With Strict Validation & Mixed Voucher)
// ==========================================================================
function initSplitModes() {
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentMode = tab.getAttribute('data-mode');
      resetSettledState();
      renderModeOptions();
      recalculateSplit();
    });
  });

  // Edit Bill button (returns to Keypad)
  document.getElementById('btn-edit-total-bill').addEventListener('click', () => {
    state.enteredAmountStr = Math.round(state.totalBill).toString();
    updateKeypadDisplay();
    switchScreen('view-enter-bill');
  });

  // Cancel / Back button
  document.getElementById('btn-cancel-split').addEventListener('click', () => {
    switchScreen('view-enter-bill');
  });

  // Quick Auto Settle
  document.getElementById('btn-quick-auto-run').addEventListener('click', runAutoSettle);

  // Button to add remaining payer when bill unpaid gap exists
  document.getElementById('btn-add-remaining-payer').addEventListener('click', () => {
    const totalPaid = state.payers.filter(p => p.settled).reduce((acc, p) => acc + p.share, 0);
    const remaining = Number((state.totalBill - totalPaid).toFixed(2));
    if (remaining <= 0) return;

    const nextId = state.payers.length;
    state.payers.push({
      id: nextId,
      name: `Payer ${nextId + 1}`,
      share: remaining,
      cardLast4: '4000',
      defaultMethod: 'card',
      settled: false,
      tip: 0,
      totalPaid: 0,
      authCode: null
    });

    renderPayersList();
    updateBalanceDisplay();
    renderModeOptions();
    showToast(`✓ Added Payer ${nextId + 1} for remaining AED ${remaining.toFixed(2)}`);
  });

  renderModeOptions();
}

function renderModeOptions() {
  const panel = document.getElementById('mode-options-panel');
  const total = state.totalBill;
  const allocatedSum = state.payers.reduce((sum, p) => sum + p.share, 0);
  const diff = Number((total - allocatedSum).toFixed(2));

  if (state.currentMode === 'equal') {
    panel.innerHTML = `
      <div class="options-pill-row">
        <span>Equal shares:</span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="circle-counter-btn" id="btn-dec-diners">-</button>
          <strong style="font-size: 0.95rem; color: #055ca6;" id="disp-diners-num">${state.equalPayerCount} Diners</strong>
          <button class="circle-counter-btn" id="btn-inc-diners">+</button>
        </div>
        <span style="font-size: 0.68rem; color: #888;">(AED ${(state.totalBill / state.equalPayerCount).toFixed(2)}/each)</span>
      </div>
    `;

    document.getElementById('btn-dec-diners').addEventListener('click', () => {
      if (state.equalPayerCount > 2) {
        state.equalPayerCount--;
        renderModeOptions();
        recalculateSplit();
      }
    });

    document.getElementById('btn-inc-diners').addEventListener('click', () => {
      if (state.equalPayerCount < 6) {
        state.equalPayerCount++;
        renderModeOptions();
        recalculateSplit();
      }
    });

  } else if (state.currentMode === 'amount') {
    let statusBannerHtml = '';
    if (Math.abs(diff) < 0.01) {
      statusBannerHtml = `<div class="alloc-status-banner alloc-balanced"><span>✓ Full AED ${total.toFixed(2)} allocated across ${state.payers.length} payers</span></div>`;
    } else if (diff > 0.01) {
      statusBannerHtml = `<div class="alloc-status-banner alloc-warning"><span>⚠️ AED ${diff.toFixed(2)} unallocated! Tap + Add Payer or edit shares.</span></div>`;
    } else {
      statusBannerHtml = `<div class="alloc-status-banner alloc-error"><span>⚠️ Overallocated by AED ${Math.abs(diff).toFixed(2)}! Shares exceed bill.</span></div>`;
    }

    panel.innerHTML = `
      <div class="by-amount-panel-header">
        <span style="font-size:0.7rem; font-weight:700; color:#055ca6;">Custom Unequal Split</span>
        <button class="btn-add-payer" id="btn-add-payer-by-amt">+ Add Payer</button>
      </div>
      ${statusBannerHtml}
    `;

    document.getElementById('btn-add-payer-by-amt').addEventListener('click', () => {
      if (state.payers.length < 8) {
        const nextId = state.payers.length;
        const currentAlloc = state.payers.reduce((sum, p) => sum + p.share, 0);
        const unalloc = Math.max(0, Number((state.totalBill - currentAlloc).toFixed(2)));

        state.payers.push({
          id: nextId,
          name: `Payer ${nextId + 1}`,
          share: unalloc,
          cardLast4: (3000 + nextId * 100).toString(),
          defaultMethod: 'card',
          settled: false,
          tip: 0,
          totalPaid: 0,
          authCode: null
        });

        renderPayersList();
        updateBalanceDisplay();
        renderModeOptions();
      }
    });

  } else if (state.currentMode === 'item') {
    const list = state.menuItems.map(item => `
      <div style="display:flex; justify-content:space-between; font-size:0.7rem; margin-bottom:2px;">
        <span>${item.name} (AED ${item.price})</span>
        <strong style="color:#055ca6;">${item.assignedTo === 'shared' ? 'Shared' : `Payer ${item.assignedTo + 1}`}</strong>
      </div>
    `).join('');

    panel.innerHTML = `
      <div style="max-height: 55px; overflow-y:auto; padding-right:4px;">
        ${list}
      </div>
    `;
  } else if (state.currentMode === 'mixed') {
    panel.innerHTML = `
      <div style="font-size: 0.68rem; color: #0b6131; text-align: center; font-weight:600;">
        🔀 Mixed Tender: Tap any amount below to edit. Apply voucher instantly!
      </div>
    `;
  }
}

function recalculateSplit() {
  const total = state.totalBill;
  let newPayers = [];

  if (state.currentMode === 'equal') {
    const count = state.equalPayerCount;
    const base = Math.floor((total / count) * 100) / 100;
    const remainder = Math.round((total - (base * count)) * 100) / 100;

    for (let i = 0; i < count; i++) {
      const share = (i === count - 1) ? Number((base + remainder).toFixed(2)) : base;
      newPayers.push({
        id: i,
        name: `Payer ${i + 1}`,
        share: share,
        cardLast4: (4000 + i * 111).toString(),
        defaultMethod: i === 1 ? 'cash' : 'card',
        settled: false,
        tip: 0,
        totalPaid: 0,
        authCode: null
      });
    }

  } else if (state.currentMode === 'amount') {
    // Initial 3 payers with default unequal amounts: 50%, 30%, 20%
    const p1 = Number((total * 0.50).toFixed(2));
    const p2 = Number((total * 0.30).toFixed(2));
    const p3 = Number(Math.max(0, total - p1 - p2).toFixed(2));

    newPayers = [
      { id: 0, name: 'Payer 1', share: p1, cardLast4: '4291', defaultMethod: 'card', settled: false },
      { id: 1, name: 'Payer 2', share: p2, cardLast4: '8830', defaultMethod: 'cash', settled: false },
      { id: 2, name: 'Payer 3', share: p3, cardLast4: '1944', defaultMethod: 'card', settled: false }
    ];

  } else if (state.currentMode === 'item') {
    const guestSubs = [0, 0, 0];
    state.menuItems.forEach(item => {
      if (item.assignedTo === 'shared') {
        const each = item.price / 3;
        guestSubs[0] += each;
        guestSubs[1] += each;
        guestSubs[2] += each;
      } else {
        guestSubs[item.assignedTo] += item.price;
      }
    });

    newPayers = [
      { id: 0, name: 'Payer 1', share: Number(guestSubs[0].toFixed(2)), cardLast4: '4291', defaultMethod: 'card', settled: false },
      { id: 1, name: 'Payer 2', share: Number(guestSubs[1].toFixed(2)), cardLast4: '8830', defaultMethod: 'cash', settled: false },
      { id: 2, name: 'Payer 3', share: Number(guestSubs[2].toFixed(2)), cardLast4: '1944', defaultMethod: 'card', settled: false }
    ];

  } else if (state.currentMode === 'mixed') {
    // 3 editable tenders: Voucher (default 50), Cash (default 100), Card (remaining)
    const vShare = Math.min(50, total);
    const cShare = Math.min(100, Math.max(0, total - vShare));
    const cardShare = Math.max(0, Number((total - vShare - cShare).toFixed(2)));

    newPayers = [
      { id: 0, name: 'Voucher', isVoucher: true, share: vShare, cardLast4: 'VOUCH', defaultMethod: 'voucher', settled: false },
      { id: 1, name: 'Cash', isCash: true, share: cShare, cardLast4: 'CASH', defaultMethod: 'cash', settled: false },
      { id: 2, name: 'Card', isCard: true, share: cardShare, cardLast4: '4291', defaultMethod: 'card', settled: false }
    ];
  }

  state.payers = newPayers;
  state.childTransactions = [];
  renderPayersList();
  updateBalanceDisplay();
  renderModeOptions();
}

function renderPayersList() {
  const container = document.getElementById('payers-scroll-list');
  const countLabel = document.getElementById('payers-header-label');
  const settledCountEl = document.getElementById('payers-settled-count');

  countLabel.textContent = `PAYER SHARES (${state.payers.length})`;
  const settledCount = state.payers.filter(p => p.settled).length;
  settledCountEl.textContent = `${settledCount} of ${state.payers.length} Settled`;

  container.innerHTML = state.payers.map((payer, idx) => {
    const isNext = !payer.settled && (idx === 0 || state.payers[idx - 1].settled);
    const isEditableMode = state.currentMode === 'amount' || state.currentMode === 'mixed';
    const isVoucher = payer.isVoucher === true;

    // Subtext description
    let subtext = '';
    if (payer.settled) {
      subtext = `${payer.methodTitle} • Total: AED ${payer.totalPaid.toFixed(2)}`;
    } else if (isVoucher) {
      subtext = 'Store Gift Card / Coupon';
    } else if (isEditableMode) {
      subtext = 'Tap amount to edit share';
    } else {
      subtext = payer.defaultMethod === 'cash' ? 'Prefers Cash' : 'Prefers Card';
    }

    return `
      <div class="payer-row-card ${payer.settled ? 'settled' : ''} ${isNext ? 'active-payer' : ''}">
        <div class="p-left">
          <div class="p-avatar">${payer.settled ? '✓' : (isVoucher ? '🎟️' : (idx + 1))}</div>
          <div class="p-details">
            <span class="p-name">${payer.name}</span>
            <span class="p-sub">${subtext}</span>
          </div>
        </div>

        <div class="p-right">
          ${!payer.settled && isEditableMode 
            ? `<span class="p-amt-clickable" data-edit-id="${payer.id}" title="Click to edit amount">AED ${payer.share.toFixed(2)} ✏️</span>` 
            : `<span class="p-amt">AED ${payer.share.toFixed(2)}</span>`}

          ${payer.settled 
            ? `<span class="badge-paid">Paid</span>` 
            : (isVoucher 
                ? `<button class="btn-collect-share" style="background:#0b6131;" data-voucher-id="${payer.id}">Apply Voucher</button>`
                : `<button class="btn-collect-share" data-id="${payer.id}">Pay Share</button>`)}

          ${!payer.settled && state.currentMode === 'amount' && state.payers.length > 1
            ? `<button class="btn-delete-payer" data-del-id="${payer.id}" title="Remove payer">✕</button>`
            : ''}
        </div>
      </div>
    `;
  }).join('');

  // Collect Share button handlers
  container.querySelectorAll('.btn-collect-share[data-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.currentTarget.getAttribute('data-id'), 10);
      startPayerPayment(id);
    });
  });

  // Direct Voucher Apply Button handler (NO PAYMENT PAGE!)
  container.querySelectorAll('.btn-collect-share[data-voucher-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.currentTarget.getAttribute('data-voucher-id'), 10);
      applyVoucherDirectly(id);
    });
  });

  // Edit Amount handlers (for By-Amount & Mixed modes)
  container.querySelectorAll('.p-amt-clickable').forEach(el => {
    el.addEventListener('click', (e) => {
      const id = parseInt(e.currentTarget.getAttribute('data-edit-id'), 10);
      openAmountEditModal(id);
    });
  });

  // Delete Payer handler
  container.querySelectorAll('.btn-delete-payer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.currentTarget.getAttribute('data-del-id'), 10);
      deletePayer(id);
    });
  });

  // Check if all existing are settled but bill still has remaining balance
  checkUnpaidGapAlert();
}

function checkUnpaidGapAlert() {
  const alertBox = document.getElementById('unpaid-gap-alert');
  const alertAmt = document.getElementById('unpaid-gap-amount');

  const totalPaid = state.payers.filter(p => p.settled).reduce((acc, p) => acc + p.share, 0);
  const remaining = Number((state.totalBill - totalPaid).toFixed(2));
  const allCurrentSettled = state.payers.length > 0 && state.payers.every(p => p.settled);

  if (allCurrentSettled && remaining > 0.01) {
    alertAmt.textContent = `AED ${remaining.toFixed(2)}`;
    alertBox.classList.remove('hidden');
  } else {
    alertBox.classList.add('hidden');
  }
}

function deletePayer(payerId) {
  state.payers = state.payers.filter(p => p.id !== payerId);
  // Re-index remaining
  state.payers.forEach((p, idx) => {
    p.id = idx;
    if (state.currentMode === 'amount') p.name = `Payer ${idx + 1}`;
  });
  renderPayersList();
  updateBalanceDisplay();
  renderModeOptions();
  showToast('Removed payer');
}

// Direct Instant Voucher Redemption (NO PAYMENT SCREEN)
function applyVoucherDirectly(payerId) {
  const payer = state.payers.find(p => p.id === payerId);
  if (!payer || payer.settled) return;

  if (payer.share <= 0) {
    showToast('Please enter a voucher amount first');
    return;
  }

  playApprovalChime();

  const authCode = `VOUCH-RED-${Math.floor(1000 + Math.random() * 9000)}`;
  payer.settled = true;
  payer.tip = 0;
  payer.totalPaid = payer.share;
  payer.authCode = authCode;
  payer.methodType = 'voucher';
  payer.methodTitle = 'Gift Voucher (Directly Applied)';

  const baseExVat = payer.share / (1 + state.vatRate);
  const vatContribution = payer.share - baseExVat;

  const child = {
    childId: `CH-0${payer.id + 1}`,
    parentOrderId: state.parentOrderId,
    payerName: payer.name,
    method: payer.methodTitle,
    baseAmount: Number(baseExVat.toFixed(2)),
    vatShare: Number(vatContribution.toFixed(2)),
    tipAmount: 0,
    totalPaid: Number(payer.share.toFixed(2)),
    approvalCode: authCode,
    status: 'SETTLED'
  };

  state.childTransactions.push(child);

  // Trigger physical thermal receipt ejection
  triggerReceiptPaperEjection('VOUCHER REDEEMED', `AED ${payer.share.toFixed(2)}`);

  renderPayersList();
  updateBalanceDisplay();
  renderModeOptions();

  showToast(`✓ Voucher of AED ${payer.share.toFixed(2)} applied directly to order!`);

  // Check if order is fully closed
  checkOrderCompletion();
}

function updateBalanceDisplay() {
  const total = state.totalBill;
  const paid = state.payers.filter(p => p.settled).reduce((acc, p) => acc + p.share, 0);
  const remaining = Math.max(0, Number((total - paid).toFixed(2)));

  document.getElementById('disp-total-amount').textContent = `AED ${total.toFixed(2)}`;
  document.getElementById('disp-paid-sum').textContent = `AED ${paid.toFixed(2)}`;
  
  const remainEl = document.getElementById('disp-remain-sum');
  remainEl.textContent = `AED ${remaining.toFixed(2)}`;

  if (remaining <= 0.01 && paid > 0) {
    remainEl.classList.remove('text-alert');
    remainEl.classList.add('text-green');
  } else {
    remainEl.classList.add('text-alert');
    remainEl.classList.remove('text-green');
  }

  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  document.getElementById('live-progress-bar').style.width = `${pct}%`;
}

function resetSettledState() {
  state.payers.forEach(p => {
    p.settled = false;
    p.tip = 0;
    p.totalPaid = 0;
    p.authCode = null;
  });
  state.childTransactions = [];
  renderPayersList();
  updateBalanceDisplay();
}

// ==========================================================================
// EDIT INDIVIDUAL AMOUNT MODAL (For By-Amount & Mixed Unequal Splits)
// ==========================================================================
function initAmountEditModal() {
  const modal = document.getElementById('amount-edit-modal');
  const input = document.getElementById('modal-amount-input');
  const closeBtn = document.getElementById('btn-close-amount-modal');
  const saveBtn = document.getElementById('btn-save-payer-amount');
  const autoFillBtn = document.getElementById('btn-modal-autofill');

  closeBtn.addEventListener('click', () => {
    modal.classList.remove('active');
  });

  autoFillBtn.addEventListener('click', () => {
    const payer = state.payers.find(p => p.id === state.editingPayerId);
    if (!payer) return;
    
    // Sum other payers
    const otherSum = state.payers.filter(p => p.id !== payer.id).reduce((acc, p) => acc + p.share, 0);
    const remaining = Math.max(0, Number((state.totalBill - otherSum).toFixed(2)));
    input.value = remaining.toFixed(2);
  });

  saveBtn.addEventListener('click', () => {
    const payer = state.payers.find(p => p.id === state.editingPayerId);
    if (!payer) return;
    
    const newVal = parseFloat(input.value);
    if (isNaN(newVal) || newVal < 0) {
      showToast('Please enter a valid amount');
      return;
    }

    payer.share = Number(newVal.toFixed(2));
    modal.classList.remove('active');
    renderPayersList();
    updateBalanceDisplay();
    renderModeOptions();
    showToast(`✓ Updated ${payer.name} share to AED ${payer.share.toFixed(2)}`);
  });
}

function openAmountEditModal(payerId) {
  const payer = state.payers.find(p => p.id === payerId);
  if (!payer || payer.settled) return;

  state.editingPayerId = payerId;
  const modal = document.getElementById('amount-edit-modal');
  const title = document.getElementById('edit-modal-title');
  const input = document.getElementById('modal-amount-input');
  const hint = document.getElementById('modal-balance-hint');

  title.textContent = `Edit Amount for ${payer.name}`;
  input.value = payer.share.toFixed(2);

  const otherSum = state.payers.filter(p => p.id !== payer.id).reduce((acc, p) => acc + p.share, 0);
  const remaining = Math.max(0, Number((state.totalBill - otherSum).toFixed(2)));
  hint.textContent = `Unallocated bill balance: AED ${remaining.toFixed(2)}`;

  modal.classList.add('active');
  input.focus();
}

// ==========================================================================
// SCREEN 3: PAYMENT STEP (Tip Prompt & Card vs Direct Cash Entry)
// ==========================================================================
function startPayerPayment(payerId) {
  const payer = state.payers.find(p => p.id === payerId);
  if (!payer) return;

  state.activePayer = payer;
  state.selectedTipPct = 0; // Default no tip
  state.selectedMethod = payer.defaultMethod || 'card';

  document.getElementById('payment-payer-title').textContent = payer.name;
  document.getElementById('pay-base-due').textContent = `AED ${payer.share.toFixed(2)}`;

  // Reset tip pills to 0%
  document.querySelectorAll('.tip-pill').forEach(p => p.classList.remove('active'));
  document.querySelector('.tip-pill[data-pct="0"]').classList.add('active');

  updateTipAmounts(payer.share);
  setTenderMethod(state.selectedMethod);

  switchScreen('view-payment-step');
}

function initPaymentStep() {
  // Back button
  document.getElementById('btn-back-to-split').addEventListener('click', () => {
    if (state.isFullBillPay) {
      switchScreen('view-enter-bill');
    } else {
      switchScreen('view-split-flow');
    }
  });

  // Tip selection
  document.querySelectorAll('.tip-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.tip-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.selectedTipPct = parseInt(pill.getAttribute('data-pct'), 10);
      updateTipAmounts(state.activePayer.share);
    });
  });

  // Method Toggle (Card vs Cash)
  document.querySelectorAll('.tender-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const method = btn.getAttribute('data-method');
      setTenderMethod(method);
    });
  });

  // Card Tap Button
  document.getElementById('btn-action-tap-card').addEventListener('click', approveCardPayment);

  // Cash Received Input event listener
  const cashInput = document.getElementById('cash-entered-input');
  cashInput.addEventListener('input', () => {
    const val = parseFloat(cashInput.value) || 0;
    updateCashChange(val);
  });

  // Cash Helper Buttons (Exact, +10, +50, +100)
  document.getElementById('btn-helper-exact').addEventListener('click', () => {
    const totalDue = getTotalDueAmount();
    cashInput.value = totalDue.toFixed(2);
    updateCashChange(totalDue);
  });

  document.querySelectorAll('.btn-helper[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const addVal = parseFloat(btn.getAttribute('data-add')) || 0;
      const current = parseFloat(cashInput.value) || getTotalDueAmount();
      const updated = current + addVal;
      cashInput.value = updated.toFixed(2);
      updateCashChange(updated);
    });
  });

  // Cash Received Button
  document.getElementById('btn-cash-received').addEventListener('click', () => {
    const totalDue = getTotalDueAmount();
    const entered = parseFloat(cashInput.value) || 0;

    if (entered < totalDue) {
      showToast(`Please enter at least AED ${totalDue.toFixed(2)}`);
      return;
    }
    approveCashPayment(entered);
  });

  // Approval screen Continue button
  document.getElementById('btn-appr-continue').addEventListener('click', () => {
    checkOrderCompletion();
  });
}

function checkOrderCompletion() {
  const totalPaid = state.payers.filter(p => p.settled).reduce((acc, p) => acc + p.share, 0);
  const remaining = Number((state.totalBill - totalPaid).toFixed(2));
  const nextUnsettled = state.payers.find(p => !p.settled);

  if (nextUnsettled) {
    // There are still unsettled payers in queue
    switchScreen('view-split-flow');
    renderPayersList();
    updateBalanceDisplay();
    renderModeOptions();
  } else if (remaining > 0.01) {
    // All current payers paid, but remaining balance is still > 0!
    // MUST NOT close the order!
    switchScreen('view-split-flow');
    renderPayersList();
    updateBalanceDisplay();
    renderModeOptions();
    showToast(`⚠️ Order not complete: AED ${remaining.toFixed(2)} unpaid`);
  } else {
    // Truly complete and fully paid!
    renderOrderClosedScreen();
    switchScreen('view-order-closed');
  }
}

function getTotalDueAmount() {
  const payer = state.activePayer;
  if (!payer) return 0;
  const tip = payer.share * (state.selectedTipPct / 100);
  return payer.share + tip;
}

function setTenderMethod(method) {
  state.selectedMethod = method;
  document.querySelectorAll('.tender-card-btn').forEach(b => {
    if (b.getAttribute('data-method') === method) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });

  const cardSub = document.getElementById('subscreen-card');
  const cashSub = document.getElementById('subscreen-cash');

  if (method === 'cash') {
    cardSub.classList.add('hidden');
    cashSub.classList.remove('hidden');
    // Pre-fill cash input with exact amount due
    const totalDue = getTotalDueAmount();
    const cashInput = document.getElementById('cash-entered-input');
    cashInput.value = totalDue.toFixed(2);
    updateCashChange(totalDue);
  } else {
    cardSub.classList.remove('hidden');
    cashSub.classList.add('hidden');
  }
}

function updateTipAmounts(base) {
  const tip10 = base * 0.10;
  const tip15 = base * 0.15;
  const tip20 = base * 0.20;

  document.getElementById('tip-val-10').textContent = `+AED ${tip10.toFixed(2)}`;
  document.getElementById('tip-val-15').textContent = `+AED ${tip15.toFixed(2)}`;
  document.getElementById('tip-val-20').textContent = `+AED ${tip20.toFixed(2)}`;

  let tipVal = 0;
  if (state.selectedTipPct === 10) tipVal = tip10;
  if (state.selectedTipPct === 15) tipVal = tip15;
  if (state.selectedTipPct === 20) tipVal = tip20;

  const total = base + tipVal;
  document.getElementById('pay-total-charge').textContent = `AED ${total.toFixed(2)}`;
  document.getElementById('cash-exact-due').textContent = `AED ${total.toFixed(2)}`;
  
  const cashInput = document.getElementById('cash-entered-input');
  if (cashInput && document.getElementById('subscreen-cash').classList.contains('hidden') === false) {
    cashInput.value = total.toFixed(2);
    updateCashChange(total);
  }
}

function updateCashChange(enteredVal) {
  const due = getTotalDueAmount();
  const changeEl = document.getElementById('cash-change-val');
  const labelEl = document.getElementById('cash-status-label');

  if (enteredVal < due) {
    const diff = due - enteredVal;
    labelEl.textContent = 'Still Needed:';
    changeEl.textContent = `AED ${diff.toFixed(2)}`;
    changeEl.style.color = '#d83b01';
  } else {
    const change = enteredVal - due;
    labelEl.textContent = 'Change Due:';
    changeEl.textContent = `AED ${change.toFixed(2)}`;
    changeEl.style.color = '#107c41';
  }
}

// Approve Card Payment
function approveCardPayment() {
  const btn = document.getElementById('btn-action-tap-card');
  btn.disabled = true;
  btn.innerHTML = '<span>⏳</span> Authorizing via ADIB...';

  setTimeout(() => {
    btn.disabled = false;
    btn.innerHTML = '<span>📲</span> Tap / Insert Card to Settle';

    playApprovalChime();

    const payer = state.activePayer;
    const tip = payer.share * (state.selectedTipPct / 100);
    const total = payer.share + tip;
    const authCode = `AUTH-${Math.floor(100000 + Math.random() * 900000)}`;

    finalizePayerApproval(payer, 'card', `Visa (**** ${payer.cardLast4 || '4291'})`, tip, total, authCode, 0);
  }, 650);
}

// Approve Cash Payment (With entered cash and change)
function approveCashPayment(enteredAmount) {
  playCashChime();

  const payer = state.activePayer;
  const tip = payer.share * (state.selectedTipPct / 100);
  const total = payer.share + tip;
  const change = Math.max(0, enteredAmount - total);
  const authCode = `CASH-REC-${Math.floor(1000 + Math.random() * 9000)}`;

  finalizePayerApproval(payer, 'cash', `Cash (Received AED ${enteredAmount.toFixed(2)})`, tip, total, authCode, change);
}

function finalizePayerApproval(payer, methodType, methodTitle, tip, total, authCode, change) {
  payer.settled = true;
  payer.tip = tip;
  payer.totalPaid = total;
  payer.authCode = authCode;
  payer.methodType = methodType;
  payer.methodTitle = methodTitle;

  const baseExVat = payer.share / (1 + state.vatRate);
  const vatContribution = payer.share - baseExVat;

  const child = {
    childId: `CH-0${payer.id + 1}`,
    parentOrderId: state.parentOrderId,
    payerName: payer.name,
    method: methodTitle,
    baseAmount: Number(baseExVat.toFixed(2)),
    vatShare: Number(vatContribution.toFixed(2)),
    tipAmount: Number(tip.toFixed(2)),
    totalPaid: Number(total.toFixed(2)),
    approvalCode: authCode,
    status: 'SETTLED'
  };

  state.childTransactions.push(child);

  // Trigger physical thermal paper slip ejection
  triggerReceiptPaperEjection(payer.name, `AED ${total.toFixed(2)}`);

  // Update Screen 4 Approval UI
  document.getElementById('appr-auth-code').textContent = authCode;
  document.getElementById('appr-payer-lbl').textContent = payer.name;
  document.getElementById('appr-method-lbl').textContent = methodTitle;
  document.getElementById('appr-total-lbl').textContent = `AED ${total.toFixed(2)}`;

  const changeRow = document.getElementById('appr-change-row');
  if (change > 0) {
    changeRow.style.display = 'flex';
    document.getElementById('appr-change-lbl').textContent = `AED ${change.toFixed(2)}`;
  } else {
    changeRow.style.display = 'none';
  }

  const totalPaid = state.payers.filter(p => p.settled).reduce((acc, p) => acc + p.share, 0);
  const remaining = Math.max(0, Number((state.totalBill - totalPaid).toFixed(2)));
  document.getElementById('appr-balance-lbl').textContent = `AED ${remaining.toFixed(2)}`;

  switchScreen('view-approved-screen');
}

// ==========================================================================
// SCREEN 5: ORDER CLOSED & AUDITED
// ==========================================================================
function renderOrderClosedScreen() {
  document.getElementById('cl-parent-id').textContent = state.parentOrderId;
  const list = document.getElementById('cl-children-list');

  list.innerHTML = state.childTransactions.map(c => `
    <div class="cl-child-item">
      <span>${c.payerName}</span>
      <span style="font-size:0.65rem; color:#666;">${c.method.split('(')[0]}</span>
      <strong style="color:#055ca6;">AED ${c.totalPaid.toFixed(2)}</strong>
    </div>
  `).join('');
}

function initOrderClosedActions() {
  // Refund button
  document.getElementById('btn-demo-refund').addEventListener('click', () => {
    const cardChild = state.childTransactions.find(c => c.method.includes('Visa') || c.method.includes('Card'));
    if (!cardChild) {
      showToast('No card transaction found to refund');
      return;
    }

    playApprovalChime();
    cardChild.status = 'REFUNDED';
    showToast(`✓ Refunded AED ${cardChild.totalPaid.toFixed(2)} to ${cardChild.method}. Credit note issued!`);
    renderOrderClosedScreen();
  });

  // Print master slip
  document.getElementById('btn-print-master').addEventListener('click', () => {
    triggerReceiptPaperEjection('MASTER SLIP', `AED ${state.totalBill.toFixed(2)}`);
    showToast('Printing master reconciliation slip...');
  });

  // Start New Bill
  document.getElementById('btn-new-bill').addEventListener('click', () => {
    state.enteredAmountStr = '0';
    updateKeypadDisplay();
    switchScreen('view-enter-bill');
  });
}

// Sequential Auto Settle (for presentation demo)
function runAutoSettle() {
  resetSettledState();
  showToast('⚡ Running auto payment demo...');

  let i = 0;
  function next() {
    if (i >= state.payers.length) {
      setTimeout(() => {
        checkOrderCompletion();
      }, 500);
      return;
    }

    const p = state.payers[i];
    if (p.isVoucher) {
      applyVoucherDirectly(p.id);
      i++;
      setTimeout(next, 600);
    } else {
      startPayerPayment(p.id);
      setTimeout(() => {
        if (state.activePayer.defaultMethod === 'cash') {
          approveCashPayment(state.activePayer.share);
        } else {
          approveCardPayment();
        }
        setTimeout(() => {
          i++;
          next();
        }, 700);
      }, 600);
    }
  }

  next();
}

function showToast(msg) {
  const toast = document.getElementById('pos-toast');
  const text = document.getElementById('toast-text');
  text.textContent = msg;
  toast.classList.add('active');
  setTimeout(() => {
    toast.classList.remove('active');
  }, 3000);
}
