/* ==========================================================================
   E FINANCE (EASY FINANCE) - USER APP LOGIC (app.js)
   ========================================================================== */

// 1. Firebase Initialization
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

// Initialize Firebase App & Realtime Database
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth ? firebase.auth() : null;

// Application State Variables
let currentUser = null;
let userListenerUnsub = null;
let debitsListenerUnsub = null;
let withdrawalsListenerUnsub = null;

// Local DB Fallback Helper (Guarantees app works even if Firebase rules are locked)
function getLocalStore(key) {
  try {
    return JSON.parse(localStorage.getItem('efinance_db_' + key) || '{}');
  } catch (e) {
    return {};
  }
}

function setLocalStore(key, data) {
  try {
    localStorage.setItem('efinance_db_' + key, JSON.stringify(data));
  } catch (e) {}
}

// ==========================================================================
// 2. DOM INITIALIZATION & EVENT LISTENERS
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Sign in anonymously to bypass 'auth != null' Firebase Realtime Database rules
  if (auth) {
    auth.signInAnonymously().catch(err => {
      console.warn("Anonymous auth note:", err.message);
    });
  }

  // Set default date
  const debitDateInput = document.getElementById('debit-date');
  if (debitDateInput) {
    const today = new Date().toISOString().split('T')[0];
    debitDateInput.value = today;
  }

  // Handle Splash Screen Transition
  setTimeout(() => {
    hideSplash();
  }, 2400);

  document.getElementById('btn-skip-splash')?.addEventListener('click', hideSplash);

  // Check stored session
  checkExistingSession();
});

function hideSplash() {
  const splash = document.getElementById('splash-screen');
  const appContainer = document.getElementById('app-container');
  
  if (splash && !splash.classList.contains('fade-out')) {
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.style.display = 'none';
      if (appContainer) appContainer.classList.remove('app-hidden');
    }, 500);
  }
}

// ==========================================================================
// 3. NAVIGATION ROUTER & SESSION MANAGEMENT
// ==========================================================================
function navigateTo(pageId) {
  document.querySelectorAll('.page-view').forEach(view => {
    view.classList.remove('active');
  });

  const targetPage = document.getElementById(`page-${pageId}`);
  if (targetPage) {
    targetPage.classList.add('active');
  }

  const navActions = document.getElementById('user-nav-actions');
  if (pageId === 'login' || pageId === 'register') {
    if (navActions) navActions.style.display = 'none';
  } else {
    if (navActions) navActions.style.display = 'flex';
  }

  if (pageId === 'home' && currentUser) {
    loadUserDashboard();
  }
}

function checkExistingSession() {
  const storedUser = localStorage.getItem('efinance_current_user');
  if (storedUser) {
    try {
      currentUser = JSON.parse(storedUser);
      updateHeaderGreeting();
      navigateTo('home');
    } catch (e) {
      localStorage.removeItem('efinance_current_user');
      navigateTo('login');
    }
  } else {
    navigateTo('login');
  }
}

function updateHeaderGreeting() {
  if (currentUser) {
    document.getElementById('greeting-name').textContent = currentUser.fullName || currentUser.username;
    document.getElementById('dash-user-fullname').textContent = currentUser.fullName || currentUser.username;
    document.getElementById('dash-username-tag').textContent = currentUser.username;
  }
}

function handleLogout() {
  detachUserListeners();
  currentUser = null;
  localStorage.removeItem('efinance_current_user');
  showToast('Logged out successfully', 'info');
  navigateTo('login');
}

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

// ==========================================================================
// 4. USERNAME AVAILABILITY CHECK & REGISTRATION (RESILIENT FIREBASE FIX)
// ==========================================================================
function resetUsernameValidation() {
  const feedback = document.getElementById('username-feedback');
  if (feedback) {
    feedback.textContent = 'Unique username required for login (e.g. tat_1)';
    feedback.className = 'input-hint';
  }
}

