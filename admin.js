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

let debitsUnsub = null;

function loadAdminData() {
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
          proofHtml = `
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <img src="${req.proofUrl}" alt="Proof" style="width: 48px; height: 48px; object-fit: cover; border-radius: 8px; border: 1.5px solid #0284c7; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" onclick="openAdminProofModal('${req.utr || 'N/A'}', '${req.proofUrl}')" title="Click to view full screenshot">
              <button type="button" class="btn-secondary-sm" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;" onclick="openAdminProofModal('${req.utr || 'N/A'}', '${req.proofUrl}')">
                <i class="fa-solid fa-eye"></i> View
              </button>
            </div>`;
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
          <td><code>#${req.id.substring(0, 10)}</code></td>
          <td><strong>${req.fullName || req.username}</strong><br><small class="text-muted">@${req.username}</small></td>
          <td>${req.date}</td>
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

  // Render users table function
  const renderUsersTable = (usersObj) => {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let totalUsers = 0;
    let totalSystemDebits = 0;

    for (let uKey in usersObj) {
      totalUsers++;
      const u = usersObj[uKey];
      const locked = parseFloat(u.lockedDebitBalance || 0);
      const available = parseFloat(u.availableBalance || 0);
      totalSystemDebits += locked;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>@${u.username}</strong></td>
        <td>${u.fullName || 'N/A'}</td>
        <td>${u.contactNumber || 'N/A'}</td>
        <td>$${locked.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td><strong class="text-green">$${available.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
        <td>
          <button class="btn-secondary-sm" onclick="adminCreditBonus('${u.username}', 2)">
            <i class="fa-solid fa-plus-circle text-green"></i> +$2 Bonus
          </button>
          <button class="btn-secondary-sm" onclick="adminCreditCustomBonus('${u.username}')">
            Custom
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    if (totalUsers === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4">No user accounts created yet.</td></tr>`;
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
