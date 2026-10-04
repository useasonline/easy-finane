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
// Helper to ensure Firebase Auth connection before DB calls
async function ensureFirebaseAuth() {
  if (auth && !auth.currentUser) {
    try {
      await auth.signInAnonymously();
    } catch (err) {
      console.warn("Auth sign-in note:", err.message);
    }
  }
}

// ==========================================================================
// 2. DOM INITIALIZATION & EVENT LISTENERS
// ==========================================================================
// Fetch live USD to INR exchange rate from public rate API
async function fetchLiveUsdRate() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    if (data && data.rates && data.rates.INR) {
      const inrRate = parseFloat(data.rates.INR).toFixed(2);
      const rateEl = document.getElementById('live-usd-inr-val');
      if (rateEl) rateEl.textContent = inrRate;
    }
  } catch (e) {
    console.log("Live USD Rate note:", e.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Firebase Auth connection asynchronously
  ensureFirebaseAuth();
  
  // Fetch live market USD to INR exchange rate
  fetchLiveUsdRate();

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
// 4. USERNAME AVAILABILITY CHECK & REGISTRATION (FIREBASE GUARANTEED)
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
    resetUsernameValidation();
    return;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(rawUsername)) {
    feedback.textContent = 'Username can only contain letters, numbers, and underscores (_).';
    feedback.className = 'input-hint text-error';
    return;
  }

  feedback.textContent = 'Verifying username...';
  feedback.className = 'input-hint';

  try {
    await ensureFirebaseAuth();
    const snapshot = await db.ref('users/' + rawUsername).once('value');
    if (snapshot.exists()) {
      feedback.textContent = `❌ Username '@${rawUsername}' is already taken! Please choose another.`;
      feedback.className = 'input-hint text-error';
    } else {
      const localUsers = getLocalStore('users');
      if (localUsers[rawUsername]) {
        feedback.textContent = `❌ Username '@${rawUsername}' is already taken! Please choose another.`;
        feedback.className = 'input-hint text-error';
      } else {
        feedback.textContent = `✓ Username '@${rawUsername}' is available!`;
        feedback.className = 'input-hint text-success';
      }
    }
  } catch (error) {
    feedback.textContent = `✓ Username format valid`;
    feedback.className = 'input-hint text-success';
  }
}