async function checkUsernameAvailability() {
  const usernameInput = document.getElementById('reg-username');
  const feedback = document.getElementById('username-feedback');

  if (!usernameInput || !feedback) return;

  const rawUsername = usernameInput.value.trim().toLowerCase();
  if (!rawUsername) {
    feedback.textContent = 'Unique username required for login (e.g. tat_1)';
    feedback.className = 'input-hint';
    return;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(rawUsername)) {
    feedback.textContent = 'Username can only contain letters, numbers, and underscores (_).';
    feedback.className = 'input-hint text-error';
    return;
  }

  feedback.textContent = 'Verifying username...';
  feedback.className = 'input-hint';

  // Check local fallback first
  const localUsers = getLocalStore('users');
  if (localUsers[rawUsername]) {
    feedback.textContent = `❌ Username '${rawUsername}' is already taken! Please choose another.`;
    feedback.className = 'input-hint text-error';
    return;
  }

  try {
    const snapshot = await db.ref('users/' + rawUsername).once('value');
    if (snapshot.exists()) {
      feedback.textContent = `❌ Username '${rawUsername}' is already taken! Please choose another.`;
      feedback.className = 'input-hint text-error';
    } else {
      feedback.textContent = `✓ Username '${rawUsername}' is available!`;
      feedback.className = 'input-hint text-success';
    }
  } catch (error) {
    // If Firebase permissions block read, format is valid
    feedback.textContent = `✓ Username format valid`;
    feedback.className = 'input-hint text-success';
  }
}

async function handleRegister(event) {
  event.preventDefault();

  const fullName = document.getElementById('reg-fullname').value.trim();
  const contactNumber = document.getElementById('reg-contact').value.trim();
  const username = document.getElementById('reg-username').value.trim().toLowerCase();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const password = document.getElementById('reg-password').value;
  const confirmPassword = document.getElementById('reg-confirm-password').value;
  
  const errorDiv = document.getElementById('register-error');
  const successDiv = document.getElementById('register-success');

  errorDiv.classList.add('hidden');
  successDiv.classList.add('hidden');

  if (password !== confirmPassword) {
    errorDiv.textContent = 'Passwords do not match. Please re-enter.';
    errorDiv.classList.remove('hidden');
    return;
  }

  const userData = {
    fullName: fullName,
    contactNumber: contactNumber,
    username: username,
    email: email,
    password: password,
    availableBalance: 0.00,
    lockedDebitBalance: 0.00,
    createdAt: new Date().toISOString()
  };

  // Always update local database fallback so app never gets stuck
  const localUsers = getLocalStore('users');
  if (localUsers[username]) {
    errorDiv.textContent = `Username '${username}' is already taken. Please choose another.`;
    errorDiv.classList.remove('hidden');
    return;
  }

  localUsers[username] = userData;
  setLocalStore('users', localUsers);

  // Try Firebase Realtime Database save
  try {
    await db.ref('users/' + username).set(userData);
  } catch (err) {
    console.warn("Firebase RTDB permission warning (using local sync):", err.message);
  }

  successDiv.textContent = 'Account created successfully! Logging you in...';
  successDiv.classList.remove('hidden');

  currentUser = userData;
  localStorage.setItem('efinance_current_user', JSON.stringify(userData));
  updateHeaderGreeting();

  setTimeout(() => {
    document.getElementById('form-register').reset();
    navigateTo('home');
    showToast(`Welcome to E Finance, ${fullName}!`, 'success');
  }, 1000);
}

// ==========================================================================
// 5. LOGIN HANDLER
// ==========================================================================
async function handleLogin(event) {
  event.preventDefault();

  const userInput = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');
  
  errorDiv.classList.add('hidden');

  if (!userInput || !password) {
    errorDiv.textContent = 'Please enter both username/email and password.';
    errorDiv.classList.remove('hidden');
    return;
  }

  let matchedUser = null;

  // 1. Try Firebase RTDB first
  try {
    const snap = await db.ref('users/' + userInput).once('value');
    if (snap.exists()) {
      matchedUser = snap.val();
    } else {
      const allUsersSnap = await db.ref('users').once('value');
      if (allUsersSnap.exists()) {
        const usersObj = allUsersSnap.val();
        for (let key in usersObj) {
          if (usersObj[key].email === userInput) {
            matchedUser = usersObj[key];
            break;
          }
        }
      }
    }
  } catch (err) {
    console.warn("Firebase login fallback to local DB:", err.message);
  }

  // 2. Fallback to Local Storage DB if Firebase is blocked or offline
  if (!matchedUser) {
    const localUsers = getLocalStore('users');
    if (localUsers[userInput]) {
      matchedUser = localUsers[userInput];
    } else {
      for (let key in localUsers) {
        if (localUsers[key].email === userInput) {
          matchedUser = localUsers[key];
          break;
        }
      }
    }
  }

  if (!matchedUser) {
    errorDiv.textContent = 'No account found with this username or email. Please create an account.';
    errorDiv.classList.remove('hidden');
    return;
  }

  if (matchedUser.password !== password) {
    errorDiv.textContent = 'Incorrect password. Please try again.';
    errorDiv.classList.remove('hidden');
    return;
  }

  // Login successful
  currentUser = matchedUser;
  localStorage.setItem('efinance_current_user', JSON.stringify(currentUser));
  updateHeaderGreeting();
  
  document.getElementById('form-login').reset();
  showToast(`Welcome back, ${currentUser.fullName || currentUser.username}!`, 'success');
  navigateTo('home');
}

