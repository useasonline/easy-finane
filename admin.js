/* ==========================================================================
   E FINANCE (EASY FINANCE) - DEDICATED ADMIN PORTAL JS (admin.js)
   ========================================================================== */

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyAsCDXYRerEZn_5--6f8ta1BAD-hIv1PiI",
  authDomain: "qhp2026-d510b.firebaseapp.com",
  databaseURL: "https://qhp2026-d510b-default-rtdb.firebaseio.com",
  projectId: "qhp2026-d510b",
  storageBucket: "qhp2026-d510b.firebasestorage.app",
  messagingSenderId: "127037647697",
  appId: "1:127037647697:web:aac47af8ec8a04616b4170",
  measurementId: "G-BJPKMHE7JC"
};

// Initialize Firebase App & Database
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth ? firebase.auth() : null;

let isAdminAuthenticated = false;
let withdrawalsUnsub = null;
let usersUnsub = null;
let deletedUsersUnsub = null;
let pendingDeleteUsername = null;
let currentLedgerUsername = null;
let currentArchivedLedgerUsername = null;

function getLocalStore(key) {
  try { return JSON.parse(localStorage.getItem('efinance_db_' + key) || '{}'); } catch(e) { return {}; }
}
function setLocalStore(key, data) {
  try { localStorage.setItem('efinance_db_' + key, JSON.stringify(data)); } catch(e) {}
}

async function ensureFirebaseAuth() {
  if (auth && !auth.currentUser) {
    try {
      await auth.signInAnonymously();
    } catch (err) {
      console.warn("Admin anon auth note:", err.message);
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await ensureFirebaseAuth();

  const adminSession = localStorage.getItem('efinance_admin_session');
  if (adminSession === 'active') {
    isAdminAuthenticated = true;
    showAdminDashboard();
  }
});

function togglePasswordVisibility(inputId, iconElement) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    iconElement.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    input.type = 'password';
    iconElement.classList.replace('fa-eye-slash', 'fa-eye');
  }
}

function handleAdminLogin(event) {
  event.preventDefault();
  const passcode = document.getElementById('admin-passcode').value.trim();
  const errorDiv = document.getElementById('admin-login-error');

  errorDiv.classList.add('hidden');

  if (passcode === 'admin123' || passcode === 'admin') {
    isAdminAuthenticated = true;
    localStorage.setItem('efinance_admin_session', 'active');
    showToast('Admin logged in successfully!', 'success');
    showAdminDashboard();
  } else {
    errorDiv.textContent = 'Invalid Admin Passcode. Default passcode is: admin123';
    errorDiv.classList.remove('hidden');
  }
}

function handleAdminLogout() {
  isAdminAuthenticated = false;
  localStorage.removeItem('efinance_admin_session');
  if (withdrawalsUnsub) try { db.ref('withdrawals').off('value', withdrawalsUnsub); } catch(e){}
  if (usersUnsub) try { db.ref('users').off('value', usersUnsub); } catch(e){}
  if (debitsUnsub) try { db.ref('debits').off('value', debitsUnsub); } catch(e){}
  if (deletedUsersUnsub) try { db.ref('deleted_users').off('value', deletedUsersUnsub); } catch(e){}

  document.getElementById('admin-login-section').classList.add('active');
  document.getElementById('admin-dashboard-section').classList.remove('active');
  showToast('Admin logged out.', 'info');
}

async function showAdminDashboard() {
  await ensureFirebaseAuth();
  document.getElementById('admin-login-section').classList.remove('active');
  document.getElementById('admin-dashboard-section').classList.add('active');
  loadAdminData();
}

// ==========================================================================
// DATE MILESTONE HELPERS & AUTO PAYOUT ENGINE
// ==========================================================================
// Month 1 starts 1 month after deposit date (e.g. Deposit 5 Sep -> Month 1 on 5 Oct)
function parseDepositDateObj(dateStr) {
  if (!dateStr) return new Date();
  if (typeof dateStr === 'string' && dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) return new Date(y, m, d);
    }
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}

function getMilestoneDateObj(depositDateStr, monthNum) {
  const base = parseDepositDateObj(depositDateStr);
  return new Date(base.getFullYear(), base.getMonth() + monthNum, base.getDate());
}