async function handleRegister(event) {
  event.preventDefault();

  const submitBtn = document.getElementById('btn-submit-register');
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

  if (!fullName || !contactNumber || !username || !email || !password) {
    errorDiv.textContent = 'Please fill out all required fields.';
    errorDiv.classList.remove('hidden');
    return;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    errorDiv.textContent = 'Username can only contain letters, numbers, and underscores (_).';
    errorDiv.classList.remove('hidden');
    return;
  }

  if (password.length < 6) {
    errorDiv.textContent = 'Password must be at least 6 characters long.';
    errorDiv.classList.remove('hidden');
    return;
  }

  if (password !== confirmPassword) {
    errorDiv.textContent = 'Passwords do not match. Please re-enter.';
    errorDiv.classList.remove('hidden');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving Account to Firebase Database...';
  }

  try {
    await ensureFirebaseAuth();

    // 1. Register with Firebase Authentication if available
    if (auth) {
      try {
        await auth.createUserWithEmailAndPassword(email, password);
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-in-use') {
          errorDiv.textContent = `Email '${email}' is already registered. Please login instead.`;
          errorDiv.classList.remove('hidden');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-user-check"></i> Create Account';
          }
          return;
        }
        console.warn("Firebase Auth create note:", authErr.message);
      }
    }

    // 2. Check if Username already exists in Firebase RTDB
    let usernameExists = false;
    try {
      const uSnap = await db.ref('users/' + username).once('value');
      if (uSnap.exists()) {
        usernameExists = true;
      }
    } catch (e) {
      console.warn("RTDB username check note:", e.message);
    }

    if (!usernameExists) {
      const localUsers = getLocalStore('users');
      if (localUsers[username]) usernameExists = true;
    }

    if (usernameExists) {
      errorDiv.textContent = `Username '@${username}' is already taken. Please choose another username.`;
      errorDiv.classList.remove('hidden');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-user-check"></i> Create Account';
      }
      return;
    }

    // 3. Check if Email already exists in Firebase RTDB
    let emailExists = false;
    try {
      const allUsersSnap = await db.ref('users').once('value');
      if (allUsersSnap.exists()) {
        const usersObj = allUsersSnap.val();
        for (let k in usersObj) {
          if (usersObj[k].email && usersObj[k].email.toLowerCase() === email) {
            emailExists = true;
            break;
          }
        }
      }
    } catch (e) {
      console.warn("RTDB email check note:", e.message);
    }

    if (emailExists) {
      errorDiv.textContent = `Email '${email}' is already registered. Please login or use another email.`;
      errorDiv.classList.remove('hidden');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-user-check"></i> Create Account';
      }
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

    // 4. MUST WRITE TO FIREBASE REALTIME DATABASE TO GUARANTEE CLOUD ACCESS
    await db.ref('users/' + username).set(userData);

    // Save local copy for cache
    const localUsers = getLocalStore('users');
    localUsers[username] = userData;
    setLocalStore('users', localUsers);

    successDiv.textContent = '✓ Account successfully saved to Firebase Database! Logging you in...';
    successDiv.classList.remove('hidden');

    currentUser = userData;
    localStorage.setItem('efinance_current_user', JSON.stringify(userData));
    updateHeaderGreeting();

    setTimeout(() => {
      document.getElementById('form-register').reset();
      resetUsernameValidation();
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-user-check"></i> Create Account';
      }
      navigateTo('home');
      showToast(`Welcome to E Finance, ${fullName}! Your account can now be accessed on any device.`, 'success');
    }, 1000);

  } catch (err) {
    console.error("Firebase registration error:", err);
    let errMsg = err.message || 'Could not connect to Firebase database.';
    if (err.code === 'PERMISSION_DENIED' || errMsg.includes('PERMISSION_DENIED') || errMsg.includes('Permission denied')) {
      errMsg = 'Firebase Database Permission Denied. Please ensure your Firebase Realtime Database Security Rules allow read/write access (e.g., { ".read": true, ".write": true }).';
    }

    errorDiv.textContent = `❌ Database Error: ${errMsg}`;
    errorDiv.classList.remove('hidden');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-user-check"></i> Create Account';
    }
  }
}