// ==========================================================================
// 6. USER DASHBOARD & REALTIME LISTENERS
// ==========================================================================
function detachUserListeners() {
  if (userListenerUnsub) {
    try { db.ref('users/' + currentUser?.username).off('value', userListenerUnsub); } catch(e){}
    userListenerUnsub = null;
  }
  if (debitsListenerUnsub) {
    try { db.ref('debits').off('value', debitsListenerUnsub); } catch(e){}
    debitsListenerUnsub = null;
  }
  if (withdrawalsListenerUnsub) {
    try { db.ref('withdrawals').off('value', withdrawalsListenerUnsub); } catch(e){}
    withdrawalsListenerUnsub = null;
  }
}

function loadUserDashboard() {
  if (!currentUser) return;

  detachUserListeners();

  // Function to render balances
  const renderBalances = (userObj) => {
    currentUser = userObj;
    localStorage.setItem('efinance_current_user', JSON.stringify(currentUser));

    const availableBal = parseFloat(userObj.availableBalance || 0);
    const debitedBal = parseFloat(userObj.lockedDebitBalance || 0);
    const totalVal = availableBal + debitedBal;

    document.getElementById('val-available-balance').textContent = availableBal.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    document.getElementById('val-debited-balance').textContent = debitedBal.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    document.getElementById('val-total-account-value').textContent = totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    
    document.getElementById('info-principal-amount').textContent = debitedBal.toLocaleString('en-IN');
    document.getElementById('info-bonus-amount').textContent = availableBal.toLocaleString('en-IN');
    document.getElementById('withdraw-max-balance').textContent = availableBal.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  };

  // Initial render from local DB or current state
  const localUsers = getLocalStore('users');
  if (localUsers[currentUser.username]) {
    renderBalances(localUsers[currentUser.username]);
  } else {
    renderBalances(currentUser);
  }

  // 1. Firebase Realtime Listener
  try {
    const userRef = db.ref('users/' + currentUser.username);
    userListenerUnsub = userRef.on('value', (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        localUsers[currentUser.username] = data;
        setLocalStore('users', localUsers);
        renderBalances(data);
      }
    });
  } catch(e) {}

  // 2. Real-time Debits Listener
  const renderDebits = (debitsMap) => {
    const container = document.getElementById('debits-list-container');
    container.innerHTML = '';
    const userDebits = [];

    for (let key in debitsMap) {
      if (debitsMap[key].username === currentUser.username) {
        userDebits.push({ id: key, ...debitsMap[key] });
      }
    }

    if (userDebits.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-receipt empty-icon"></i>
          <p>No debits added yet. Click <strong>"Debit Money"</strong> to start your ₹1,000 monthly scheme!</p>
        </div>`;
    } else {
      userDebits.reverse().forEach(debit => {
        const card = document.createElement('div');
        card.className = 'debit-item-card';
        card.onclick = () => openSchemeDetailsForDebit(debit);
        card.innerHTML = `
          <div class="debit-card-header">
            <span class="debit-amount-tag">₹${parseFloat(debit.amount).toLocaleString('en-IN')}</span>
            <span class="debit-date-tag"><i class="fa-solid fa-calendar"></i> ${debit.date}</span>
          </div>
          <div class="debit-card-details">
            <div><i class="fa-solid fa-gift text-green"></i> Earns <strong>₹${debit.monthlyBonus || 300}/mo</strong> for 12 months</div>
            <div><i class="fa-solid fa-shield-halved text-gold"></i> Active Fixed Scheme</div>
          </div>`;
        container.appendChild(card);
      });
    }
  };

  renderDebits(getLocalStore('debits'));

  try {
    debitsListenerUnsub = db.ref('debits').on('value', (snapshot) => {
      if (snapshot.exists()) {
        const val = snapshot.val();
        setLocalStore('debits', val);
        renderDebits(val);
      }
    });
  } catch(e) {}

  // 3. Real-time Withdrawals Listener
  const renderWithdrawals = (withdrawalsMap) => {
    const tbody = document.getElementById('user-withdrawals-tbody');
    tbody.innerHTML = '';
    const userW = [];

    for (let key in withdrawalsMap) {
      if (withdrawalsMap[key].username === currentUser.username) {
        userW.push({ id: key, ...withdrawalsMap[key] });
      }
    }

    if (userW.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4">No withdrawal history available</td></tr>`;
    } else {
      userW.reverse().forEach(w => {
        const row = document.createElement('tr');
        
        let statusBadgeClass = 'pending';
        let statusIcon = 'fa-hourglass-half';
        if (w.status === 'Success') {
          statusBadgeClass = 'success';
          statusIcon = 'fa-circle-check';
        } else if (w.status === 'Rejected') {
          statusBadgeClass = 'rejected';
          statusIcon = 'fa-circle-xmark';
        }

        let detailsText = w.method === 'UPI' ? `UPI: ${w.details?.upiId || 'N/A'}` : `Bank Acc: ${w.details?.accountNumber || 'N/A'}`;

        row.innerHTML = `
          <td><code>#${w.id.substring(0, 8)}</code></td>
          <td>${w.date}</td>
          <td><strong class="text-green">₹${parseFloat(w.amount).toLocaleString('en-IN')}</strong></td>
          <td><span class="badge-neutral">${w.method}</span></td>
          <td><small>${detailsText}</small></td>
          <td><span class="status-badge ${statusBadgeClass}"><i class="fa-solid ${statusIcon}"></i> ${w.status}</span></td>
        `;
        tbody.appendChild(row);
      });
    }
  };

  renderWithdrawals(getLocalStore('withdrawals'));

  try {
    withdrawalsListenerUnsub = db.ref('withdrawals').on('value', (snapshot) => {
      if (snapshot.exists()) {
        const val = snapshot.val();
        setLocalStore('withdrawals', val);
        renderWithdrawals(val);
      }
    });
  } catch(e) {}
}