function formatMilestoneDateStr(depositDateStr, monthNum) {
  const d = getMilestoneDateObj(depositDateStr, monthNum);
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function autoProcessScheduledPayouts() {
  const localDebits = getLocalStore('debits') || {};
  const localUsers = getLocalStore('users') || {};
  let stateChanged = false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (let dKey in localDebits) {
    const debit = localDebits[dKey];
    if (debit.status === 'Approved') {
      const username = debit.username;
      const depositDate = debit.date || new Date().toISOString().split('T')[0];
      const monthlyBonus = debit.monthlyBonus || parseFloat(((debit.amount || 10) * 0.2).toFixed(2));
      let currCount = parseInt(debit.creditedMonthCount || 0);

      for (let m = currCount + 1; m <= 12; m++) {
        const mDate = getMilestoneDateObj(depositDate, m);
        const compareDate = new Date(mDate.getFullYear(), mDate.getMonth(), mDate.getDate());

        if (now >= compareDate) {
          // Scheduled milestone date reached! Auto-credit profit return to user's wallet
          currCount = m;
          debit.creditedMonthCount = m;

          if (localUsers[username]) {
            const currAvail = parseFloat(localUsers[username].availableBalance || 0);
            localUsers[username].availableBalance = parseFloat((currAvail + monthlyBonus).toFixed(2));
          }

          stateChanged = true;

          try {
            if (window.db) {
              db.ref(`debits/${dKey}`).update({ creditedMonthCount: m });
              if (localUsers[username]) {
                db.ref(`users/${username}`).update({ availableBalance: localUsers[username].availableBalance });
              }
            }
          } catch (e) {}
        } else {
          break; // Future milestone dates have not arrived yet
        }
      }
    }
  }

  if (stateChanged) {
    setLocalStore('debits', localDebits);
    setLocalStore('users', localUsers);
  }
}

function runAdminAutoPayoutCheck() {
  autoProcessScheduledPayouts();
  loadAdminData();
  showToast('✓ Auto-payout engine checked! All due milestone dates credited to user wallets.', 'success');
}

let debitsUnsub = null;

function loadAdminData() {
  // Always run auto-payout milestone check on admin data load
  autoProcessScheduledPayouts();

  // Render Pending Deposit & Scheme Debits Table
  const renderDebitsTable = (debitsMap) => {
    const tbody = document.getElementById('admin-debits-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let pendingCount = 0;
    const list = [];

    for (let k in debitsMap) {
      list.push({ id: k, ...debitsMap[k] });
      if (debitsMap[k].status === 'Pending') pendingCount++;
    }

    const statPendingDebits = document.getElementById('stat-pending-debits');
    if (statPendingDebits) statPendingDebits.textContent = pendingCount;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4">No deposit requests submitted yet.</td></tr>`;
    } else {
      list.reverse().forEach(req => {
        const tr = document.createElement('tr');
        const inrDisp = req.inrAmount ? req.inrAmount.toLocaleString('en-IN') : (req.amount * 100);
        const usdDisp = parseFloat(req.amount).toLocaleString('en-US', { minimumFractionDigits: 2 });
        const statusStr = req.status || 'Pending';

        let proofHtml = 'N/A';
        if (req.proofUrl) {
          if (req.proofUrl === 'ADMIN_MANUAL_ENTRY') {
            proofHtml = `<span class="badge-neutral" style="font-size: 0.75rem;"><i class="fa-solid fa-user-shield"></i> Admin Direct</span>`;
          } else {
            proofHtml = `
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <img src="${req.proofUrl}" alt="Proof" style="width: 48px; height: 48px; object-fit: cover; border-radius: 8px; border: 1.5px solid #0284c7; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" onclick="openAdminProofModal('${req.utr || 'N/A'}', '${req.proofUrl}')" title="Click to view full screenshot">
                <button type="button" class="btn-secondary-sm" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;" onclick="openAdminProofModal('${req.utr || 'N/A'}', '${req.proofUrl}')">
                  <i class="fa-solid fa-eye"></i> View
                </button>
              </div>`;
          }
        }

        let actionHtml = '';
        if (statusStr === 'Pending') {
          actionHtml = `
            <button class="btn-emerald" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;" onclick="adminApproveDebit('${req.id}')">
              <i class="fa-solid fa-check"></i> Accept Payment
            </button>
            <button class="btn-danger-sm" onclick="adminRejectDebit('${req.id}')">Reject</button>
          `;
        } else if (statusStr === 'Approved') {
          actionHtml = `<span class="text-green" style="font-weight: 700;"><i class="fa-solid fa-circle-check"></i> Accepted (In Vault)</span>`;
        } else {
          actionHtml = `<span class="text-danger" style="font-weight: 700;"><i class="fa-solid fa-circle-xmark"></i> Failed (Rejected)</span>`;
        }

        tr.innerHTML = `
          <td><code>#${req.id.substring(0, 12)}</code></td>
          <td><strong>${req.fullName || req.username}</strong><br><small class="text-muted">@${req.username}</small></td>
          <td><strong>${req.date}</strong></td>
          <td><strong class="text-blue">₹${inrDisp} ($${usdDisp} USD)</strong></td>
          <td><code style="background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">${req.utr || 'N/A'}</code></td>
          <td>${proofHtml}</td>
          <td><span class="status-badge ${statusStr.toLowerCase()}">${statusStr}</span></td>
          <td>${actionHtml}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  };

  renderDebitsTable(getLocalStore('debits'));

  try {
    debitsUnsub = db.ref('debits').on('value', (snapshot) => {
      if (snapshot.exists()) {
        const val = snapshot.val();
        setLocalStore('debits', val);
        renderDebitsTable(val);
      }
    });
  } catch(e) {}

  // Render withdrawals function
  const renderWithdrawalsTable = (dataMap) => {
    const tbody = document.getElementById('admin-withdrawals-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let pendingCount = 0;
    const list = [];

    for (let k in dataMap) {
      list.push(dataMap[k]);
      if (dataMap[k].status === 'Pending') pendingCount++;
    }

    const statPendingW = document.getElementById('stat-pending-withdrawals');
    if (statPendingW) statPendingW.textContent = pendingCount;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4">No withdrawal requests found.</td></tr>`;
    } else {
      list.reverse().forEach(req => {
        const tr = document.createElement('tr');
        let detailsDisplay = req.method === 'UPI' 
          ? `<strong>UPI ID:</strong> ${req.details?.upiId || 'N/A'}`
          : `<strong>Acc:</strong> ${req.details?.accountNumber}<br><small class="text-muted">IFSC: ${req.details?.ifsc} | Holder: ${req.details?.holder}</small>`;

        let actionHtml = '';
        if (req.status === 'Pending') {
          actionHtml = `
            <button class="btn-emerald" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;" onclick="adminApproveWithdrawal('${req.id}')">
              <i class="fa-solid fa-check"></i> Approve (Success)
            </button>
            <button class="btn-danger-sm" onclick="adminRejectWithdrawal('${req.id}')">Reject</button>
          `;
        } else {
          actionHtml = `<small class="text-dim">Completed (${req.status})</small>`;
        }

        tr.innerHTML = `
          <td><code>#${req.id.substring(0, 8)}</code></td>
          <td><strong>${req.fullName || req.username}</strong><br><small class="text-muted">@${req.username}</small></td>
          <td>${req.date}</td>
          <td><strong class="text-green">$${parseFloat(req.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
          <td><span class="badge-neutral">${req.method}</span></td>
          <td>${detailsDisplay}</td>
          <td><span class="status-badge ${req.status.toLowerCase()}">${req.status}</span></td>
          <td>${actionHtml}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  };

  renderWithdrawalsTable(getLocalStore('withdrawals'));

  try {
    withdrawalsUnsub = db.ref('withdrawals').on('value', (snapshot) => {
      if (snapshot.exists()) {
        const val = snapshot.val();
        setLocalStore('withdrawals', val);
        renderWithdrawalsTable(val);
      }
    });
  } catch(e) {}

  // Render full users table with total deposits, exact dates money added, vault & wallet totals
  const renderUsersTable = (usersObj) => {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let totalUsers = 0;
    let totalSystemDebits = 0;

    const localDebits = getLocalStore('debits');

    for (let uKey in usersObj) {
      totalUsers++;
      const u = usersObj[uKey];
      const locked = parseFloat(u.lockedDebitBalance || 0);
      const available = parseFloat(u.availableBalance || 0);
      const totalWalletMoney = locked + available;
      totalSystemDebits += locked;

      // Find all deposits for this user
      const userDebits = [];
      for (let dK in localDebits) {
        if (localDebits[dK].username === u.username) {
          userDebits.push({ id: dK, ...localDebits[dK] });
        }
      }
      userDebits.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      // Build HTML list of deposit dates and amounts
      let depositDatesHtml = '';
      if (userDebits.length === 0) {
        depositDatesHtml = `<span class="text-muted" style="font-size: 0.8rem;">No Deposits Yet</span>`;
      } else {
        depositDatesHtml = userDebits.map((d, idx) => {
          const dAmt = parseFloat(d.amount || 10);
          const dInr = d.inrAmount ? d.inrAmount.toLocaleString('en-IN') : (dAmt * 100);
          const statusColor = d.status === 'Approved' ? '#0284c7' : (d.status === 'Pending' ? '#d97706' : '#ef4444');
          return `
            <div style="display: inline-block; background: #f8fafc; border: 1px solid #cbd5e1; border-left: 3.5px solid ${statusColor}; padding: 0.2rem 0.45rem; border-radius: 4px; font-size: 0.76rem; margin: 0.15rem 0.15rem 0.15rem 0;">
              <i class="fa-solid fa-calendar-day" style="color: #64748b;"></i> <strong>${d.date || 'N/A'}</strong>: ₹${dInr} ($${dAmt})
            </div>`;
        }).join('');
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong style="color: #0284c7; font-size: 0.95rem;">@${u.username}</strong><br>
          <small class="text-muted"><i class="fa-solid fa-id-badge"></i> ${u.fullName || 'N/A'}</small>
        </td>
        <td><small><i class="fa-solid fa-phone"></i> ${u.contactNumber || 'N/A'}</small></td>
        <td><span class="fund-badge-pill" style="font-size: 0.82rem;"><i class="fa-solid fa-receipt"></i> <strong>${userDebits.length}</strong> Deposits</span></td>
        <td style="max-width: 260px;">${depositDatesHtml}</td>
        <td><strong class="text-blue">$${locked.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
        <td><strong class="text-green">$${available.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
        <td><strong style="color: #059669; font-size: 1.05rem; background: #ecfdf5; padding: 0.25rem 0.65rem; border-radius: 6px; border: 1px solid #a7f3d0;">$${totalWalletMoney.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD</strong></td>
        <td>
          <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
            <button class="btn-primary" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="openAdminUserLedger('${u.username}')">
              <i class="fa-solid fa-folder-open"></i> Ledger
            </button>
            <button class="btn-secondary-sm" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="openAdminAddDepositModal('${u.username}')">
              <i class="fa-solid fa-plus-circle"></i> Add Deposit
            </button>
            <button class="btn-emerald" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="downloadSingleUserCSV('${u.username}')" title="Download CSV ledger for @${u.username}">
              <i class="fa-solid fa-file-excel"></i> CSV
            </button>
            <button class="btn-danger-sm" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="promptDeleteUser('${u.username}')" title="Permanently delete user account">
              <i class="fa-solid fa-trash-can"></i> Delete
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }

    if (totalUsers === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4">No user accounts created yet.</td></tr>`;
    }
    const statUsers = document.getElementById('stat-total-users');
    if (statUsers) statUsers.textContent = totalUsers;

    const statDebits = document.getElementById('stat-total-debits');
    if (statDebits) statDebits.textContent = totalSystemDebits.toLocaleString('en-US', { minimumFractionDigits: 2 });
  };

  renderUsersTable(getLocalStore('users'));

  try {
    usersUnsub = db.ref('users').on('value', (snapshot) => {
      if (snapshot.exists()) {
        const val = snapshot.val();
        setLocalStore('users', val);
        renderUsersTable(val);
      }
    });
  } catch(e) {}

  // Render previous deleted users table
  renderDeletedUsersTable(getLocalStore('deleted_users'));

  try {
    deletedUsersUnsub = db.ref('deleted_users').on('value', (snapshot) => {
      const val = snapshot.exists() ? snapshot.val() : {};
      setLocalStore('deleted_users', val);
      renderDeletedUsersTable(val);
    });
  } catch(e) {}
}

// ADMIN DEPOSIT APPROVAL & REJECTION ACTIONS
async function adminApproveDebit(debitId) {
  const localDebits = getLocalStore('debits');
  const localUsers = getLocalStore('users');

  if (localDebits[debitId]) {
    localDebits[debitId].status = 'Approved';
    setLocalStore('debits', localDebits);

    const username = localDebits[debitId].username;
    const usdAmount = parseFloat(localDebits[debitId].amount || 0);

    if (localUsers[username]) {
      const currentLocked = parseFloat(localUsers[username].lockedDebitBalance || 0);
      localUsers[username].lockedDebitBalance = currentLocked + usdAmount;
      setLocalStore('users', localUsers);
    }
  }

  try {
    const debSnap = await db.ref(`debits/${debitId}`).once('value');
    if (debSnap.exists()) {
      const debData = debSnap.val();
      await db.ref(`debits/${debitId}`).update({ status: 'Approved' });
      
      const userSnap = await db.ref(`users/${debData.username}`).once('value');
      if (userSnap.exists()) {
        const currLocked = parseFloat(userSnap.val().lockedDebitBalance || 0);
        await db.ref(`users/${debData.username}`).update({
          lockedDebitBalance: currLocked + parseFloat(debData.amount || 0)
        });
      }
    }
  } catch (err) {
    console.warn("Firebase RTDB approve debit sync note:", err.message);
  }

  showToast(`Deposit #${debitId} APPROVED! Funds added to User Vault.`, 'success');
  loadAdminData();
}

async function adminRejectDebit(debitId) {
  const localDebits = getLocalStore('debits');

  if (localDebits[debitId]) {
    localDebits[debitId].status = 'Rejected';
    setLocalStore('debits', localDebits);
  }

  try {
    await db.ref(`debits/${debitId}`).update({ status: 'Rejected' });
  } catch (err) {
    console.warn("Firebase RTDB reject debit sync note:", err.message);
  }

  showToast(`Deposit #${debitId} REJECTED. User history marked as Failed.`, 'info');
  loadAdminData();
}

function openAdminProofModal(utr, proofUrl) {
  const modal = document.getElementById('modal-proof-viewer');
  const utrEl = document.getElementById('proof-utr-val');
  const imgEl = document.getElementById('full-proof-img');
  if (utrEl) utrEl.textContent = utr || 'N/A';
  if (imgEl) imgEl.src = proofUrl || '';
  if (modal) modal.classList.remove('hidden');
}

function closeAdminProofModal() {
  const modal = document.getElementById('modal-proof-viewer');
  if (modal) modal.classList.add('hidden');
}

// ADMIN ACTIONS
async function adminApproveWithdrawal(reqId) {
  // Local sync
  const localW = getLocalStore('withdrawals');
  if (localW[reqId]) {
    localW[reqId].status = 'Success';
    setLocalStore('withdrawals', localW);
  }

  try {
    await db.ref(`withdrawals/${reqId}`).update({ status: 'Success' });
  } catch (err) {
    console.warn("Firebase RTDB approve sync note:", err.message);
  }

  showToast(`Withdrawal #${reqId} changed to SUCCESS!`, 'success');
  loadAdminData();
}

async function adminRejectWithdrawal(reqId) {
  const localW = getLocalStore('withdrawals');
  const localUsers = getLocalStore('users');

  if (localW[reqId]) {
    localW[reqId].status = 'Rejected';
    setLocalStore('withdrawals', localW);

    const username = localW[reqId].username;
    const refundAmt = parseFloat(localW[reqId].amount || 0);

    if (localUsers[username]) {
      const curr = parseFloat(localUsers[username].availableBalance || 0);
      localUsers[username].availableBalance = curr + refundAmt;
      setLocalStore('users', localUsers);
    }
  }

  try {
    const reqSnap = await db.ref(`withdrawals/${reqId}`).once('value');
    if (reqSnap.exists()) {
      const reqData = reqSnap.val();
      await db.ref(`withdrawals/${reqId}`).update({ status: 'Rejected' });
      const userSnap = await db.ref(`users/${reqData.username}`).once('value');
      if (userSnap.exists()) {
        const currBal = parseFloat(userSnap.val().availableBalance || 0);
        await db.ref(`users/${reqData.username}`).update({
          availableBalance: currBal + parseFloat(reqData.amount)
        });
      }
    }
  } catch (err) {
    console.warn("Firebase RTDB reject sync note:", err.message);
  }

  showToast(`Withdrawal #${reqId} rejected & balance refunded.`, 'info');
  loadAdminData();
}

async function adminCreditSpecificFundMonth(debitId) {
  const localDebits = getLocalStore('debits');
  const localUsers = getLocalStore('users');

  const debit = localDebits[debitId];
  if (!debit) return;

  const username = debit.username;
  const fundLabel = debit.fundNumber ? `Fund ${debit.fundNumber}` : 'Fund';
  const fAmount = parseFloat(debit.amount || 10);
  const bonusAmount = debit.monthlyBonus || parseFloat((fAmount * 0.2).toFixed(2));
  const currCount = parseInt(debit.creditedMonthCount || 0);
  const nextMonth = currCount + 1;

  if (nextMonth > 12) {
    showToast(`All 12 months have already been credited for ${fundLabel} (@${username}).`, 'info');
    return;
  }

  // 1. Update debit creditedMonthCount in LocalStorage
  debit.creditedMonthCount = nextMonth;
  setLocalStore('debits', localDebits);

  // 2. Update user available balance in LocalStorage
  if (localUsers[username]) {
    const currAvail = parseFloat(localUsers[username].availableBalance || 0);
    localUsers[username].availableBalance = currAvail + bonusAmount;
    setLocalStore('users', localUsers);
  }

  // 3. Update Firebase Realtime Database
  try {
    await db.ref(`debits/${debitId}`).update({
      creditedMonthCount: nextMonth
    });

    const userSnap = await db.ref(`users/${username}`).once('value');
    if (userSnap.exists()) {
      const uData = userSnap.val();
      const currBal = parseFloat(uData.availableBalance || 0);
      await db.ref(`users/${username}`).update({
        availableBalance: currBal + bonusAmount
      });
    }
  } catch (err) {
    console.warn("Firebase RTDB credit fund sync note:", err.message);
  }

  showToast(`✓ Credited Month ${nextMonth} payout (+$${bonusAmount} USD) for ${fundLabel} to @${username}!`, 'success');
  loadAdminData();
}

async function adminCreditNextMonthBonus(username) {
  const localUsers = getLocalStore('users');
  const localDebits = getLocalStore('debits');

  let locked = 0;
  let currCount = 0;
  if (localUsers[username]) {
    locked = parseFloat(localUsers[username].lockedDebitBalance || 0);
    currCount = parseInt(localUsers[username].creditedMonthCount || 0);
  }

  const bonusAmount = locked > 0 ? parseFloat((locked * 0.2).toFixed(2)) : 2.00;
  const nextMonth = currCount + 1;

  if (nextMonth > 12) {
    showToast(`All 12 months have already been credited for @${username}.`, 'info');
    return;
  }

  // 1. Update LocalStorage user balance & credited count
  if (localUsers[username]) {
    const currAvail = parseFloat(localUsers[username].availableBalance || 0);
    localUsers[username].availableBalance = currAvail + bonusAmount;
    localUsers[username].creditedMonthCount = nextMonth;
    setLocalStore('users', localUsers);
  }

  // 2. Update LocalStorage active debits for user
  for (let dKey in localDebits) {
    if (localDebits[dKey].username === username && localDebits[dKey].status === 'Approved') {
      const monthsArr = localDebits[dKey].creditedMonths || [];
      if (!monthsArr.includes(nextMonth)) {
        monthsArr.push(nextMonth);
        localDebits[dKey].creditedMonths = monthsArr;
      }
    }
  }
  setLocalStore('debits', localDebits);

  // 3. Update Firebase Realtime Database
  try {
    const userSnap = await db.ref(`users/${username}`).once('value');
    if (userSnap.exists()) {
      const uData = userSnap.val();
      const currBal = parseFloat(uData.availableBalance || 0);
      await db.ref(`users/${username}`).update({
        availableBalance: currBal + bonusAmount,
        creditedMonthCount: nextMonth
      });
    }

    const debitsSnap = await db.ref('debits').once('value');
    if (debitsSnap.exists()) {
      const debitsObj = debitsSnap.val();
      for (let dk in debitsObj) {
        if (debitsObj[dk].username === username && debitsObj[dk].status === 'Approved') {
          const arr = debitsObj[dk].creditedMonths || [];
          if (!arr.includes(nextMonth)) {
            arr.push(nextMonth);
            await db.ref(`debits/${dk}`).update({ creditedMonths: arr });
          }
        }
      }
    }
  } catch (err) {
    console.warn("Firebase RTDB credit month sync note:", err.message);
  }

  showToast(`✓ Credited Month ${nextMonth} payout (+$${bonusAmount} USD) to @${username}!`, 'success');
  loadAdminData();
}

async function adminCreditBonus(username, amount) {
  const localUsers = getLocalStore('users');

  if (localUsers[username]) {
    const curr = parseFloat(localUsers[username].availableBalance || 0);
    localUsers[username].availableBalance = curr + amount;
    setLocalStore('users', localUsers);
  }

  try {
    const userSnap = await db.ref(`users/${username}`).once('value');
    if (userSnap.exists()) {
      const currBal = parseFloat(userSnap.val().availableBalance || 0);
      await db.ref(`users/${username}`).update({
        availableBalance: currBal + amount
      });
    }
  } catch (err) {
    console.warn("Firebase RTDB credit bonus sync note:", err.message);
  }

  showToast(`Credited $${amount} monthly bonus to @${username}!`, 'success');
  loadAdminData();
}

function adminCreditCustomBonus(username) {
  const val = prompt(`Enter bonus amount ($) to credit for @${username}:`, "2");
  const amount = parseFloat(val);
  if (amount && amount > 0) {
    adminCreditBonus(username, amount);
  }
}

function closeAdminModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
}

function updateAdminDepUsdPreview(inrVal) {
  const inr = parseFloat(inrVal) || 0;
  const usd = parseFloat((inr / 100).toFixed(2));
  const bonus = parseFloat((usd * 0.2).toFixed(2));
  
  const usdEl = document.getElementById('admin-dep-usd-prev');
  if (usdEl) usdEl.textContent = `$${usd.toFixed(2)} USD`;
  
  const bonusEl = document.getElementById('admin-dep-bonus-prev');
  if (bonusEl) bonusEl.textContent = `$${bonus.toFixed(2)}/mo`;
}

function openAdminAddDepositModal(preselectedUsername) {
  const localUsers = getLocalStore('users') || {};
  const userSelect = document.getElementById('admin-dep-user');
  
  if (userSelect) {
    userSelect.innerHTML = '<option value="">-- Select Target User --</option>';
    for (let uKey in localUsers) {
      const u = localUsers[uKey];
      const opt = document.createElement('option');
      opt.value = u.username;
      opt.textContent = `@${u.username} (${u.fullName || u.username})`;
      if (preselectedUsername && preselectedUsername === u.username) {
        opt.selected = true;
      }
      userSelect.appendChild(opt);
    }
  }

  const dateInput = document.getElementById('admin-dep-date');
  if (dateInput) {
    // Default to today
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  const errDiv = document.getElementById('admin-add-dep-error');
  if (errDiv) errDiv.classList.add('hidden');

  updateAdminDepUsdPreview(document.getElementById('admin-dep-inr')?.value || 1000);
  document.getElementById('modal-admin-add-deposit').classList.remove('hidden');
}

async function handleAdminAddDepositSubmit(event) {
  event.preventDefault();

  const username = document.getElementById('admin-dep-user').value;
  const inrAmount = parseFloat(document.getElementById('admin-dep-inr').value);
  const depositDate = document.getElementById('admin-dep-date').value;
  const utr = document.getElementById('admin-dep-utr').value.trim() || 'ADMIN-DIRECT-DEPOSIT';
  const errDiv = document.getElementById('admin-add-dep-error');
  const submitBtn = document.getElementById('btn-submit-admin-dep');

  if (errDiv) errDiv.classList.add('hidden');

  if (!username) {
    if (errDiv) { errDiv.textContent = 'Please select a target user.'; errDiv.classList.remove('hidden'); }
    return;
  }

  if (!inrAmount || inrAmount < 100) {
    if (errDiv) { errDiv.textContent = 'Please enter a valid deposit amount (min ₹100).'; errDiv.classList.remove('hidden'); }
    return;
  }

  if (!depositDate) {
    if (errDiv) { errDiv.textContent = 'Please select a valid deposit date.'; errDiv.classList.remove('hidden'); }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding Deposit & Updating Vault...';
  }

  try {
    const localUsers = getLocalStore('users') || {};
    const localDebits = getLocalStore('debits') || {};
    const userObj = localUsers[username] || { username: username, fullName: username };

    const usdAmount = parseFloat((inrAmount / 100).toFixed(2));
    const monthlyBonusUSD = parseFloat((usdAmount * 0.2).toFixed(2));
    const debitId = 'DEB-ADM-' + Date.now();

    const userExistingDebits = Object.values(localDebits).filter(d => d.username === username);
    const fundNumber = userExistingDebits.length + 1;

    const debitRecord = {
      id: debitId,
      username: username,
      fullName: userObj.fullName || username,
      fundNumber: fundNumber,
      amount: usdAmount,
      inrAmount: inrAmount,
      date: depositDate, // Chosen deposit date (e.g. 5 Sep 2026)
      monthlyBonus: monthlyBonusUSD,
      monthsTotal: 12,
      creditedMonthCount: 0,
      utr: utr,
      proofUrl: 'ADMIN_MANUAL_ENTRY',
      status: 'Approved', // DIRECTLY APPROVED BY ADMIN
      timestamp: Date.now()
    };

    // Save debit record to local store
    localDebits[debitId] = debitRecord;
    setLocalStore('debits', localDebits);

    // Update user's locked vault balance
    const currentLocked = parseFloat(userObj.lockedDebitBalance || 0);
    userObj.lockedDebitBalance = currentLocked + usdAmount;
    localUsers[username] = userObj;
    setLocalStore('users', localUsers);

    // Run auto-payout milestone engine in case chosen date was in the past (e.g. 5 Sep with Month 1 on 5 Oct)
    autoProcessScheduledPayouts();

    // Firebase sync
    try {
      await ensureFirebaseAuth();
      await db.ref('debits/' + debitId).set(debitRecord);
      await db.ref('users/' + username).update({
        lockedDebitBalance: userObj.lockedDebitBalance,
        availableBalance: userObj.availableBalance || 0
      });
    } catch (err) {
      console.warn("Firebase RTDB admin deposit sync note:", err.message);
    }

    showToast(`✓ Added ₹${inrAmount.toLocaleString('en-IN')} ($${usdAmount} USD) deposit for @${username} on date ${depositDate}!`, 'success');

    closeAdminModal('modal-admin-add-deposit');
    document.getElementById('form-admin-add-deposit').reset();
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> Confirm & Add Deposit to User Vault'; }

    loadAdminData();

  } catch (err) {
    console.error("Admin add deposit error:", err);
    if (errDiv) { errDiv.textContent = 'Could not process deposit. Please try again.'; errDiv.classList.remove('hidden'); }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> Confirm & Add Deposit to User Vault'; }
  }
}

// FULL USER DATA LEDGER & TRANSACTION HISTORY MODAL
function openAdminUserLedger(username) {
  currentLedgerUsername = username;
  // Always run milestone auto-payout check first
  autoProcessScheduledPayouts();

  const localUsers = getLocalStore('users') || {};
  const localDebits = getLocalStore('debits') || {};
  const localWithdrawals = getLocalStore('withdrawals') || {};

  const u = localUsers[username] || { username: username };
  const locked = parseFloat(u.lockedDebitBalance || 0);
  const available = parseFloat(u.availableBalance || 0);
  const totalWalletMoney = locked + available;

  const subEl = document.getElementById('ledger-user-sub');
  if (subEl) {
    subEl.innerHTML = `<strong>@${u.username}</strong> | Full Name: <strong>${u.fullName || 'N/A'}</strong> | Contact: <strong>${u.contactNumber || 'N/A'}</strong> | Email: <strong>${u.email || 'N/A'}</strong>`;
  }

  const statTot = document.getElementById('ledger-stat-total');
  if (statTot) statTot.textContent = `$${totalWalletMoney.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD (₹${(totalWalletMoney * 100).toLocaleString('en-IN')})`;

  const statVault = document.getElementById('ledger-stat-vault');
  if (statVault) statVault.textContent = `$${locked.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`;

  const statAvail = document.getElementById('ledger-stat-avail');
  if (statAvail) statAvail.textContent = `$${available.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`;

  // Render User Debits / Deposits Table
  const debitsTbody = document.getElementById('ledger-debits-tbody');
  if (debitsTbody) {
    debitsTbody.innerHTML = '';
    const userDebits = [];
    for (let k in localDebits) {
      if (localDebits[k].username === username) {
        userDebits.push({ id: k, ...localDebits[k] });
      }
    }
    userDebits.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (userDebits.length === 0) {
      debitsTbody.innerHTML = `<tr><td colspan="8" class="text-center py-3">No deposit history found for @${username}.</td></tr>`;
    } else {
      userDebits.forEach((d, idx) => {
        const tr = document.createElement('tr');
        const inrDisp = d.inrAmount ? d.inrAmount.toLocaleString('en-IN') : (d.amount * 100);
        const usdDisp = parseFloat(d.amount).toLocaleString('en-US', { minimumFractionDigits: 2 });
        const month1StartStr = formatMilestoneDateStr(d.date, 1);
        const creditedCount = parseInt(d.creditedMonthCount || 0);

        let statusClass = 'pending';
        if (d.status === 'Approved') statusClass = 'success';
        if (d.status === 'Rejected') statusClass = 'danger';

        tr.innerHTML = `
          <td><strong>Fund ${d.fundNumber || idx + 1}</strong></td>
          <td><code>#${d.id.substring(0, 12)}</code></td>
          <td><strong style="color: #0284c7;">${d.date || 'N/A'}</strong></td>
          <td><strong>₹${inrDisp} ($${usdDisp} USD)</strong></td>
          <td><code>${d.utr || 'N/A'}</code></td>
          <td><span style="color: #0284c7; font-weight: 600;"><i class="fa-solid fa-calendar-check"></i> ${month1StartStr}</span></td>
          <td><span class="badge-status ${statusClass}">${d.status || 'Pending'}</span></td>
          <td><strong class="text-green">${creditedCount} / 12</strong> Months Credited</td>
        `;
        debitsTbody.appendChild(tr);
      });
    }
  }

  // Render User Withdrawals Table
  const wTbody = document.getElementById('ledger-withdrawals-tbody');
  if (wTbody) {
    wTbody.innerHTML = '';
    const userW = [];
    for (let k in localWithdrawals) {
      if (localWithdrawals[k].username === username) {
        userW.push({ id: k, ...localWithdrawals[k] });
      }
    }
    userW.reverse();

    if (userW.length === 0) {
      wTbody.innerHTML = `<tr><td colspan="5" class="text-center py-3">No withdrawal requests found.</td></tr>`;
    } else {
      userW.forEach(w => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><code>#${w.id.substring(0, 8)}</code></td>
          <td>${w.date}</td>
          <td><strong class="text-green">$${parseFloat(w.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
          <td><span class="badge-neutral">${w.method}</span></td>
          <td><span class="status-badge ${w.status.toLowerCase()}">${w.status}</span></td>
        `;
        wTbody.appendChild(tr);
      });
    }
  }

  document.getElementById('modal-admin-user-ledger').classList.remove('hidden');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==========================================================================
// PERMANENT USER DELETION & PREVIOUS DELETES ARCHIVE ENGINE
// ==========================================================================
function promptDeleteUser(username) {
  if (!username) return;
  pendingDeleteUsername = username;
  const localUsers = getLocalStore('users') || {};
  const localDebits = getLocalStore('debits') || {};
  const u = localUsers[username] || { username: username };

  const locked = parseFloat(u.lockedDebitBalance || 0);
  const available = parseFloat(u.availableBalance || 0);
  const totalWallet = locked + available;

  const userDebits = Object.values(localDebits).filter(d => d.username === username);

  const fnEl = document.getElementById('del-user-fullname');
  if (fnEl) fnEl.textContent = u.fullName || username;

  const unEl = document.getElementById('del-user-username');
  if (unEl) unEl.textContent = '@' + username;

  const phEl = document.getElementById('del-user-phone');
  if (phEl) phEl.textContent = u.contactNumber || 'N/A';

  const depEl = document.getElementById('del-user-deposits');
  if (depEl) depEl.textContent = userDebits.length;

  const vEl = document.getElementById('del-user-vault');
  if (vEl) vEl.textContent = `$${locked.toFixed(2)}`;

  const wEl = document.getElementById('del-user-wallet');
  if (wEl) wEl.textContent = `$${totalWallet.toFixed(2)}`;

  const reasonEl = document.getElementById('del-user-reason');
  if (reasonEl) reasonEl.value = 'Deleted by Administrator';

  const modal = document.getElementById('modal-confirm-delete-user');
  if (modal) modal.classList.remove('hidden');
}

function promptDeleteUserFromLedger() {
  if (currentLedgerUsername) {
    promptDeleteUser(currentLedgerUsername);
  }
}

async function executeDeleteUser() {
  if (!pendingDeleteUsername) return;
  const username = pendingDeleteUsername;
  const btn = document.getElementById('btn-execute-delete-user');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting Account...';
  }

  try {
    const localUsers = getLocalStore('users') || {};
    const localDebits = getLocalStore('debits') || {};
    const localWithdrawals = getLocalStore('withdrawals') || {};
    const localDeleted = getLocalStore('deleted_users') || {};

    const userObj = localUsers[username] || { username: username };
    const reasonInput = document.getElementById('del-user-reason');
    const reason = (reasonInput && reasonInput.value.trim()) ? reasonInput.value.trim() : 'Deleted by Administrator';

    // Collect debits for this user
    const userDebits = [];
    const debitKeysToRemove = [];
    for (let k in localDebits) {
      if (localDebits[k].username === username) {
        userDebits.push({ id: k, ...localDebits[k] });
        debitKeysToRemove.push(k);
      }
    }
    debitKeysToRemove.forEach(k => delete localDebits[k]);

    // Collect withdrawals for this user
    const userWithdrawals = [];
    const withdrawalKeysToRemove = [];
    for (let k in localWithdrawals) {
      if (localWithdrawals[k].username === username) {
        userWithdrawals.push({ id: k, ...localWithdrawals[k] });
        withdrawalKeysToRemove.push(k);
      }
    }
    withdrawalKeysToRemove.forEach(k => delete localWithdrawals[k]);

    const locked = parseFloat(userObj.lockedDebitBalance || 0);
    const available = parseFloat(userObj.availableBalance || 0);
    const totalWallet = locked + available;

    const deletedRecord = {
      username: username,
      fullName: userObj.fullName || username,
      email: userObj.email || '',
      contactNumber: userObj.contactNumber || '',
      password: userObj.password || '',
      lockedDebitBalance: locked,
      availableBalance: available,
      totalWalletMoney: totalWallet.toFixed(2),
      totalDepositsCount: userDebits.length,
      userDebits: userDebits,
      userWithdrawals: userWithdrawals,
      deletedAt: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
      deletedDateIso: new Date().toISOString(),
      deletedTimestamp: Date.now(),
      deletedBy: 'Administrator',
      deletionReason: reason
    };

    // 1. Update local storage
    localDeleted[username] = deletedRecord;
    delete localUsers[username];
    setLocalStore('deleted_users', localDeleted);
    setLocalStore('users', localUsers);
    setLocalStore('debits', localDebits);
    setLocalStore('withdrawals', localWithdrawals);

    // 2. Sync to Firebase RTDB
    try {
      await ensureFirebaseAuth();
      await db.ref('deleted_users/' + username).set(deletedRecord);
      await db.ref('users/' + username).remove();
      for (const k of debitKeysToRemove) {
        await db.ref('debits/' + k).remove();
      }
      for (const k of withdrawalKeysToRemove) {
        await db.ref('withdrawals/' + k).remove();
      }
    } catch (err) {
      console.warn("Firebase delete sync note:", err.message);
    }

    closeAdminModal('modal-confirm-delete-user');
    closeAdminModal('modal-admin-user-ledger');
    pendingDeleteUsername = null;

    showToast(`✓ User @${username} was permanently deleted and recorded in Previous Deletes.`, 'success');
    loadAdminData();

  } catch (err) {
    console.error("Execute delete error:", err);
    showToast('Could not complete user deletion. Please try again.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-trash-can"></i> Yes, Permanently Delete';
    }
  }
}

// Render Previous Deletes (Deleted Users History) Table
function renderDeletedUsersTable(deletedObj) {
  const tbody = document.getElementById('admin-deleted-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const list = [];
  for (let k in deletedObj) {
    list.push(deletedObj[k]);
  }
  list.sort((a, b) => (b.deletedTimestamp || 0) - (a.deletedTimestamp || 0));

  const countBadge = document.getElementById('stat-deleted-users-count');
  if (countBadge) countBadge.textContent = list.length;

  const statCardVal = document.getElementById('stat-total-deleted-users');
  if (statCardVal) statCardVal.textContent = list.length;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4">No deleted user history recorded yet.</td></tr>`;
    return;
  }

  list.forEach(d => {
    const tr = document.createElement('tr');
    const locked = parseFloat(d.lockedDebitBalance || 0);
    const available = parseFloat(d.availableBalance || 0);
    const totalWallet = parseFloat(d.totalWalletMoney || (locked + available));
    const depCount = d.totalDepositsCount !== undefined ? d.totalDepositsCount : (d.userDebits ? d.userDebits.length : 0);

    tr.innerHTML = `
      <td>
        <strong style="color: #be123c; font-size: 0.95rem;">@${d.username}</strong><br>
        <small class="text-muted"><i class="fa-solid fa-id-badge"></i> ${d.fullName || 'N/A'}</small>
      </td>
      <td>
        <small><i class="fa-solid fa-phone"></i> ${d.contactNumber || 'N/A'}</small><br>
        <small class="text-muted"><i class="fa-solid fa-envelope"></i> ${d.email || 'N/A'}</small>
      </td>
      <td><span class="deleted-user-pill"><i class="fa-solid fa-receipt"></i> <strong>${depCount}</strong> Deposits</span></td>
      <td><strong style="color: #64748b;">$${locked.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
      <td><strong style="color: #64748b;">$${available.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
      <td><strong style="color: #dc2626; font-size: 0.95rem; background: #fff1f2; padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid #fecdd3;">$${totalWallet.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD</strong></td>
      <td>
        <div style="font-size: 0.8rem; font-weight: 600; color: #1e293b;"><i class="fa-solid fa-clock"></i> ${d.deletedAt || 'N/A'}</div>
        <small class="text-muted"><i class="fa-solid fa-note-sticky"></i> ${d.deletionReason || 'Deleted'}</small>
      </td>
      <td>
        <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
          <button class="btn-primary" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="openArchivedUserLedger('${d.username}')" title="View historical ledger of this deleted account">
            <i class="fa-solid fa-box-archive"></i> View Ledger
          </button>
          <button class="btn-emerald" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="restoreDeletedUser('${d.username}')" title="Restore account back to active users">
            <i class="fa-solid fa-rotate-left"></i> Restore
          </button>
          <button class="btn-danger-sm" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="purgeDeletedUserPermanently('${d.username}')" title="Completely remove from archive">
            <i class="fa-solid fa-eraser"></i> Purge
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Open Archived Deleted User Ledger Modal
function openArchivedUserLedger(username) {
  const localDeleted = getLocalStore('deleted_users') || {};
  const rec = localDeleted[username];
  if (!rec) {
    showToast(`Archived record for @${username} not found.`, 'error');
    return;
  }

  currentArchivedLedgerUsername = username;

  const subEl = document.getElementById('del-ledger-user-sub');
  if (subEl) {
    subEl.innerHTML = `<strong>@${rec.username}</strong> | Full Name: <strong>${rec.fullName || 'N/A'}</strong> | Contact: <strong>${rec.contactNumber || 'N/A'}</strong> | Email: <strong>${rec.email || 'N/A'}</strong>`;
  }

  const noticeEl = document.getElementById('del-ledger-notice-banner');
  if (noticeEl) {
    noticeEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 700; margin-bottom: 0.2rem;">
        <i class="fa-solid fa-circle-exclamation text-danger"></i>
        <span>Account Permanently Deleted on ${rec.deletedAt || 'N/A'}</span>
      </div>
      <div><strong>Reason:</strong> ${rec.deletionReason || 'Deleted by Administrator'} | <strong>Deleted By:</strong> ${rec.deletedBy || 'Administrator'}</div>
    `;
  }

  const locked = parseFloat(rec.lockedDebitBalance || 0);
  const available = parseFloat(rec.availableBalance || 0);
  const totalWallet = parseFloat(rec.totalWalletMoney || (locked + available));

  const totEl = document.getElementById('del-ledger-stat-total');
  if (totEl) totEl.textContent = `$${totalWallet.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`;

  const vaultEl = document.getElementById('del-ledger-stat-vault');
  if (vaultEl) vaultEl.textContent = `$${locked.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`;

  const availEl = document.getElementById('del-ledger-stat-avail');
  if (availEl) availEl.textContent = `$${available.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`;

  // Render archived debits
  const debitsTbody = document.getElementById('del-ledger-debits-tbody');
  if (debitsTbody) {
    debitsTbody.innerHTML = '';
    const userDebits = rec.userDebits || [];
    if (userDebits.length === 0) {
      debitsTbody.innerHTML = `<tr><td colspan="7" class="text-center py-3">No deposits were active on this deleted account.</td></tr>`;
    } else {
      userDebits.forEach((d, idx) => {
        const tr = document.createElement('tr');
        const inrDisp = d.inrAmount ? d.inrAmount.toLocaleString('en-IN') : (d.amount * 100);
        const usdDisp = parseFloat(d.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
        const creditedCount = parseInt(d.creditedMonthCount || 0);

        tr.innerHTML = `
          <td><strong>Fund ${d.fundNumber || idx + 1}</strong></td>
          <td><code>#${(d.id || '').substring(0, 12)}</code></td>
          <td><strong style="color: #0284c7;">${d.date || 'N/A'}</strong></td>
          <td><strong>₹${inrDisp} ($${usdDisp} USD)</strong></td>
          <td><code>${d.utr || 'N/A'}</code></td>
          <td><strong class="text-green">${creditedCount} / 12</strong> Months Credited</td>
          <td><span class="badge-status danger">Archived (${d.status || 'Approved'})</span></td>
        `;
        debitsTbody.appendChild(tr);
      });
    }
  }

  // Render archived withdrawals
  const wTbody = document.getElementById('del-ledger-withdrawals-tbody');
  if (wTbody) {
    wTbody.innerHTML = '';
    const userW = rec.userWithdrawals || [];
    if (userW.length === 0) {
      wTbody.innerHTML = `<tr><td colspan="5" class="text-center py-3">No withdrawal requests recorded.</td></tr>`;
    } else {
      userW.forEach(w => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><code>#${(w.id || '').substring(0, 8)}</code></td>
          <td>${w.date || 'N/A'}</td>
          <td><strong class="text-green">$${parseFloat(w.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
          <td><span class="badge-neutral">${w.method || 'UPI'}</span></td>
          <td><span class="status-badge ${String(w.status || '').toLowerCase()}">${w.status || 'N/A'}</span></td>
        `;
        wTbody.appendChild(tr);
      });
    }
  }

  document.getElementById('modal-admin-deleted-user-ledger').classList.remove('hidden');
}

function restoreDeletedUserFromLedger() {
  if (currentArchivedLedgerUsername) {
    restoreDeletedUser(currentArchivedLedgerUsername);
  }
}

// Restore a deleted user back to active accounts
async function restoreDeletedUser(username) {
  if (!confirm(`Are you sure you want to restore user @${username} back to Active Accounts?`)) return;

  const localDeleted = getLocalStore('deleted_users') || {};
  const localUsers = getLocalStore('users') || {};
  const localDebits = getLocalStore('debits') || {};
  const localWithdrawals = getLocalStore('withdrawals') || {};

  const rec = localDeleted[username];
  if (!rec) return;

  const restoredUserData = {
    username: rec.username,
    fullName: rec.fullName,
    email: rec.email,
    contactNumber: rec.contactNumber,
    password: rec.password,
    lockedDebitBalance: parseFloat(rec.lockedDebitBalance || 0),
    availableBalance: parseFloat(rec.availableBalance || 0),
    restoredAt: new Date().toISOString()
  };

  localUsers[username] = restoredUserData;

  if (rec.userDebits && Array.isArray(rec.userDebits)) {
    rec.userDebits.forEach(d => {
      localDebits[d.id] = d;
    });
  }
  if (rec.userWithdrawals && Array.isArray(rec.userWithdrawals)) {
    rec.userWithdrawals.forEach(w => {
      localWithdrawals[w.id] = w;
    });
  }

  delete localDeleted[username];

  setLocalStore('users', localUsers);
  setLocalStore('debits', localDebits);
  setLocalStore('withdrawals', localWithdrawals);
  setLocalStore('deleted_users', localDeleted);

  try {
    await ensureFirebaseAuth();
    await db.ref('users/' + username).set(restoredUserData);
    if (rec.userDebits && Array.isArray(rec.userDebits)) {
      for (const d of rec.userDebits) {
        await db.ref('debits/' + d.id).set(d);
      }
    }
    if (rec.userWithdrawals && Array.isArray(rec.userWithdrawals)) {
      for (const w of rec.userWithdrawals) {
        await db.ref('withdrawals/' + w.id).set(w);
      }
    }
    await db.ref('deleted_users/' + username).remove();
  } catch (err) {
    console.warn("Firebase restore sync note:", err.message);
  }

  closeAdminModal('modal-admin-deleted-user-ledger');
  showToast(`✓ User @${username} restored successfully to Active Accounts!`, 'success');
  loadAdminData();
}

// Completely purge record from Previous Deletes archive
async function purgeDeletedUserPermanently(username) {
  if (!confirm(`Warning: Completely wipe historical record of @${username} from Previous Deletes archive? This cannot be undone.`)) return;

  const localDeleted = getLocalStore('deleted_users') || {};
  delete localDeleted[username];
  setLocalStore('deleted_users', localDeleted);

  try {
    await ensureFirebaseAuth();
    await db.ref('deleted_users/' + username).remove();
  } catch (err) {
    console.warn("Firebase purge note:", err.message);
  }

  showToast(`Archived record for @${username} purged permanently.`, 'info');
  loadAdminData();
}

// ==========================================================================
// EXCEL / CSV EXPORT ENGINES
// ==========================================================================
async function downloadActiveUsersDepositsCSV() {
  try {
    let localUsers = getLocalStore('users') || {};
    let localDebits = getLocalStore('debits') || {};

    // 1. If local storage is empty or stale, fetch directly from Firebase
    if (Object.keys(localUsers).length === 0 && window.db) {
      try {
        await ensureFirebaseAuth();
        const userSnap = await db.ref('users').once('value');
        if (userSnap.exists()) {
          localUsers = userSnap.val() || {};
          setLocalStore('users', localUsers);
        }
        const debSnap = await db.ref('debits').once('value');
        if (debSnap.exists()) {
          localDebits = debSnap.val() || {};
          setLocalStore('debits', localDebits);
        }
      } catch (e) {
        console.warn("Direct Firebase fetch note:", e.message);
      }
    }

    const headers = [
      "User Full Name",
      "Username",
      "Contact Number",
      "Email",
      "Fund Number",
      "Deposit ID",
      "Deposit Date",
      "Deposit Amount (INR)",
      "Deposit Amount (USD)",
      "Monthly Charge / Return Rate",
      "Monthly Charge Amount (USD)",
      "Monthly Charge Amount (INR)",
      "Months Credited (of 12)",
      "Total Charges Credited (USD)",
      "Total Charges Credited (INR)",
      "Remaining Months (of 12)",
      "Total Charges Remaining (USD)",
      "Total Charges Remaining (INR)",
      "Next Monthly Charge Due Date",
      "Month 1 Charge Deposit Date",
      "Month 2 Charge Deposit Date",
      "Month 3 Charge Deposit Date",
      "Month 4 Charge Deposit Date",
      "Month 5 Charge Deposit Date",
      "Month 6 Charge Deposit Date",
      "Month 7 Charge Deposit Date",
      "Month 8 Charge Deposit Date",
      "Month 9 Charge Deposit Date",
      "Month 10 Charge Deposit Date",
      "Month 11 Charge Deposit Date",
      "Month 12 Charge Deposit Date",
      "Locked Vault Principal (USD)",
      "Available Bonus Balance (USD)",
      "Total Money in Wallet (USD)",
      "Total Money in Wallet (INR)",
      "UTR Reference",
      "Deposit Status"
    ];

    const rows = [];
    const activeUsernames = Object.keys(localUsers);

    if (activeUsernames.length === 0) {
      // Always generate and download the file with headers and placeholder row so admin gets the Excel sheet
      rows.push([
        "No Active Users Registered Yet",
        "N/A",
        "N/A",
        "N/A",
        "None",
        "N/A",
        "N/A",
        0,
        0,
        "20%",
        0,
        0,
        0,
        0,
        0,
        12,
        0,
        0,
        "N/A",
        "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A",
        "0.00",
        "0.00",
        "0.00",
        0,
        "N/A",
        "No Active Users"
      ]);
    } else {
      for (const username of activeUsernames) {
        const u = localUsers[username] || {};
        const locked = parseFloat(u.lockedDebitBalance || 0);
        const available = parseFloat(u.availableBalance || 0);
        const totalWalletUSD = locked + available;
        const totalWalletINR = Math.round(totalWalletUSD * 100);

        const userDebits = [];
        for (const dKey in localDebits) {
          if (localDebits[dKey] && localDebits[dKey].username === username) {
            userDebits.push({ id: dKey, ...localDebits[dKey] });
          }
        }
        userDebits.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        if (userDebits.length === 0) {
          rows.push([
            u.fullName || username,
            "@" + username,
            u.contactNumber || "N/A",
            u.email || "N/A",
            "None",
            "N/A",
            "No Deposits Yet",
            0,
            0,
            "20%",
            0,
            0,
            0,
            0,
            0,
            12,
            0,
            0,
            "N/A",
            "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A",
            locked.toFixed(2),
            available.toFixed(2),
            totalWalletUSD.toFixed(2),
            totalWalletINR,
            "N/A",
            "No Deposits"
          ]);
        } else {
          userDebits.forEach((d, idx) => {
            const dAmt = parseFloat(d.amount || 10);
            const dInr = d.inrAmount ? d.inrAmount : Math.round(dAmt * 100);
            const monthlyBonusUSD = d.monthlyBonus || parseFloat((dAmt * 0.2).toFixed(2));
            const monthlyBonusINR = Math.round(monthlyBonusUSD * 100);
            const creditedCount = parseInt(d.creditedMonthCount || 0);
            const remainingMonths = Math.max(0, 12 - creditedCount);
            const totalCreditedUSD = parseFloat((creditedCount * monthlyBonusUSD).toFixed(2));
            const totalCreditedINR = Math.round(totalCreditedUSD * 100);
            const totalRemainingUSD = parseFloat((remainingMonths * monthlyBonusUSD).toFixed(2));
            const totalRemainingINR = Math.round(totalRemainingUSD * 100);

            const depositDate = d.date || "N/A";
            const nextMilestoneDateStr = creditedCount < 12 
              ? formatMilestoneDateStr(depositDate, creditedCount + 1)
              : "Completed (12/12)";

            const mDates = [];
            for (let m = 1; m <= 12; m++) {
              mDates.push(formatMilestoneDateStr(depositDate, m));
            }

            rows.push([
              u.fullName || username,
              "@" + username,
              u.contactNumber || "N/A",
              u.email || "N/A",
              d.fundNumber ? `Fund ${d.fundNumber}` : `Fund ${idx + 1}`,
              d.id || `DEB-${idx + 1}`,
              depositDate,
              dInr,
              dAmt.toFixed(2),
              "20% Monthly",
              monthlyBonusUSD.toFixed(2),
              monthlyBonusINR,
              creditedCount,
              totalCreditedUSD.toFixed(2),
              totalCreditedINR,
              remainingMonths,
              totalRemainingUSD.toFixed(2),
              totalRemainingINR,
              nextMilestoneDateStr,
              ...mDates,
              locked.toFixed(2),
              available.toFixed(2),
              totalWalletUSD.toFixed(2),
              totalWalletINR,
              d.utr || "N/A",
              d.status || "Approved"
            ]);
          });
        }
      }
    }

    const csvContent = [
      headers.map(escapeCSVCell).join(","),
      ...rows.map(row => row.map(escapeCSVCell).join(","))
    ].join("\r\n");

    const todayStr = new Date().toISOString().split("T")[0];
    downloadCSVFile(`EFinance_Active_Users_Deposits_and_Charges_${todayStr}.csv`, csvContent);
    showToast("✓ Active users deposits & monthly charges CSV downloaded successfully!", "success");

  } catch (err) {
    console.error("downloadActiveUsersDepositsCSV error:", err);
    showToast("Error generating CSV: " + (err.message || "Unknown error"), "error");
  }
}

async function downloadSingleUserCSV(username) {
  try {
    let localUsers = getLocalStore('users') || {};
    let localDebits = getLocalStore('debits') || {};

    if (!localUsers[username] && window.db) {
      try {
        await ensureFirebaseAuth();
        const uSnap = await db.ref('users/' + username).once('value');
        if (uSnap.exists()) {
          localUsers[username] = uSnap.val();
          setLocalStore('users', localUsers);
        }
        const dSnap = await db.ref('debits').once('value');
        if (dSnap.exists()) {
          localDebits = dSnap.val() || {};
          setLocalStore('debits', localDebits);
        }
      } catch (e) {}
    }

    const u = localUsers[username] || { username: username };

    const headers = [
      "User Full Name",
      "Username",
      "Contact Number",
      "Email",
      "Fund Number",
      "Deposit ID",
      "Deposit Date",
      "Deposit Amount (INR)",
      "Deposit Amount (USD)",
      "Monthly Charge / Return Rate",
      "Monthly Charge Amount (USD)",
      "Monthly Charge Amount (INR)",
      "Months Credited (of 12)",
      "Total Charges Credited (USD)",
      "Total Charges Credited (INR)",
      "Remaining Months (of 12)",
      "Total Charges Remaining (USD)",
      "Total Charges Remaining (INR)",
      "Next Monthly Charge Due Date",
      "Month 1 Charge Deposit Date",
      "Month 2 Charge Deposit Date",
      "Month 3 Charge Deposit Date",
      "Month 4 Charge Deposit Date",
      "Month 5 Charge Deposit Date",
      "Month 6 Charge Deposit Date",
      "Month 7 Charge Deposit Date",
      "Month 8 Charge Deposit Date",
      "Month 9 Charge Deposit Date",
      "Month 10 Charge Deposit Date",
      "Month 11 Charge Deposit Date",
      "Month 12 Charge Deposit Date",
      "Locked Vault Principal (USD)",
      "Available Bonus Balance (USD)",
      "Total Money in Wallet (USD)",
      "Total Money in Wallet (INR)",
      "UTR Reference",
      "Deposit Status"
    ];

    const locked = parseFloat(u.lockedDebitBalance || 0);
    const available = parseFloat(u.availableBalance || 0);
    const totalWalletUSD = locked + available;
    const totalWalletINR = Math.round(totalWalletUSD * 100);

    const userDebits = [];
    for (const dKey in localDebits) {
      if (localDebits[dKey] && localDebits[dKey].username === username) {
        userDebits.push({ id: dKey, ...localDebits[dKey] });
      }
    }
    userDebits.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const rows = [];
    if (userDebits.length === 0) {
      rows.push([
        u.fullName || username,
        "@" + username,
        u.contactNumber || "N/A",
        u.email || "N/A",
        "None",
        "N/A",
        "No Deposits Yet",
        0,
        0,
        "20%",
        0,
        0,
        0,
        0,
        0,
        12,
        0,
        0,
        "N/A",
        "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A",
        locked.toFixed(2),
        available.toFixed(2),
        totalWalletUSD.toFixed(2),
        totalWalletINR,
        "N/A",
        "No Deposits"
      ]);
    } else {
      userDebits.forEach((d, idx) => {
        const dAmt = parseFloat(d.amount || 10);
        const dInr = d.inrAmount ? d.inrAmount : Math.round(dAmt * 100);
        const monthlyBonusUSD = d.monthlyBonus || parseFloat((dAmt * 0.2).toFixed(2));
        const monthlyBonusINR = Math.round(monthlyBonusUSD * 100);
        const creditedCount = parseInt(d.creditedMonthCount || 0);
        const remainingMonths = Math.max(0, 12 - creditedCount);
        const totalCreditedUSD = parseFloat((creditedCount * monthlyBonusUSD).toFixed(2));
        const totalCreditedINR = Math.round(totalCreditedUSD * 100);
        const totalRemainingUSD = parseFloat((remainingMonths * monthlyBonusUSD).toFixed(2));
        const totalRemainingINR = Math.round(totalRemainingUSD * 100);

        const depositDate = d.date || "N/A";
        const nextMilestoneDateStr = creditedCount < 12 
          ? formatMilestoneDateStr(depositDate, creditedCount + 1)
          : "Completed (12/12)";

        const mDates = [];
        for (let m = 1; m <= 12; m++) {
          mDates.push(formatMilestoneDateStr(depositDate, m));
        }

        rows.push([
          u.fullName || username,
          "@" + username,
          u.contactNumber || "N/A",
          u.email || "N/A",
          d.fundNumber ? `Fund ${d.fundNumber}` : `Fund ${idx + 1}`,
          d.id || `DEB-${idx + 1}`,
          depositDate,
          dInr,
          dAmt.toFixed(2),
          "20% Monthly",
          monthlyBonusUSD.toFixed(2),
          monthlyBonusINR,
          creditedCount,
          totalCreditedUSD.toFixed(2),
          totalCreditedINR,
          remainingMonths,
          totalRemainingUSD.toFixed(2),
          totalRemainingINR,
          nextMilestoneDateStr,
          ...mDates,
          locked.toFixed(2),
          available.toFixed(2),
          totalWalletUSD.toFixed(2),
          totalWalletINR,
          d.utr || "N/A",
          d.status || "Approved"
        ]);
      });
    }

    const csvContent = [
      headers.map(escapeCSVCell).join(","),
      ...rows.map(row => row.map(escapeCSVCell).join(","))
    ].join("\r\n");

    const todayStr = new Date().toISOString().split("T")[0];
    downloadCSVFile(`EFinance_User_${username}_Deposits_and_Charges_${todayStr}.csv`, csvContent);
    showToast(`✓ Ledger CSV for @${username} downloaded successfully!`, "success");
  } catch (err) {
    console.error("downloadSingleUserCSV error:", err);
    showToast("Error generating user CSV", "error");
  }
}

function downloadSingleUserLedgerCSV() {
  if (currentLedgerUsername) {
    downloadSingleUserCSV(currentLedgerUsername);
  } else {
    downloadActiveUsersDepositsCSV();
  }
}

async function downloadDeletedUsersCSV() {
  try {
    let localDeleted = getLocalStore('deleted_users') || {};

    if (Object.keys(localDeleted).length === 0 && window.db) {
      try {
        await ensureFirebaseAuth();
        const delSnap = await db.ref('deleted_users').once('value');
        if (delSnap.exists()) {
          localDeleted = delSnap.val() || {};
          setLocalStore('deleted_users', localDeleted);
        }
      } catch (e) {}
    }

    const list = Object.values(localDeleted);

    const headers = [
      "Deleted User Full Name",
      "Username",
      "Contact Number",
      "Email",
      "Deletion Date & Time",
      "Deletion Reason",
      "Deleted By",
      "Total Historical Deposits Count",
      "Locked Vault Principal at Deletion ($)",
      "Available Balance at Deletion ($)",
      "Total Wallet Money at Deletion ($)",
      "Archived Deposit IDs & Dates"
    ];

    const rows = [];

    if (list.length === 0) {
      rows.push([
        "No Deleted Users Recorded Yet",
        "N/A",
        "N/A",
        "N/A",
        "N/A",
        "No Previous Deletes Recorded",
        "Administrator",
        0,
        "0.00",
        "0.00",
        "0.00",
        "None"
      ]);
    } else {
      list.forEach(d => {
        const depListStr = (d.userDebits || []).map(deb => `${deb.id} (${deb.date || 'N/A'}: $${deb.amount || 0})`).join(" | ");
        rows.push([
          d.fullName || d.username,
          "@" + d.username,
          d.contactNumber || "N/A",
          d.email || "N/A",
          d.deletedAt || "N/A",
          d.deletionReason || "Deleted by Administrator",
          d.deletedBy || "Administrator",
          d.totalDepositsCount !== undefined ? d.totalDepositsCount : (d.userDebits ? d.userDebits.length : 0),
          parseFloat(d.lockedDebitBalance || 0).toFixed(2),
          parseFloat(d.availableBalance || 0).toFixed(2),
          parseFloat(d.totalWalletMoney || 0).toFixed(2),
          depListStr || "None"
        ]);
      });
    }

    const csvContent = [
      headers.map(escapeCSVCell).join(","),
      ...rows.map(row => row.map(escapeCSVCell).join(","))
    ].join("\r\n");

    const todayStr = new Date().toISOString().split("T")[0];
    downloadCSVFile(`EFinance_Previous_Deleted_Users_${todayStr}.csv`, csvContent);
    showToast("✓ Previous deleted users CSV downloaded!", "success");
  } catch (err) {
    console.error("downloadDeletedUsersCSV error:", err);
    showToast("Error generating deleted users CSV", "error");
  }
}

function escapeCSVCell(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return `"${str}"`;
}

function downloadCSVFile(filename, csvContent) {
  try {
    // UTF-8 BOM so Excel opens Hindi, currencies, and numbers with correct column formatting
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });

    // Method 1: msSaveBlob for legacy Windows Edge/IE
    if (window.navigator && window.navigator.msSaveOrOpenBlob) {
      window.navigator.msSaveOrOpenBlob(blob, filename);
      return;
    }

    // Method 2: Standard HTML5 Blob download
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.setAttribute("download", filename);
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();

    // Critical: Do NOT revoke synchronously! Keep alive for 10 seconds so Chrome/Edge download manager processes it
    setTimeout(() => {
      try {
        if (link && link.parentNode) {
          link.parentNode.removeChild(link);
        }
        URL.revokeObjectURL(url);
      } catch (err) {}
    }, 10000);

  } catch (err) {
    console.warn("Blob download failed, using data URI fallback:", err);
    // Method 3: Data URI fallback if Blob is restricted by browser security policies
    try {
      const encodedUri = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(csvContent);
      const link = document.createElement("a");
      link.href = encodedUri;
      link.download = filename;
      link.setAttribute("download", filename);
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        try {
          if (link && link.parentNode) link.parentNode.removeChild(link);
        } catch (e) {}
      }, 5000);
    } catch (fallbackErr) {
      console.error("Data URI fallback failed:", fallbackErr);
      alert("Could not trigger automatic download. Please ensure your browser permits file downloads.");
    }
  }
}