// ==========================================================================
// 5. LOGIN HANDLER (CROSS-DEVICE FIREBASE SYNCED)
// ==========================================================================
async function handleLogin(event) {
  event.preventDefault();

  const userInput = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');
  const submitBtn = event.target.querySelector('button[type="submit"]');
  
  errorDiv.classList.add('hidden');

  if (!userInput || !password) {
    errorDiv.textContent = 'Please enter both username/email and password.';
    errorDiv.classList.remove('hidden');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Logging in...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
  }

  try {
    await ensureFirebaseAuth();

    // Try signing in via Firebase Auth if userInput is email
    if (auth && userInput.includes('@')) {
      try {
        await auth.signInWithEmailAndPassword(userInput, password);
      } catch (authErr) {
        console.warn("Auth signInWithEmailAndPassword note:", authErr.message);
      }
    }

    let matchedUser = null;

    // 1. If userInput is a simple username (no invalid path characters like . or @), try direct key lookup
    const isValidPathKey = /^[a-zA-Z0-9_]+$/.test(userInput);
    if (isValidPathKey) {
      try {
        const snap = await db.ref('users/' + userInput).once('value');
        if (snap.exists()) {
          matchedUser = snap.val();
        }
      } catch (err) {
        console.warn("Direct key lookup note:", err.message);
      }
    }

    // 2. If not found by key, search Firebase RTDB across all users (by email or username)
    if (!matchedUser) {
      try {
        const allUsersSnap = await db.ref('users').once('value');
        if (allUsersSnap.exists()) {
          const usersObj = allUsersSnap.val();
          for (let key in usersObj) {
            const u = usersObj[key];
            if (u.username.toLowerCase() === userInput || (u.email && u.email.toLowerCase() === userInput)) {
              matchedUser = u;
              break;
            }
          }
        }
      } catch (err) {
        console.warn("All users scan note:", err.message);
      }
    }

    // 3. Fallback to Local Storage DB if Firebase is offline
    if (!matchedUser) {
      const localUsers = getLocalStore('users');
      if (localUsers[userInput]) {
        matchedUser = localUsers[userInput];
      } else {
        for (let key in localUsers) {
          const u = localUsers[key];
          if (u.username.toLowerCase() === userInput || (u.email && u.email.toLowerCase() === userInput)) {
            matchedUser = u;
            break;
          }
        }
      }
    }

    if (!matchedUser) {
      errorDiv.textContent = `No account found with username or email '${userInput}'. Please create an account.`;
      errorDiv.classList.remove('hidden');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Login to Account</span> <i class="fa-solid fa-arrow-right"></i>';
      }
      return;
    }

    if (matchedUser.password !== password) {
      errorDiv.textContent = 'Incorrect password. Please try again.';
      errorDiv.classList.remove('hidden');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Login to Account</span> <i class="fa-solid fa-arrow-right"></i>';
      }
      return;
    }

    // Login successful
    currentUser = matchedUser;
    localStorage.setItem('efinance_current_user', JSON.stringify(currentUser));

    // Cache user to local storage
    const localUsers = getLocalStore('users');
    localUsers[matchedUser.username] = matchedUser;
    setLocalStore('users', localUsers);

    updateHeaderGreeting();
    document.getElementById('form-login').reset();

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Login to Account</span> <i class="fa-solid fa-arrow-right"></i>';
    }

    showToast(`Welcome back, ${currentUser.fullName || currentUser.username}!`, 'success');
    navigateTo('home');

  } catch (err) {
    console.error("Login error:", err);
    errorDiv.textContent = 'An error occurred during login. Please check connection and try again.';
    errorDiv.classList.remove('hidden');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Login to Account</span> <i class="fa-solid fa-arrow-right"></i>';
    }
  }
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

    document.getElementById('val-available-balance').textContent = availableBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('val-debited-balance').textContent = debitedBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('val-total-account-value').textContent = totalVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
    document.getElementById('info-principal-amount').textContent = debitedBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('info-bonus-amount').textContent = availableBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('withdraw-max-balance').textContent = availableBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
          <p>No debits added yet. Click <strong>"Debit Money"</strong> to start your $10 monthly scheme!</p>
        </div>`;
    } else {
      userDebits.reverse().forEach(debit => {
        const card = document.createElement('div');
        card.className = 'debit-item-card';
        card.onclick = () => openSchemeDetailsForDebit(debit);
        card.innerHTML = `
          <div class="debit-card-header">
            <span class="debit-amount-tag">$${parseFloat(debit.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            <span class="debit-date-tag"><i class="fa-solid fa-calendar"></i> ${debit.date}</span>
          </div>
          <div class="debit-card-details">
            <div><i class="fa-solid fa-gift text-green"></i> Earns <strong>$${debit.monthlyBonus || 2}/mo</strong> for 12 months</div>
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
          <td><strong class="text-green">$${parseFloat(w.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
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

  const inrAmount = parseFloat(rangeInput.value) || 1000;
  const usdAmount = parseFloat((inrAmount / 100).toFixed(2));
  const monthlyProfit = parseFloat((usdAmount * 0.2).toFixed(2));
  const totalProfit = parseFloat((monthlyProfit * 12).toFixed(2));

  const amountLabel = document.getElementById('calc-amount-label');
  if (amountLabel) amountLabel.textContent = '₹' + inrAmount.toLocaleString('en-IN');

  const resUsd = document.getElementById('calc-res-usd');
  if (resUsd) resUsd.textContent = usdAmount.toLocaleString('en-US', { minimumFractionDigits: 2 });

  const resMonthly = document.getElementById('calc-res-monthly');
  if (resMonthly) resMonthly.textContent = monthlyProfit.toLocaleString('en-US', { minimumFractionDigits: 2 });

  const resTotal = document.getElementById('calc-res-total');
  if (resTotal) resTotal.textContent = totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2 });

  const btnAmount = document.getElementById('calc-btn-amount');
  if (btnAmount) btnAmount.textContent = inrAmount.toLocaleString('en-IN');

  const btnUsd = document.getElementById('calc-btn-usd');
  if (btnUsd) btnUsd.textContent = usdAmount.toLocaleString('en-US', { minimumFractionDigits: 2 });
}

function setCalcPreset(inrAmount) {
  const rangeInput = document.getElementById('calc-amount-range');
  if (rangeInput) {
    rangeInput.value = inrAmount;
    updateProfitCalculator();
  }

  document.querySelectorAll('.btn-preset-sm').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.includes('₹' + inrAmount.toLocaleString('en-IN')) || btn.textContent.includes(inrAmount.toString())) {
      btn.classList.add('active');
    }
  });
}