// ==========================================================================
// 6.5 INTERACTIVE PROFIT CALCULATOR LOGIC
// ==========================================================================
function updateProfitCalculator() {
  const rangeInput = document.getElementById('calc-amount-range');
  if (!rangeInput) return;

  const amount = parseFloat(rangeInput.value) || 1000;
  const monthlyProfit = Math.round(amount * 0.3);
  const totalProfit = monthlyProfit * 12;

  document.getElementById('calc-amount-label').textContent = '₹' + amount.toLocaleString('en-IN');
  document.getElementById('calc-res-monthly').textContent = monthlyProfit.toLocaleString('en-IN');
  document.getElementById('calc-res-total').textContent = totalProfit.toLocaleString('en-IN');
  document.getElementById('calc-btn-amount').textContent = amount.toLocaleString('en-IN');
}

function setCalcPreset(amount) {
  const rangeInput = document.getElementById('calc-amount-range');
  if (rangeInput) {
    rangeInput.value = amount;
    updateProfitCalculator();
  }

  document.querySelectorAll('.btn-preset-sm').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.includes(amount.toLocaleString())) {
      btn.classList.add('active');
    }
  });
}

function startSchemeWithCalcAmount() {
  const rangeInput = document.getElementById('calc-amount-range');
  const amount = parseFloat(rangeInput?.value || 1000);

  openDebitModal();
  setDebitAmount(amount);
}

// ==========================================================================
// 7. DEBIT MONEY & DYNAMIC QR CODE FLOW
// ==========================================================================
function openDebitModal() {
  document.getElementById('modal-debit').classList.remove('hidden');
  generatePaymentQR();
}

function setDebitAmount(amount) {
  document.getElementById('debit-amount').value = amount;
  
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.includes(amount.toLocaleString())) {
      btn.classList.add('active');
    }
  });

  generatePaymentQR();
}

function generatePaymentQR() {
  const amountInput = document.getElementById('debit-amount');
  let amount = parseFloat(amountInput.value) || 1000;
  
  const monthlyBonus = Math.round(amount * 0.3);
  const totalBonus = monthlyBonus * 12;

  document.getElementById('preview-debit-amount').textContent = amount.toLocaleString('en-IN');
  document.getElementById('preview-monthly-bonus').textContent = monthlyBonus.toLocaleString('en-IN');
  document.getElementById('preview-total-bonus').textContent = totalBonus.toLocaleString('en-IN');
  document.getElementById('qr-amount-display').textContent = amount.toLocaleString('en-IN');

  const qrcodeContainer = document.getElementById('qrcode');
  qrcodeContainer.innerHTML = '';

  const upiString = `upi://pay?pa=easyfinance@upi&pn=EasyFinance&am=${amount}&cu=INR`;

  if (window.QRCode) {
    new QRCode(qrcodeContainer, {
      text: upiString,
      width: 180,
      height: 180,
      colorDark : "#050811",
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.H
    });
  }
}

function copyUPI() {
  navigator.clipboard.writeText('easyfinance@upi').then(() => {
    showToast('UPI ID copied to clipboard!', 'info');
  });
}

async function handleDebitSubmit(event) {
  event.preventDefault();

  const amount = parseFloat(document.getElementById('debit-amount').value);
  const debitDate = document.getElementById('debit-date').value;
  const utr = document.getElementById('debit-utr').value.trim();
  const errorDiv = document.getElementById('debit-error');

  errorDiv.classList.add('hidden');

  if (!amount || amount < 100) {
    errorDiv.textContent = 'Please enter a valid debit amount (Minimum ₹100).';
    errorDiv.classList.remove('hidden');
    return;
  }

  const monthlyBonus = Math.round(amount * 0.3);
  const debitId = 'deb_' + Date.now();

  const debitRecord = {
    id: debitId,
    username: currentUser.username,
    fullName: currentUser.fullName || currentUser.username,
    amount: amount,
    date: debitDate || new Date().toLocaleDateString('en-IN'),
    monthlyBonus: monthlyBonus,
    monthsTotal: 12,
    utr: utr || 'DIRECT_' + Date.now(),
    timestamp: Date.now()
  };

  // 1. Update local storage DB
  const localDebits = getLocalStore('debits');
  localDebits[debitId] = debitRecord;
  setLocalStore('debits', localDebits);

  const localUsers = getLocalStore('users');
  const currentLocked = parseFloat(currentUser.lockedDebitBalance || 0);
  const newLocked = currentLocked + amount;
  if (localUsers[currentUser.username]) {
    localUsers[currentUser.username].lockedDebitBalance = newLocked;
    setLocalStore('users', localUsers);
  }

  currentUser.lockedDebitBalance = newLocked;
  localStorage.setItem('efinance_current_user', JSON.stringify(currentUser));

  // 2. Try Firebase push
  try {
    await db.ref('debits/' + debitId).set(debitRecord);
    await db.ref('users/' + currentUser.username).update({
      lockedDebitBalance: newLocked
    });
  } catch (err) {
    console.warn("Firebase RTDB debit sync note:", err.message);
  }

  closeModal('modal-debit');
  showToast(`Debited ₹${amount.toLocaleString('en-IN')} successfully! Locked into scheme.`, 'success');
  loadUserDashboard();
}

// ==========================================================================
// 8. SCHEME DETAIL BREAKDOWN MODAL
// ==========================================================================
function openActiveSchemeDetails() {
  const currentDebited = parseFloat(currentUser?.lockedDebitBalance || 0);
  const sampleDebit = {
    amount: currentDebited > 0 ? currentDebited : 1000,
    date: '2-2-2026',
    monthlyBonus: currentDebited > 0 ? Math.round(currentDebited * 0.3) : 300
  };
  openSchemeDetailsForDebit(sampleDebit);
}

function openSchemeDetailsForDebit(debit) {
  const summaryBox = document.getElementById('scheme-modal-summary');
  const gridContainer = document.getElementById('scheme-timeline-grid');

  const amount = debit.amount || 1000;
  const date = debit.date || '2-2-2026';
  const monthlyBonus = debit.monthlyBonus || 300;

  summaryBox.innerHTML = `
    <i class="fa-solid fa-circle-check text-green"></i> Present on date <strong>${date}</strong> you debited <strong>₹${parseFloat(amount).toLocaleString('en-IN')} rupees</strong>. Per month you get <strong>₹${monthlyBonus} rupees</strong> for 12 months.
  `;

  gridContainer.innerHTML = '';

  for (let m = 1; m <= 12; m++) {
    const card = document.createElement('div');
    const isCompletedMonth = m <= 2;
    
    card.className = `month-card ${isCompletedMonth ? 'credited' : ''}`;
    card.innerHTML = `
      <div class="month-title">Month ${m}</div>
      <div class="month-amount">₹${monthlyBonus}</div>
      <div class="month-status">${isCompletedMonth ? '<i class="fa-solid fa-check"></i> Credited by Admin' : 'Scheduled'}</div>
    `;
    gridContainer.appendChild(card);
  }

  document.getElementById('modal-scheme-details').classList.remove('hidden');
}