function startSchemeWithCalcAmount() {
  const rangeInput = document.getElementById('calc-amount-range');
  const inrAmount = parseFloat(rangeInput?.value || 1000);

  openDebitModal();
  setDebitAmount(inrAmount);
}

// ==========================================================================
// 7. DEBIT MONEY & DYNAMIC QR CODE FLOW
// ==========================================================================
function openDebitModal() {
  document.getElementById('modal-debit').classList.remove('hidden');
  generatePaymentQR();
}

function setDebitAmount(inrAmount) {
  const debitInput = document.getElementById('debit-amount');
  if (debitInput) debitInput.value = inrAmount;
  
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.includes('₹' + inrAmount.toLocaleString('en-IN')) || btn.textContent.includes(inrAmount.toString())) {
      btn.classList.add('active');
    }
  });

  generatePaymentQR();
}

function generatePaymentQR() {
  const amountInput = document.getElementById('debit-amount');
  let inrAmount = parseFloat(amountInput?.value) || 1000;
  
  if (inrAmount > 25000) inrAmount = 25000;

  const usdAmount = parseFloat((inrAmount / 100).toFixed(2));
  const monthlyBonus = parseFloat((usdAmount * 0.2).toFixed(2));
  const totalBonus = parseFloat((monthlyBonus * 12).toFixed(2));

  const previewInr = document.getElementById('preview-debit-inr');
  if (previewInr) previewInr.textContent = inrAmount.toLocaleString('en-IN');

  const previewUsd = document.getElementById('preview-debit-amount');
  if (previewUsd) previewUsd.textContent = usdAmount.toLocaleString('en-US', { minimumFractionDigits: 2 });

  const previewMonthly = document.getElementById('preview-monthly-bonus');
  if (previewMonthly) previewMonthly.textContent = monthlyBonus.toLocaleString('en-US', { minimumFractionDigits: 2 });

  const previewTotal = document.getElementById('preview-total-bonus');
  if (previewTotal) previewTotal.textContent = totalBonus.toLocaleString('en-US', { minimumFractionDigits: 2 });

  const qrAmountDisp = document.getElementById('qr-amount-display');
  if (qrAmountDisp) qrAmountDisp.textContent = inrAmount.toLocaleString('en-IN');

  const qrcodeContainer = document.getElementById('qrcode');
  if (qrcodeContainer) {
    qrcodeContainer.innerHTML = '';

    const upiString = `upi://pay?pa=easyfinance@upi&pn=EasyFinance&am=${inrAmount}&cu=INR`;

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
}

function copyUPI() {
  navigator.clipboard.writeText('easyfinance@upi').then(() => {
    showToast('UPI ID copied to clipboard!', 'info');
  });
}

async function handleDebitSubmit(event) {
  event.preventDefault();

  const inrAmount = parseFloat(document.getElementById('debit-amount').value);
  const debitDate = document.getElementById('debit-date').value;
  const utr = document.getElementById('debit-utr').value.trim();
  const errorDiv = document.getElementById('debit-error');

  errorDiv.classList.add('hidden');

  if (!inrAmount || inrAmount < 100 || inrAmount > 25000) {
    errorDiv.textContent = 'Please enter a valid debit amount between ₹100 and ₹25,000.';
    errorDiv.classList.remove('hidden');
    return;
  }

  const usdAmount = parseFloat((inrAmount / 100).toFixed(2));
  const monthlyBonusUSD = parseFloat((usdAmount * 0.2).toFixed(2));
  const debitId = 'deb_' + Date.now();

  const debitRecord = {
    id: debitId,
    username: currentUser.username,
    fullName: currentUser.fullName || currentUser.username,
    amount: usdAmount, // Account balance stored in USD ($)
    inrAmount: inrAmount, // Reference deposit amount in INR (₹)
    date: debitDate || new Date().toLocaleDateString('en-US'),
    monthlyBonus: monthlyBonusUSD,
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
  const newLocked = currentLocked + usdAmount;
  if (localUsers[currentUser.username]) {
    localUsers[currentUser.username].lockedDebitBalance = newLocked;
    setLocalStore('users', localUsers);
  }

  currentUser.lockedDebitBalance = newLocked;
  localStorage.setItem('efinance_current_user', JSON.stringify(currentUser));

  // 2. Try Firebase push
  try {
    await ensureFirebaseAuth();
    await db.ref('debits/' + debitId).set(debitRecord);
    await db.ref('users/' + currentUser.username).update({
      lockedDebitBalance: newLocked
    });
  } catch (err) {
    console.warn("Firebase RTDB debit sync note:", err.message);
  }

  closeModal('modal-debit');
  showToast(`Debited ₹${inrAmount.toLocaleString('en-IN')} ($${usdAmount.toFixed(2)} USD) successfully! Locked into scheme.`, 'success');
  loadUserDashboard();
}

// ==========================================================================
// 8. SCHEME DETAIL BREAKDOWN MODAL
// ==========================================================================
function openActiveSchemeDetails() {
  const currentDebited = parseFloat(currentUser?.lockedDebitBalance || 0);
  const sampleDebit = {
    amount: currentDebited > 0 ? currentDebited : 10,
    date: new Date().toLocaleDateString('en-US'),
    monthlyBonus: currentDebited > 0 ? parseFloat((currentDebited * 0.2).toFixed(2)) : 2
  };
  openSchemeDetailsForDebit(sampleDebit);
}

function openSchemeDetailsForDebit(debit) {
  const summaryBox = document.getElementById('scheme-modal-summary');
  const gridContainer = document.getElementById('scheme-timeline-grid');

  const amount = debit.amount || 10;
  const date = debit.date || new Date().toLocaleDateString('en-US');
  const monthlyBonus = debit.monthlyBonus || 2;

  summaryBox.innerHTML = `
    <i class="fa-solid fa-circle-check text-green"></i> Present on date <strong>${date}</strong> you debited <strong>$${parseFloat(amount).toLocaleString('en-US')}</strong>. Per month you get <strong>$${monthlyBonus}</strong> for 12 months.
  `;

  gridContainer.innerHTML = '';

  for (let m = 1; m <= 12; m++) {
    const card = document.createElement('div');
    const isCompletedMonth = m <= 2;
    
    card.className = `month-card ${isCompletedMonth ? 'credited' : ''}`;
    card.innerHTML = `
      <div class="month-title">Month ${m}</div>
      <div class="month-amount">$${monthlyBonus}</div>
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
  document.getElementById('withdraw-max-balance').textContent = availableBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    errorDiv.textContent = `Insufficient withdrawable bonus balance. Your max available profit balance is $${availableBal.toLocaleString('en-US')}. (Locked debit principal cannot be withdrawn).`;
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
    date: new Date().toLocaleDateString('en-US'),
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
    await ensureFirebaseAuth();
    await db.ref('withdrawals/' + withdrawId).set(withdrawRequest);
    await db.ref('users/' + currentUser.username).update({
      availableBalance: newAvailable
    });
  } catch (err) {
    console.warn("Firebase RTDB withdrawal sync note:", err.message);
  }

  closeModal('modal-withdraw');
  document.getElementById('form-withdraw').reset();
  showToast(`Withdrawal request of $${amount} submitted! Status: PENDING`, 'info');
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