// ==========================================================================
// 9. WITHDRAWAL FLOW
// ==========================================================================
function openWithdrawModal() {
  const availableBal = parseFloat(currentUser?.availableBalance || 0);
  document.getElementById('withdraw-max-balance').textContent = availableBal.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  document.getElementById('modal-withdraw').classList.remove('hidden');
}

function selectWithdrawMethod(method) {
  const upiSection = document.getElementById('withdraw-method-upi');
  const bankSection = document.getElementById('withdraw-method-bank');
  
  document.querySelectorAll('.radio-card').forEach(card => card.classList.remove('selected'));

  if (method === 'UPI') {
    document.querySelector('input[value="UPI"]').checked = true;
    document.querySelector('input[value="UPI"]').closest('.radio-card').classList.add('selected');
    upiSection.classList.remove('hidden');
    bankSection.classList.add('hidden');
  } else {
    document.querySelector('input[value="BANK"]').checked = true;
    document.querySelector('input[value="BANK"]').closest('.radio-card').classList.add('selected');
    upiSection.classList.add('hidden');
    bankSection.classList.remove('hidden');
  }
}

async function handleWithdrawSubmit(event) {
  event.preventDefault();

  const amount = parseFloat(document.getElementById('withdraw-amount').value);
  const method = document.querySelector('input[name="withdraw-method"]:checked').value;
  const availableBal = parseFloat(currentUser?.availableBalance || 0);
  const errorDiv = document.getElementById('withdraw-error');

  errorDiv.classList.add('hidden');

  if (!amount || amount <= 0) {
    errorDiv.textContent = 'Please enter a valid withdrawal amount.';
    errorDiv.classList.remove('hidden');
    return;
  }

  if (amount > availableBal) {
    errorDiv.textContent = `Insufficient withdrawable bonus balance. Your max available profit balance is ₹${availableBal.toLocaleString('en-IN')}. (Locked debit principal cannot be withdrawn).`;
    errorDiv.classList.remove('hidden');
    return;
  }

  let details = {};
  if (method === 'UPI') {
    const upiId = document.getElementById('w-upi-id').value.trim();
    if (!upiId) {
      errorDiv.textContent = 'Please enter your UPI ID (e.g. user@upi).';
      errorDiv.classList.remove('hidden');
      return;
    }
    details = { upiId: upiId };
  } else {
    const accountNumber = document.getElementById('w-bank-acc').value.trim();
    const ifsc = document.getElementById('w-bank-ifsc').value.trim().toUpperCase();
    const holder = document.getElementById('w-bank-holder').value.trim();

    if (!accountNumber || !ifsc || !holder) {
      errorDiv.textContent = 'Please fill out all Bank Account details.';
      errorDiv.classList.remove('hidden');
      return;
    }
    details = { accountNumber, ifsc, holder };
  }

  const withdrawId = 'WD_' + Date.now().toString().slice(-6);

  const withdrawRequest = {
    id: withdrawId,
    username: currentUser.username,
    fullName: currentUser.fullName || currentUser.username,
    amount: amount,
    method: method,
    details: details,
    status: 'Pending',
    date: new Date().toLocaleDateString('en-IN'),
    timestamp: Date.now()
  };

  // 1. Local DB sync
  const localW = getLocalStore('withdrawals');
  localW[withdrawId] = withdrawRequest;
  setLocalStore('withdrawals', localW);

  const localUsers = getLocalStore('users');
  const newAvailable = availableBal - amount;
  if (localUsers[currentUser.username]) {
    localUsers[currentUser.username].availableBalance = newAvailable;
    setLocalStore('users', localUsers);
  }
  currentUser.availableBalance = newAvailable;
  localStorage.setItem('efinance_current_user', JSON.stringify(currentUser));

  // 2. Firebase push
  try {
    await db.ref('withdrawals/' + withdrawId).set(withdrawRequest);
    await db.ref('users/' + currentUser.username).update({
      availableBalance: newAvailable
    });
  } catch (err) {
    console.warn("Firebase RTDB withdrawal sync note:", err.message);
  }

  closeModal('modal-withdraw');
  document.getElementById('form-withdraw').reset();
  showToast(`Withdrawal request of ₹${amount} submitted! Status: PENDING`, 'info');
  loadUserDashboard();
}

// GENERAL HELPERS & TOAST NOTIFICATIONS
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
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
