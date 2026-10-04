const API_URL = '/api';

// Escape user-supplied text before inserting into innerHTML (prevents XSS)
function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Fetch helper with error handling
async function api(path, options = {}) {
    const res = await fetch(`${API_URL}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    let data = null;
    try { data = await res.json(); } catch (_) { }
    if (!res.ok) throw new Error((data && data.error) || `เกิดข้อผิดพลาด (HTTP ${res.status})`);
    return data;
}

// Global State
let currentUser = null;
let allEquipment = [];
let allLoans = [];
let borrowCart = []; // Items selected for loan [{ equipmentId, name, code, type, location, remainingQuantity, quantity }]
let activeHistoryFilter = 'ทั้งหมด';
let activeEquipmentType = 'ทั้งหมด';

// ==========================================
// 1. AUTH & SESSION LOGIC
// ==========================================

function checkAuth() {
    const userStr = localStorage.getItem('inventory_user');
    if (userStr) {
        try {
            currentUser = JSON.parse(userStr);
        } catch (_) {
            currentUser = null;
        }
    }

    if (currentUser && currentUser.studentId) {
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';

        // Update header user display
        document.getElementById('user-display-name').innerText = currentUser.name || '-';
        document.getElementById('user-display-id').innerText = currentUser.studentId || '-';
        document.getElementById('user-display-role').innerText = currentUser.role || 'Student';

        // Auto-fill loan form
        document.getElementById('req-studentid').value = currentUser.studentId || '';
        document.getElementById('req-name').value = currentUser.name || '';
        document.getElementById('hist-student-id').innerText = currentUser.studentId || '';

        // Role-based navigation visibility
        const adminGroup = document.getElementById('admin-menu-group');
        if (currentUser.role === 'Admin' || currentUser.role === 'Professor') {
            adminGroup.classList.remove('hidden');
        } else {
            adminGroup.classList.add('hidden');
        }

        // Show default view
        showAppView('equipment-view');
        updatePendingBadges();
    } else {
        document.getElementById('auth-container').style.display = 'flex';
        document.getElementById('app-container').style.display = 'none';
        showAuthView('login-view');
    }
}

function showAuthView(viewId) {
    document.getElementById('login-view').classList.remove('active');
    document.getElementById('register-view').classList.remove('active');
    document.getElementById(viewId).classList.add('active');
}

async function handleLogin(e) {
    e.preventDefault();
    const studentId = document.getElementById('login-id').value.trim();
    const password = document.getElementById('login-password').value;

    try {
        const data = await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ studentId, password })
        });
        localStorage.setItem('inventory_user', JSON.stringify(data.user));
        document.getElementById('login-password').value = '';
        checkAuth();
    } catch (err) {
        alert(err.message);
    }
}

function handleRoleChange(role) {
    const notice = document.getElementById('admin-role-notice');
    if (!notice) return;
    if (role === 'Admin') {
        notice.classList.remove('hidden');
    } else {
        notice.classList.add('hidden');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const studentId = document.getElementById('reg-id').value.trim();
    const name = document.getElementById('reg-name').value.trim();
    const password = document.getElementById('reg-password').value;
    const role = document.getElementById('reg-role').value;
    const faculty = document.getElementById('reg-faculty').value;
    const phone = document.getElementById('reg-phone').value.trim();
    const email = document.getElementById('reg-email').value.trim();

    if (!faculty) return alert('กรุณาเลือกคณะ');

    try {
        const res = await api('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ studentId, name, password, role, faculty, phone, email })
        });

        if (res && res.pendingApproval) {
            alert('🛡️ ส่งคำขอสร้างบัญชีผู้ดูแลระบบ (Admin) สำเร็จ!\n\nเนื่องจากการสร้างบัญชี Admin ต้องได้รับการตรวจสอบ ระบบได้ส่งคำขอไปยัง Admin คนอื่นแล้ว กรุณารอให้ Admin คนอื่นกดยอมรับคำขอก่อน จึงจะสามารถเข้าสู่ระบบได้');
        } else {
            alert('สมัครสมาชิกสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสที่ลงทะเบียน');
        }
        e.target.reset();
        const notice = document.getElementById('admin-role-notice');
        if (notice) notice.classList.add('hidden');
        showAuthView('login-view');
    } catch (err) {
        alert(err.message);
    }
}

function handleLogout() {
    if (confirm('คุณต้องการออกจากระบบหรือไม่?')) {
        localStorage.removeItem('inventory_user');
        currentUser = null;
        borrowCart = [];
        updateCartBadge();
        checkAuth();
    }
}

// ==========================================
// 2. NAVIGATION LOGIC
// ==========================================

const ADMIN_ONLY_VIEWS = ['dashboard-view', 'manage-view', 'checkin-view', 'approvals-view'];

function showAppView(viewId) {
    // Permission check
    if (ADMIN_ONLY_VIEWS.includes(viewId) && currentUser.role === 'Student') {
        alert('สิทธิ์ของคุณไม่สามารถเข้าถึงหน้านี้ได้');
        viewId = 'equipment-view';
    }

    // Switch view
    document.querySelectorAll('.app-view').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');

    // Update active nav button
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('bg-gray-800', 'text-white');
    });
    const currentBtn = document.getElementById(`nav-${viewId.replace('-view', '')}`);
    if (currentBtn) currentBtn.classList.add('bg-gray-800', 'text-white');

    // Trigger view-specific loads
    if (viewId === 'equipment-view') loadEquipment();
    if (viewId === 'request-view') renderCartInRequestForm();
    if (viewId === 'dashboard-view') loadDashboard();
    if (viewId === 'history-view') loadHistory();
    if (viewId === 'checkin-view') loadCheckinConsole();
    if (viewId === 'approvals-view') {
        const adminTabBtn = document.getElementById('tab-approval-admins');
        if (adminTabBtn) {
            if (currentUser && currentUser.role === 'Admin') {
                adminTabBtn.classList.remove('hidden');
            } else {
                adminTabBtn.classList.add('hidden');
                switchApprovalTab('loans');
            }
        }
        refreshApprovalsView();
    }
    if (viewId === 'projects-view') loadProjectsSummary();
    if (viewId === 'manage-view') loadManageEquipment();
}

async function updatePendingBadges() {
    if (!currentUser || currentUser.role === 'Student') return;
    try {
        const stats = await api('/stats');
        const badge = document.getElementById('pending-badge');
        const pendingLoans = stats.pendingLoans || 0;
        const pendingAdmins = (currentUser.role === 'Admin' ? (stats.pendingAdmins || 0) : 0);
        const totalPending = pendingLoans + pendingAdmins;

        if (badge) {
            if (totalPending > 0) {
                badge.innerText = totalPending;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        const tabLoansCount = document.getElementById('tab-loans-count');
        if (tabLoansCount) tabLoansCount.innerText = pendingLoans;

        const tabAdminsCount = document.getElementById('tab-admins-count');
        if (tabAdminsCount) {
            const adminCount = stats.pendingAdmins || 0;
            tabAdminsCount.innerText = adminCount;
            if (adminCount > 0) {
                tabAdminsCount.classList.remove('hidden');
            } else {
                tabAdminsCount.classList.add('hidden');
            }
        }
    } catch (_) {}
}

// ==========================================
// 3. EQUIPMENT CATALOG & CART (Page 1 & Page 4)
// ==========================================

let filterTimeout = null;
function debounceFilterEquipment() {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(loadEquipment, 250);
}

function setEquipmentTypeFilter(type) {
    activeEquipmentType = type;
    document.querySelectorAll('.eq-filter-btn').forEach(btn => {
        if (btn.getAttribute('data-type') === type) {
            btn.className = 'eq-filter-btn px-3 py-1.5 rounded bg-red-600 text-white font-medium';
        } else {
            btn.className = 'eq-filter-btn px-3 py-1.5 rounded text-gray-300 hover:text-white';
        }
    });
    loadEquipment();
}

async function loadEquipment() {
    const container = document.getElementById('equipment-list');
    const search = document.getElementById('eq-search-input')?.value.trim() || '';
    const inStockOnly = document.getElementById('eq-instock-only')?.checked || false;

    let query = `?type=${encodeURIComponent(activeEquipmentType)}`;
    if (search) query += `&search=${encodeURIComponent(search)}`;
    if (inStockOnly) query += `&inStock=true`;

    try {
        container.innerHTML = '<div class="col-span-full py-12 text-center text-gray-400">กำลังโหลดรายการอุปกรณ์...</div>';
        allEquipment = await api(`/equipment${query}`);
        container.innerHTML = '';

        if (allEquipment.length === 0) {
            container.innerHTML = `
                <div class="col-span-full py-12 text-center text-gray-500">
                    <p class="text-base font-semibold">ไม่พบรายการอุปกรณ์ตามเงื่อนไขที่ค้นหา</p>
                    <p class="text-xs text-gray-600 mt-1">ลองเปลี่ยนคำค้นหา หรือรีเซ็ตตัวกรอง</p>
                </div>
            `;
            return;
        }

        allEquipment.forEach(item => {
            const el = document.createElement('div');
            el.className = 'card-dark rounded-xl overflow-hidden flex flex-col border border-gray-800 hover:border-gray-700 transition shadow-lg';
            
            const isConsumable = item.type === 'วัสดุสิ้นเปลือง';
            const badgeClass = isConsumable ? 'badge-consumable' : 'badge-durable';
            const outOfStock = item.remainingQuantity <= 0;
            const inCart = borrowCart.some(c => c.equipmentId === item._id);

            el.innerHTML = `
                <!-- Image / Placeholder -->
                <div class="h-44 bg-[#181818] relative flex items-center justify-center border-b border-gray-800/80 overflow-hidden">
                    ${item.image ? `<img src="${esc(item.image)}" alt="${esc(item.name)}" class="h-full w-full object-cover">` : `
                        <div class="text-center p-4">
                            <span class="text-4xl opacity-30">${isConsumable ? '📦' : '🔬'}</span>
                            <div class="text-xs text-gray-500 mt-1 font-mono">${esc(item.equipmentId)}</div>
                        </div>
                    `}
                    <!-- Category Badge -->
                    <span class="absolute top-3 left-3 text-[11px] font-semibold px-2.5 py-1 rounded-full ${badgeClass}">
                        ${esc(item.type)}
                    </span>
                    <!-- Location Badge -->
                    <span class="absolute top-3 right-3 text-[11px] bg-black/60 backdrop-blur-sm text-gray-300 px-2 py-0.5 rounded border border-gray-700/60">
                        📍 ${esc(item.location || 'คลังแล็บ')}
                    </span>
                </div>

                <!-- Info Body -->
                <div class="p-4 flex-1 flex flex-col justify-between space-y-3">
                    <div>
                        <h3 class="font-bold text-base text-white line-clamp-1" title="${esc(item.name)}">${esc(item.name)}</h3>
                        <p class="text-xs text-gray-400 mt-1 line-clamp-2">${esc(item.description || 'ไม่มีรายละเอียดเพิ่มเติม')}</p>
                    </div>

                    <!-- Stock Counter Bar -->
                    <div class="pt-2 border-t border-gray-800/80">
                        <div class="flex justify-between items-center text-xs mb-1.5">
                            <span class="text-gray-400">คงเหลือในคลัง:</span>
                            <span class="font-bold font-mono ${outOfStock ? 'text-red-400' : 'text-emerald-400'}">
                                ${item.remainingQuantity} / ${item.totalQuantity} ชิ้น
                            </span>
                        </div>
                        <div class="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                            <div class="h-full ${outOfStock ? 'bg-red-500' : 'bg-emerald-500'}" 
                                 style="width: ${Math.min(100, Math.round((item.remainingQuantity / Math.max(1, item.totalQuantity)) * 100))}%">
                            </div>
                        </div>
                    </div>

                    <!-- Add to Cart Button (Matching Page 1 PDF) -->
                    <button onclick="toggleAddToCart('${item._id}')" 
                            ${outOfStock ? 'disabled' : ''}
                            class="w-full py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1 transition
                                   ${outOfStock ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 
                                     inCart ? 'bg-gray-700 text-white hover:bg-gray-600' : 'btn-red shadow'}">
                        <span>${outOfStock ? '✕ ของหมดชั่วคราว' : inCart ? '✓ อยู่ในรายการยืมแล้ว' : '+ เพิ่มในรายการยืม'}</span>
                    </button>
                </div>
            `;
            container.appendChild(el);
        });
    } catch (err) {
        container.innerHTML = `<div class="col-span-full py-12 text-center text-red-400">${esc(err.message)}</div>`;
    }
}

function toggleAddToCart(equipmentId) {
    const item = allEquipment.find(e => e._id === equipmentId);
    if (!item) return;

    const existingIndex = borrowCart.findIndex(c => c.equipmentId === equipmentId);
    if (existingIndex >= 0) {
        borrowCart.splice(existingIndex, 1);
    } else {
        if (item.remainingQuantity <= 0) return alert('อุปกรณ์นี้หมด ไม่สามารถเลือกได้');
        borrowCart.push({
            equipmentId: item._id,
            code: item.equipmentId,
            name: item.name,
            type: item.type,
            location: item.location,
            remainingQuantity: item.remainingQuantity,
            quantity: 1
        });
    }

    updateCartBadge();
    loadEquipment();
}

function updateCartBadge() {
    const badge = document.getElementById('cart-badge');
    const counterBtn = document.getElementById('cart-counter-btn');
    const count = borrowCart.length;

    if (badge) {
        badge.innerText = count;
        if (count > 0) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    }
    if (counterBtn) counterBtn.innerText = count;
}

// Render Cart in Page 4 (Selected Items)
function renderCartInRequestForm() {
    const container = document.getElementById('selected-items-container');
    if (!container) return;

    if (borrowCart.length === 0) {
        container.innerHTML = `
            <div class="card-subtle p-6 rounded-xl text-center text-gray-400 space-y-2">
                <span class="text-3xl">🛒</span>
                <p class="text-sm">ยังไม่มีอุปกรณ์ที่เลือกยืม</p>
                <button type="button" onclick="showAppView('equipment-view')" class="text-xs text-red-400 font-bold hover:underline">
                    คลิกเพื่อไปเลือกอุปกรณ์จากคลัง &rarr;
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    borrowCart.forEach((item, index) => {
        const isConsumable = item.type === 'วัสดุสิ้นเปลือง';
        const el = document.createElement('div');
        el.className = 'card-subtle p-4 rounded-xl border border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3';
        el.innerHTML = `
            <div class="flex items-center space-x-3">
                <span class="text-2xl">${isConsumable ? '📦' : '🔬'}</span>
                <div>
                    <div class="font-bold text-white text-sm">${esc(item.name)}</div>
                    <div class="text-xs text-gray-400 flex items-center space-x-2 mt-0.5">
                        <span class="px-1.5 py-0.5 rounded text-[10px] ${isConsumable ? 'badge-consumable' : 'badge-durable'}">${esc(item.type)}</span>
                        <span>รหัส: <code class="text-gray-300 font-mono">${esc(item.code)}</code></span>
                        <span>(${esc(item.location || 'คลัง')})</span>
                    </div>
                </div>
            </div>

            <div class="flex items-center space-x-4 self-end sm:self-auto">
                <div class="flex items-center space-x-2">
                    <span class="text-xs text-gray-400">จำนวน:</span>
                    <div class="flex items-center bg-[#1E1E1E] rounded-lg border border-gray-700 overflow-hidden">
                        <button type="button" onclick="adjustCartQty(${index}, -1)" class="px-2.5 py-1 text-gray-400 hover:text-white hover:bg-gray-800">-</button>
                        <input type="number" min="1" max="${item.remainingQuantity}" value="${item.quantity}" 
                               onchange="setCartQty(${index}, this.value)"
                               class="w-12 text-center bg-transparent text-white font-mono text-sm focus:outline-none">
                        <button type="button" onclick="adjustCartQty(${index}, 1)" class="px-2.5 py-1 text-gray-400 hover:text-white hover:bg-gray-800">+</button>
                    </div>
                    <span class="text-xs text-gray-500 font-mono">/ ${item.remainingQuantity}</span>
                </div>
                <button type="button" onclick="removeFromCart(${index})" title="ลบรายการ" class="text-gray-500 hover:text-red-400 p-1 text-base">
                    ✕
                </button>
            </div>
        `;
        container.appendChild(el);
    });
}

function adjustCartQty(index, change) {
    if (!borrowCart[index]) return;
    const newQty = borrowCart[index].quantity + change;
    if (newQty >= 1 && newQty <= borrowCart[index].remainingQuantity) {
        borrowCart[index].quantity = newQty;
        renderCartInRequestForm();
    }
}

function setCartQty(index, val) {
    if (!borrowCart[index]) return;
    let qty = parseInt(val) || 1;
    qty = Math.max(1, Math.min(qty, borrowCart[index].remainingQuantity));
    borrowCart[index].quantity = qty;
    renderCartInRequestForm();
}

function removeFromCart(index) {
    borrowCart.splice(index, 1);
    updateCartBadge();
    renderCartInRequestForm();
}

// Loan period rule: student picks the due date, max 14 days after pickup
const MAX_LOAN_DAYS = 14;
const DAY_MS = 1000 * 60 * 60 * 24;

// Format Date as YYYY-MM-DD in local time (toISOString() uses UTC and can shift the day)
function toLocalDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseLocalDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

// Set default dates on loan form
function initLoanFormDates() {
    const today = new Date();
    const borrowInput = document.getElementById('req-borrowdate');
    const dueInput = document.getElementById('req-duedate');
    if (borrowInput && !borrowInput.value) borrowInput.value = toLocalDateStr(today);
    if (dueInput && !dueInput.value) dueInput.value = toLocalDateStr(addDays(today, 7)); // Default 7 days loan
    updateDueDateLimits();
}

// Keep due date within [pickup + 1, pickup + 14] and show a hint
function updateDueDateLimits() {
    const borrowInput = document.getElementById('req-borrowdate');
    const dueInput = document.getElementById('req-duedate');
    const hint = document.getElementById('req-duedate-hint');
    if (!borrowInput || !dueInput) return;

    borrowInput.min = toLocalDateStr(new Date());
    if (!borrowInput.value) return;

    const bDate = parseLocalDate(borrowInput.value);
    const minDue = addDays(bDate, 1);
    const maxDue = addDays(bDate, MAX_LOAN_DAYS);
    dueInput.min = toLocalDateStr(minDue);
    dueInput.max = toLocalDateStr(maxDue);

    // Clamp current value into the allowed range
    if (dueInput.value) {
        const dDate = parseLocalDate(dueInput.value);
        if (dDate < minDue) dueInput.value = toLocalDateStr(minDue);
        if (dDate > maxDue) dueInput.value = toLocalDateStr(maxDue);
    }

    if (hint) {
        const days = dueInput.value ? Math.round((parseLocalDate(dueInput.value) - bDate) / DAY_MS) : 0;
        hint.innerText = `เลือกได้ถึงวันที่ ${maxDue.toLocaleDateString('th-TH')} • ระยะเวลายืมที่เลือก: ${days} วัน (สูงสุด ${MAX_LOAN_DAYS} วัน)`;
    }
}

async function handleLoanSubmit(e) {
    e.preventDefault();
    if (borrowCart.length === 0) {
        return alert('กรุณาเลือกอุปกรณ์ที่ต้องการยืมอย่างน้อย 1 รายการ');
    }

    const payload = {
        studentId: document.getElementById('req-studentid').value,
        studentName: document.getElementById('req-name').value,
        group: document.getElementById('req-group').value.trim(),
        subject: document.getElementById('req-subject').value.trim(),
        advisor: document.getElementById('req-advisor').value.trim(),
        project: document.getElementById('req-project').value.trim(),
        purpose: document.getElementById('req-purpose').value.trim(),
        note: document.getElementById('req-note').value.trim(),
        borrowDate: document.getElementById('req-borrowdate').value,
        dueDate: document.getElementById('req-duedate').value,
        items: borrowCart.map(c => ({
            equipmentId: c.equipmentId,
            quantity: c.quantity
        }))
    };

    // Check date limit (max 14 days)
    const bDate = parseLocalDate(payload.borrowDate);
    const dDate = parseLocalDate(payload.dueDate);
    const diffDays = Math.round((dDate - bDate) / DAY_MS);
    if (diffDays <= 0) return alert('กำหนดส่งคืนต้องอยู่หลังวันที่รับอุปกรณ์');
    if (diffDays > MAX_LOAN_DAYS) return alert(`ระยะเวลายืมต้องไม่เกิน ${MAX_LOAN_DAYS} วันตามระเบียบห้องปฏิบัติการ`);

    try {
        await api('/loans', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        alert('ส่งคำขอยืมอุปกรณ์เรียบร้อยแล้ว! สถานะ: "รออนุมัติ" กรุณารออาจารย์หรือแอดมินตรวจสอบ');
        borrowCart = [];
        updateCartBadge();
        document.getElementById('loan-request-form').reset();
        initLoanFormDates(); // Restore default dates after reset
        checkAuth(); // Refill read-only student info
        showAppView('history-view');
    } catch (err) {
        alert(err.message);
    }
}

// ==========================================
// 4. LOAN HISTORY (Page 5 in PDF)
// ==========================================

function filterHistory(tab) {
    activeHistoryFilter = tab;
    document.querySelectorAll('.hist-tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tab) {
            btn.className = 'hist-tab-btn px-4 py-1.5 rounded bg-red-600 text-white font-medium';
        } else {
            btn.className = 'hist-tab-btn px-4 py-1.5 rounded text-gray-300 hover:text-white';
        }
    });
    renderHistoryCards();
}

async function loadHistory() {
    const container = document.getElementById('history-list-cards');
    try {
        container.innerHTML = '<div class="py-12 text-center text-gray-400">กำลังโหลดประวัติ...</div>';
        
        let url = '/loans';
        if (currentUser.role === 'Student') {
            url += `?studentId=${encodeURIComponent(currentUser.studentId)}`;
        }
        allLoans = await api(url);

        // Update counts
        const allCount = allLoans.length;
        const activeCount = allLoans.filter(l => l.status === 'รออนุมัติ' || l.status === 'กำลังยืม').length;
        const returnedCount = allLoans.filter(l => l.status === 'คืนแล้ว').length;

        document.getElementById('hist-cnt-all').innerText = allCount;
        document.getElementById('hist-cnt-active').innerText = activeCount;
        document.getElementById('hist-cnt-returned').innerText = returnedCount;

        renderHistoryCards();
    } catch (err) {
        container.innerHTML = `<div class="py-12 text-center text-red-400">${esc(err.message)}</div>`;
    }
}

function renderHistoryCards() {
    const container = document.getElementById('history-list-cards');
    if (!container) return;

    let filtered = allLoans;
    if (activeHistoryFilter === 'กำลังดำเนินการ') {
        filtered = allLoans.filter(l => l.status === 'รออนุมัติ' || l.status === 'กำลังยืม');
    } else if (activeHistoryFilter === 'คืนแล้ว') {
        filtered = allLoans.filter(l => l.status === 'คืนแล้ว');
    }

    container.innerHTML = '';
    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="card-dark p-8 rounded-xl text-center text-gray-500 border border-gray-800">
                <p>ไม่พบรายการประวัติการยืมในหมวดนี้</p>
            </div>
        `;
        return;
    }

    filtered.forEach(loan => {
        const el = document.createElement('div');
        el.className = 'card-dark p-6 rounded-xl border border-gray-800 space-y-4 shadow-lg';

        // Status badge color
        let statusBadge = '';
        if (loan.status === 'รออนุมัติ') {
            statusBadge = '<span class="bg-yellow-950/60 text-yellow-300 border border-yellow-800 px-3 py-1 rounded-full text-xs font-bold">⏳ รออนุมัติ</span>';
        } else if (loan.status === 'กำลังยืม') {
            const isOverdue = loan.isOverdue;
            statusBadge = isOverdue
                ? '<span class="bg-red-950 text-red-300 border border-red-700 px-3 py-1 rounded-full text-xs font-bold">⚠️ เกินกำหนดส่งคืน</span>'
                : '<span class="bg-blue-950/60 text-blue-300 border border-blue-800 px-3 py-1 rounded-full text-xs font-bold">🔄 กำลังยืมใช้งาน</span>';
        } else if (loan.status === 'คืนแล้ว') {
            statusBadge = '<span class="bg-emerald-950/60 text-emerald-300 border border-emerald-800 px-3 py-1 rounded-full text-xs font-bold">✓ คืนแล้ว</span>';
        } else if (loan.status === 'ปฏิเสธ') {
            statusBadge = '<span class="bg-gray-800 text-gray-400 border border-gray-700 px-3 py-1 rounded-full text-xs font-bold">✕ ปฏิเสธ</span>';
        }

        // Items list rendering (Page 5 design)
        const itemsHtml = loan.items.map(i => `
            <div class="flex justify-between items-center bg-[#252525] p-2.5 rounded-lg border border-gray-700/60 text-xs">
                <span class="font-medium text-white">${esc(i.equipmentId?.name || 'อุปกรณ์ไม่ระบุชื่อ')}</span>
                <span class="font-mono text-gray-300 font-bold bg-black/40 px-2 py-0.5 rounded">x${i.quantity}</span>
            </div>
        `).join('');

        el.innerHTML = `
            <!-- Header bar of card -->
            <div class="flex flex-wrap justify-between items-center gap-2 border-b border-gray-800 pb-3">
                <div class="flex items-center space-x-2 text-xs text-gray-400">
                    <span class="font-mono bg-gray-800 px-2 py-0.5 rounded text-gray-300">ID: ${esc(loan._id)}</span>
                    <span>• ยื่นคำขอเมื่อ: <strong class="text-gray-200">${new Date(loan.borrowDate).toLocaleDateString('th-TH')}</strong></span>
                </div>
                <div>${statusBadge}</div>
            </div>

            <!-- Body of card (Matching Page 5 PDF) -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <!-- Left: Project & Purpose -->
                <div class="space-y-2">
                    <div>
                        <span class="text-xs text-gray-400">โครงงาน / รายวิชา:</span>
                        <h4 class="font-bold text-white text-base">${esc(loan.project)}</h4>
                        <div class="text-xs text-gray-400">กลุ่ม: <strong class="text-gray-300">${esc(loan.group || '-')}</strong></div>
                    </div>
                    <div>
                        <span class="text-xs text-gray-400">อาจารย์ที่ปรึกษา:</span>
                        <div class="text-sm font-medium text-gray-200">${esc(loan.advisor)}</div>
                    </div>
                    <div>
                        <span class="text-xs text-gray-400">วัตถุประสงค์:</span>
                        <p class="text-xs text-gray-300 italic">"${esc(loan.purpose)}"</p>
                    </div>
                    ${loan.note ? `
                    <div>
                        <span class="text-xs text-gray-400">หมายเหตุ:</span>
                        <p class="text-xs text-gray-300">${esc(loan.note)}</p>
                    </div>` : ''}
                </div>

                <!-- Right: Equipment Items & Due Date -->
                <div class="space-y-3">
                    <span class="text-xs text-gray-400 font-semibold">รายการอุปกรณ์ที่ขอยืม (${loan.items.length} รายการ):</span>
                    <div class="space-y-1.5">
                        ${itemsHtml}
                    </div>
                </div>
            </div>

            <!-- Footer: Dates & Staff info -->
            <div class="pt-3 border-t border-gray-800 flex flex-wrap justify-between items-center text-xs text-gray-400">
                <div class="flex items-center space-x-4">
                    <span>กำหนดส่งคืน: <strong class="text-yellow-400">${new Date(loan.dueDate).toLocaleDateString('th-TH')}</strong></span>
                    ${loan.returnDate ? `<span>วันที่คืน: <strong class="text-emerald-400">${new Date(loan.returnDate).toLocaleDateString('th-TH')}</strong></span>` : ''}
                </div>
                <div class="text-gray-500">
                    ${loan.returnedTo ? `ผู้ตรวจรับ/จ่ายของ: <strong class="text-gray-300">${esc(loan.returnedTo)}</strong>` : 
                      loan.approvedBy ? `ผู้อนุมัติ: <strong class="text-gray-300">${esc(loan.approvedBy)}</strong>` : ''}
                </div>
            </div>
        `;
        container.appendChild(el);
    });
}

// ==========================================
// 5. ADMIN DASHBOARD & REAL-TIME MONITOR (Page 2)
// ==========================================

async function loadDashboard() {
    try {
        const stats = await api('/stats');
        document.getElementById('stat-total').innerText = stats.totalEquipment;
        document.getElementById('stat-durable-total').innerText = stats.durables?.total || 0;
        document.getElementById('stat-consumable-total').innerText = stats.consumables?.total || 0;

        document.getElementById('stat-borrowed').innerText = stats.borrowedEquipment;
        document.getElementById('stat-overdue-count').innerText = stats.overdueLoans;
        document.getElementById('stat-pending-count').innerText = stats.pendingLoans;

        document.getElementById('stat-ready').innerText = stats.readyEquipment;
        document.getElementById('stat-damaged').innerText = stats.damagedEquipment;
        document.getElementById('stat-damaged-only').innerText = stats.damagedEquipment - stats.lostEquipment;
        document.getElementById('stat-lost-only').innerText = stats.lostEquipment;

        // Render Active Loans Monitor Table
        const loans = await api('/loans');
        allLoans = loans;
        renderActiveLoansTable(loans.filter(l => l.status === 'กำลังยืม'));

        // Render Damaged Equipment Logs (Page 2 PDF)
        renderDamagedLog(stats.damagedLogs || []);
    } catch (err) {
        console.error('Error loading dashboard:', err);
    }
}

function filterActiveLoansTable() {
    const search = document.getElementById('dash-search-input')?.value.trim().toLowerCase() || '';
    const active = allLoans.filter(l => l.status === 'กำลังยืม');
    if (!search) return renderActiveLoansTable(active);

    const filtered = active.filter(l => 
        l.studentName.toLowerCase().includes(search) ||
        l.studentId.toLowerCase().includes(search) ||
        l.project.toLowerCase().includes(search) ||
        (l.group && l.group.toLowerCase().includes(search))
    );
    renderActiveLoansTable(filtered);
}

function renderActiveLoansTable(loans) {
    const tbody = document.getElementById('active-loans-list');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (loans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-gray-500">ไม่มีรายการอุปกรณ์ที่กำลังถูกยืมในขณะนี้</td></tr>`;
        return;
    }

    const now = new Date();
    loans.forEach(loan => {
        const isOverdue = loan.isOverdue || (new Date(loan.dueDate) < now);
        const daysDiff = Math.ceil((new Date(loan.dueDate) - now) / (1000 * 60 * 60 * 24));
        
        let dueDisplay = '';
        if (isOverdue) {
            dueDisplay = `<div class="font-bold text-red-400">${new Date(loan.dueDate).toLocaleDateString('th-TH')}</div><div class="text-[10px] text-red-500 font-bold">เกินกำหนด ${Math.abs(daysDiff)} วัน!</div>`;
        } else {
            dueDisplay = `<div>${new Date(loan.dueDate).toLocaleDateString('th-TH')}</div><div class="text-[10px] text-gray-400">เหลือ ${daysDiff} วัน</div>`;
        }

        const itemsDisplay = loan.items.map(i => `${esc(i.equipmentId?.name || 'อุปกรณ์')} (${i.quantity})`).join(', ');

        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-800/40 transition border-b border-gray-800/60';
        tr.innerHTML = `
            <td class="py-3 px-4">
                <div class="font-bold text-white">${esc(loan.studentName)}</div>
                <div class="text-xs text-gray-400 font-mono">${esc(loan.studentId)} ${loan.group ? `(${esc(loan.group)})` : ''}</div>
            </td>
            <td class="py-3 px-4 max-w-xs text-gray-300 font-medium">
                ${itemsDisplay}
            </td>
            <td class="py-3 px-4">
                <div class="text-white">${esc(loan.project)}</div>
            </td>
            <td class="py-3 px-4 text-gray-300">
                ${esc(loan.advisor)}
            </td>
            <td class="py-3 px-4">
                ${dueDisplay}
            </td>
            <td class="py-3 px-4">
                <span class="px-2.5 py-1 rounded-full text-xs font-bold ${isOverdue ? 'bg-red-950 text-red-300 border border-red-800' : 'bg-blue-950 text-blue-300 border border-blue-800'}">
                    ${isOverdue ? 'เกินกำหนด' : 'กำลังยืม'}
                </span>
            </td>
            <td class="py-3 px-4 text-right">
                <button onclick="goToInspection('${loan._id}')" class="btn-red px-3 py-1 text-xs font-semibold">
                    ตรวจรับคืน
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderDamagedLog(logs) {
    const grid = document.getElementById('damaged-equipment-grid');
    if (!grid) return;

    grid.innerHTML = '';
    if (logs.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-4 text-center text-gray-500 text-xs">ไม่มีอุปกรณ์ที่ชำรุดหรือส่งซ่อมในขณะนี้ (สภาพอุปกรณ์สมบูรณ์ 100%)</div>`;
        return;
    }

    logs.forEach(item => {
        const el = document.createElement('div');
        el.className = 'card-subtle p-4 rounded-xl border border-red-900/40 space-y-2';
        el.innerHTML = `
            <div class="flex justify-between items-start">
                <h4 class="font-bold text-white text-sm">${esc(item.name)}</h4>
                <span class="bg-red-950 text-red-300 text-[10px] font-bold px-2 py-0.5 rounded border border-red-800">
                    ${esc(item.status)} (${item.damagedQuantity || 1} ชิ้น)
                </span>
            </div>
            <p class="text-xs text-gray-400 line-clamp-2">${esc(item.description || 'ตรวจพบความเสียหายจากการใช้งานแล็บ')}</p>
            <div class="pt-2 border-t border-gray-800 flex justify-between text-[10px] text-gray-500 font-mono">
                <span>ID: ${esc(item.equipmentId)}</span>
                <span>ผู้ดูแล: พี่ตั้ม</span>
            </div>
        `;
        grid.appendChild(el);
    });
}

// ==========================================
// 6. CHECK-IN & INSPECTION CONSOLE (Page 3)
// ==========================================

let activeInspectionLoan = null;

async function loadCheckinConsole() {
    try {
        const loans = await api('/loans?status=กำลังยืม');
        const tbody = document.getElementById('checkin-quick-list');
        if (!tbody) return;

        tbody.innerHTML = '';
        if (loans.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-gray-500">ไม่มีรายการที่กำลังยืมอยู่</td></tr>`;
            return;
        }

        loans.forEach(loan => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-800 cursor-pointer';
            tr.innerHTML = `
                <td class="py-2 px-2 font-mono text-gray-400">${esc(loan._id.substring(loan._id.length - 8))}</td>
                <td class="py-2 px-2 text-white font-medium">${esc(loan.studentName)}</td>
                <td class="py-2 px-2 text-gray-300">${esc(loan.items.map(i => i.equipmentId?.name).join(', '))}</td>
                <td class="py-2 px-2 text-gray-400">${new Date(loan.dueDate).toLocaleDateString('th-TH')}</td>
                <td class="py-2 px-2 text-right">
                    <button onclick="goToInspection('${loan._id}')" class="text-red-400 hover:underline">เลือกตรวจคืน &rarr;</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (_) {}
}

async function findLoanForCheckin() {
    const inputId = document.getElementById('checkin-id')?.value.trim();
    if (!inputId) return alert('กรุณาใส่ Loan ID');
    goToInspection(inputId);
}

async function goToInspection(loanId) {
    try {
        const loans = await api('/loans');
        const loan = loans.find(l => l._id === loanId || l._id.endsWith(loanId));
        if (!loan) return alert('ไม่พบข้อมูลการยืมนี้');

        activeInspectionLoan = loan;
        document.getElementById('checkin-id').value = loan._id;

        // Populate inspection card
        document.getElementById('inspect-equipment-name').innerText = loan.items.map(i => `${i.equipmentId?.name || 'อุปกรณ์'} (${i.quantity} ชิ้น)`).join(', ');
        document.getElementById('inspect-student').innerText = `${loan.studentName} (${loan.studentId})`;
        document.getElementById('inspect-project').innerText = `${loan.project} (${loan.group || '-'})`;
        document.getElementById('inspect-location').innerText = loan.items.map(i => i.equipmentId?.location || 'Cabinet A, Shelf 2').join(', ');

        const card = document.getElementById('checkin-inspection-card');
        card.classList.remove('hidden');
        card.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        alert(err.message);
    }
}

async function submitCheckinReturn() {
    if (!activeInspectionLoan) return alert('กรุณาเลือกรายการยืมก่อน');

    const condition = document.querySelector('input[name="inspect-condition"]:checked')?.value || 'ปกติ';
    const damageNote = document.getElementById('inspect-damage-note')?.value.trim() || '';

    const payload = {
        returnedTo: currentUser.name || 'พี่ตั้ม (ผู้ดูแลแล็บ)',
        inspectionNotes: damageNote,
        itemsInspection: activeInspectionLoan.items.map(item => ({
            equipmentId: item.equipmentId?._id || item.equipmentId,
            returnedQuantity: item.quantity,
            condition: condition,
            damageNote: damageNote
        }))
    };

    try {
        await api(`/loans/${activeInspectionLoan._id}/return`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        alert('บันทึกการตรวจรับคืนอุปกรณ์และปรับยอดสต็อกเรียบร้อยแล้ว!');
        document.getElementById('checkin-inspection-card').classList.add('hidden');
        document.getElementById('checkin-id').value = '';
        activeInspectionLoan = null;
        loadCheckinConsole();
        loadDashboard();
    } catch (err) {
        alert(err.message);
    }
}

// ==========================================
// 7. PENDING APPROVALS (Admin & Professors)
// ==========================================

async function loadApprovals() {
    const container = document.getElementById('approvals-list');
    if (!container) return;

    try {
        container.innerHTML = '<div class="py-12 text-center text-gray-400">กำลังโหลดคำขอยืม...</div>';
        const pending = await api('/loans?status=รออนุมัติ');
        container.innerHTML = '';

        if (pending.length === 0) {
            container.innerHTML = `
                <div class="card-dark p-8 rounded-xl text-center text-gray-500 border border-gray-800">
                    <p class="text-base font-bold text-gray-400">ไม่มีคำขอยืมที่รอการอนุมัติในขณะนี้</p>
                    <p class="text-xs text-gray-600 mt-1">เมื่อมีนักศึกษาส่งคำขอยืม รายการจะแสดงขึ้นที่นี่</p>
                </div>
            `;
            return;
        }

        pending.forEach(loan => {
            const el = document.createElement('div');
            el.className = 'card-dark p-6 rounded-xl border border-yellow-900/40 space-y-4 shadow-xl';

            const itemsList = loan.items.map(i => `
                <div class="flex justify-between items-center bg-[#252525] p-2 rounded text-xs">
                    <span class="text-white font-medium">${esc(i.equipmentId?.name || 'อุปกรณ์')}</span>
                    <span class="font-mono bg-black/40 text-yellow-300 font-bold px-2 py-0.5 rounded">x${i.quantity}</span>
                </div>
            `).join('');

            el.innerHTML = `
                <div class="flex flex-wrap justify-between items-start gap-2 border-b border-gray-800 pb-3">
                    <div>
                        <span class="bg-yellow-950 text-yellow-300 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-yellow-800">
                            รออนุมัติ (Pending)
                        </span>
                        <h4 class="font-bold text-lg text-white mt-1">${esc(loan.project)}</h4>
                        <div class="text-xs text-gray-400">ผู้ยืม: <strong class="text-gray-200">${esc(loan.studentName)} (${esc(loan.studentId)})</strong> • กลุ่ม: ${esc(loan.group || '-')}</div>
                    </div>
                    <div class="text-xs text-right text-gray-400">
                        <div>อาจารย์ที่ปรึกษา: <strong class="text-white">${esc(loan.advisor)}</strong></div>
                        <div>ยื่นเมื่อ: ${new Date(loan.borrowDate).toLocaleDateString('th-TH')}</div>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div class="space-y-1">
                        <span class="text-gray-400 font-semibold">วัตถุประสงค์การใช้งาน:</span>
                        <p class="text-gray-300 italic bg-[#242424] p-2.5 rounded border border-gray-800">"${esc(loan.purpose)}"</p>
                        ${loan.note ? `
                        <span class="text-gray-400 font-semibold block mt-2">หมายเหตุจากผู้ยืม:</span>
                        <p class="text-gray-300 bg-[#242424] p-2.5 rounded border border-gray-800">${esc(loan.note)}</p>` : ''}
                        <div class="text-gray-400 mt-2">
                            กำหนดส่งคืน: <strong class="text-yellow-400 font-bold">${new Date(loan.dueDate).toLocaleDateString('th-TH')}</strong>
                        </div>
                    </div>
                    <div class="space-y-1">
                        <span class="text-gray-400 font-semibold">อุปกรณ์ที่ขอเบิก (${loan.items.length} รายการ):</span>
                        <div class="space-y-1 mt-1">
                            ${itemsList}
                        </div>
                    </div>
                </div>

                <div class="pt-3 border-t border-gray-800 flex justify-end space-x-3">
                    <button onclick="rejectLoan('${loan._id}')" class="card-subtle px-4 py-2 rounded-lg text-xs font-semibold text-gray-300 hover:text-red-400 border border-gray-700">
                        ✕ ปฏิเสธคำขอ
                    </button>
                    <button onclick="approveLoan('${loan._id}')" class="btn-red px-5 py-2 rounded-lg text-xs font-bold flex items-center space-x-1">
                        <span>✓ อนุมัติการยืม</span>
                    </button>
                </div>
            `;
            container.appendChild(el);
        });
    } catch (err) {
        container.innerHTML = `<div class="py-12 text-center text-red-400">${esc(err.message)}</div>`;
    }
}

async function approveLoan(loanId) {
    if (!confirm('ยืนยันการอนุมัติคำขอยืมนี้หรือไม่? (ระบบจะทำการตัดยอดสต็อกพร้อมใช้ทันที)')) return;
    try {
        await api(`/loans/${loanId}/approve`, {
            method: 'PUT',
            body: JSON.stringify({ approvedBy: currentUser.name })
        });
        alert('อนุมัติการยืมสำเร็จ');
        loadApprovals();
        updatePendingBadges();
    } catch (err) {
        alert(err.message);
    }
}

async function rejectLoan(loanId) {
    const reason = prompt('ระบุเหตุผลในการปฏิเสธคำขอยืม:', 'อุปกรณ์ไม่เพียงพอ หรือข้อมูลไม่ครบถ้วน');
    if (reason === null) return;

    try {
        await api(`/loans/${loanId}/reject`, {
            method: 'PUT',
            body: JSON.stringify({ rejectedReason: reason, rejectedBy: currentUser.name })
        });
        alert('ปฏิเสธคำขอยืมเรียบร้อยแล้ว');
        loadApprovals();
        updatePendingBadges();
    } catch (err) {
        alert(err.message);
    }
}

// ==========================================
// 7.1 ADMIN REGISTRATION REQUEST APPROVALS
// ==========================================

let currentApprovalTab = 'loans';

function switchApprovalTab(tab) {
    currentApprovalTab = tab;
    const loanTabBtn = document.getElementById('tab-approval-loans');
    const adminTabBtn = document.getElementById('tab-approval-admins');
    const loanSection = document.getElementById('approvals-loans-section');
    const adminSection = document.getElementById('approvals-admins-section');

    if (!loanTabBtn || !adminTabBtn) return;

    if (tab === 'loans') {
        loanTabBtn.className = 'px-4 py-2 rounded-lg text-sm font-bold bg-yellow-500 text-black transition flex items-center space-x-2 shadow-sm';
        adminTabBtn.className = 'px-4 py-2 rounded-lg text-sm font-semibold text-gray-400 hover:text-white hover:bg-gray-800 transition flex items-center space-x-2';
        loanSection?.classList.remove('hidden');
        adminSection?.classList.add('hidden');
        loadApprovals();
    } else {
        loanTabBtn.className = 'px-4 py-2 rounded-lg text-sm font-semibold text-gray-400 hover:text-white hover:bg-gray-800 transition flex items-center space-x-2';
        adminTabBtn.className = 'px-4 py-2 rounded-lg text-sm font-bold bg-red-600 text-white transition flex items-center space-x-2 shadow-sm';
        loanSection?.classList.add('hidden');
        adminSection?.classList.remove('hidden');
        loadAdminRequests();
    }
}

function refreshApprovalsView() {
    loadApprovals();
    if (currentUser && currentUser.role === 'Admin') {
        loadAdminRequests();
    }
    updatePendingBadges();
}

async function loadAdminRequests() {
    const container = document.getElementById('admin-requests-list');
    if (!container) return;

    if (!currentUser || currentUser.role !== 'Admin') {
        container.innerHTML = '<div class="py-8 text-center text-gray-500">เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถตรวจสอบคำขอนี้ได้</div>';
        return;
    }

    try {
        container.innerHTML = '<div class="py-12 text-center text-gray-400">กำลังโหลดคำขอสร้างบัญชี Admin...</div>';
        const requests = await api('/admin-requests');
        container.innerHTML = '';

        const badgeCount = document.getElementById('tab-admins-count');
        if (badgeCount) {
            badgeCount.innerText = requests.length;
            if (requests.length > 0) badgeCount.classList.remove('hidden');
            else badgeCount.classList.add('hidden');
        }

        if (requests.length === 0) {
            container.innerHTML = `
                <div class="card-dark p-8 rounded-xl text-center text-gray-500 border border-gray-800">
                    <div class="text-3xl mb-2">🛡️</div>
                    <p class="text-base font-bold text-gray-300">ไม่มีคำขอสร้างบัญชี Admin ที่รอการอนุมัติในขณะนี้</p>
                    <p class="text-xs text-gray-500 mt-1">เมื่อมีผู้ใช้งานใหม่ลงทะเบียนด้วยสิทธิ์ Admin รายการคำขอจะปรากฏที่นี่เพื่อให้คุณกดยอมรับ</p>
                </div>
            `;
            return;
        }

        requests.forEach(req => {
            const el = document.createElement('div');
            el.className = 'card-dark p-6 rounded-xl border border-red-900/40 space-y-4 shadow-xl';

            const reqDate = req.createdAt ? new Date(req.createdAt).toLocaleString('th-TH') : '-';

            el.innerHTML = `
                <div class="flex flex-wrap justify-between items-start gap-2 border-b border-gray-800 pb-3">
                    <div>
                        <span class="bg-red-950/80 text-red-300 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-red-800">
                            🛡️ คำขอสร้างบัญชีผู้ดูแลระบบ (Admin Request)
                        </span>
                        <h4 class="font-bold text-lg text-white mt-1">${esc(req.name)}</h4>
                        <div class="text-xs text-gray-400">รหัสผู้ใช้งาน: <strong class="text-white font-mono">${esc(req.studentId)}</strong> • สิทธิ์ที่ขอ: <span class="text-red-400 font-bold">Admin</span></div>
                    </div>
                    <div class="text-xs text-right text-gray-400">
                        <div>ยื่นคำขอเมื่อ: <span class="text-gray-300">${reqDate}</span></div>
                        <div class="text-yellow-400 font-medium">สถานะ: รอ Admin อนุมัติ</div>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 bg-[#242424] p-3 rounded-lg border border-gray-800 text-xs">
                    <div>
                        <span class="text-gray-400 font-semibold">คณะ / สังกัด:</span>
                        <div class="text-white font-medium mt-0.5">${esc(req.faculty || '-')}</div>
                    </div>
                    <div>
                        <span class="text-gray-400 font-semibold">อีเมล:</span>
                        <div class="text-white font-medium mt-0.5">${esc(req.email || '-')}</div>
                    </div>
                    <div>
                        <span class="text-gray-400 font-semibold">เบอร์โทรศัพท์:</span>
                        <div class="text-white font-medium mt-0.5">${esc(req.phone || '-')}</div>
                    </div>
                </div>

                <div class="pt-3 border-t border-gray-800 flex justify-end space-x-3">
                    <button onclick="rejectAdminRequest('${req._id}', '${esc(req.name)}')" class="card-subtle px-4 py-2 rounded-lg text-xs font-semibold text-gray-300 hover:text-red-400 border border-gray-700">
                        ✕ ปฏิเสธคำขอ
                    </button>
                    <button onclick="approveAdminRequest('${req._id}', '${esc(req.name)}')" class="bg-green-600 hover:bg-green-500 text-white px-5 py-2 rounded-lg text-xs font-bold flex items-center space-x-1.5 shadow-lg">
                        <span>✓ กดยอมรับคำขอ (อนุมัติสิทธิ์ Admin)</span>
                    </button>
                </div>
            `;
            container.appendChild(el);
        });
    } catch (err) {
        container.innerHTML = `<div class="py-12 text-center text-red-400">${esc(err.message)}</div>`;
    }
}

async function approveAdminRequest(userId, userName) {
    if (!confirm(`ยืนยันการกดยอมรับคำขอสร้างบัญชี Admin สำหรับ "${userName}" หรือไม่?\\n\\nเมื่อกดยอมรับแล้ว ผู้ใช้นี้จะสามารถเข้าสู่ระบบและได้รับสิทธิ์ผู้ดูแลระบบทันที`)) return;
    try {
        const res = await api(`/admin-requests/${userId}/approve`, {
            method: 'PUT',
            body: JSON.stringify({ approverName: currentUser.name, approverId: currentUser.studentId })
        });
        alert(res.message || 'กดยอมรับคำขอสร้างบัญชี Admin สำเร็จ');
        loadAdminRequests();
        updatePendingBadges();
    } catch (err) {
        alert(err.message);
    }
}

async function rejectAdminRequest(userId, userName) {
    if (!confirm(`ยืนยันการปฏิเสธคำขอสร้างบัญชี Admin สำหรับ "${userName}" หรือไม่?`)) return;
    try {
        const res = await api(`/admin-requests/${userId}/reject`, {
            method: 'PUT',
            body: JSON.stringify({ rejectedBy: currentUser.name })
        });
        alert(res.message || 'ปฏิเสธคำขอเรียบร้อยแล้ว');
        loadAdminRequests();
        updatePendingBadges();
    } catch (err) {
        alert(err.message);
    }
}

// ==========================================
// 8. PROJECT & GROUP OVERVIEW (For Professors)
// ==========================================

async function loadProjectsSummary() {
    const container = document.getElementById('projects-summary-grid');
    if (!container) return;

    const advisorFilter = document.getElementById('project-filter-advisor')?.value.trim() || '';
    let query = '';
    if (advisorFilter) query = `?advisor=${encodeURIComponent(advisorFilter)}`;

    try {
        container.innerHTML = '<div class="col-span-full py-12 text-center text-gray-400">กำลังสรุปข้อมูลโครงงาน...</div>';
        const summary = await api(`/projects/summary${query}`);
        container.innerHTML = '';

        if (summary.length === 0) {
            container.innerHTML = `<div class="col-span-full py-12 text-center text-gray-500">ไม่พบข้อมูลโครงงาน</div>`;
            return;
        }

        summary.forEach(p => {
            const el = document.createElement('div');
            el.className = 'card-dark p-6 rounded-xl border border-gray-800 space-y-4 shadow-lg';
            
            const hasOverdue = p.overdueLoansCount > 0;
            const itemsList = p.itemsSummary.map(i => `<span class="bg-[#262626] px-2 py-1 rounded text-xs text-gray-300 border border-gray-700">${esc(i)}</span>`).join(' ');

            el.innerHTML = `
                <div class="flex justify-between items-start border-b border-gray-800 pb-3">
                    <div>
                        <h4 class="font-bold text-white text-lg">${esc(p.project)}</h4>
                        <div class="text-xs text-gray-400 mt-0.5">กลุ่ม: <strong class="text-gray-200">${esc(p.group)}</strong> • ที่ปรึกษา: <strong class="text-red-400">${esc(p.advisor)}</strong></div>
                    </div>
                    <span class="px-2.5 py-1 rounded-full text-xs font-bold ${hasOverdue ? 'bg-red-950 text-red-300 border border-red-800' : 'bg-blue-950 text-blue-300 border border-blue-800'}">
                        ${hasOverdue ? `⚠️ เกินกำหนด ${p.overdueLoansCount} รายการ` : `ยืมอยู่ ${p.activeLoansCount} รายการ`}
                    </span>
                </div>

                <div class="space-y-3 text-xs">
                    <div>
                        <span class="text-gray-400 font-semibold block mb-1">สมาชิกในโครงงาน:</span>
                        <div class="text-gray-200">${p.students.map(s => `• ${esc(s)}`).join('<br>')}</div>
                    </div>

                    <div>
                        <span class="text-gray-400 font-semibold block mb-1.5">อุปกรณ์ทั้งหมดที่ยืมใช้งานในโครงงานนี้:</span>
                        <div class="flex flex-wrap gap-1.5">
                            ${itemsList || '<span class="text-gray-500">ไม่มีอุปกรณ์ที่ยืม</span>'}
                        </div>
                    </div>
                </div>

                <div class="pt-3 border-t border-gray-800 flex justify-between text-xs text-gray-400">
                    <span>ประวัติคำขอทั้งหมด: <strong class="text-white">${p.loansCount}</strong> ครั้ง</span>
                    <button onclick="filterActiveLoansByProject('${esc(p.project)}')" class="text-red-400 hover:underline">
                        ดูรายการยืมของกลุ่มนี้ &rarr;
                    </button>
                </div>
            `;
            container.appendChild(el);
        });
    } catch (err) {
        container.innerHTML = `<div class="col-span-full py-12 text-center text-red-400">${esc(err.message)}</div>`;
    }
}

function filterActiveLoansByProject(projName) {
    showAppView('dashboard-view');
    const input = document.getElementById('dash-search-input');
    if (input) {
        input.value = projName;
        filterActiveLoansTable();
    }
}

// ==========================================
// 9. EQUIPMENT & STOCK MANAGEMENT (Admin CRUD)
// ==========================================

async function loadManageEquipment() {
    const tbody = document.getElementById('manage-equipment-table');
    if (!tbody) return;

    try {
        tbody.innerHTML = '<tr><td colspan="10" class="py-6 text-center text-gray-400">กำลังโหลดรายการสต็อก...</td></tr>';
        const eqList = await api('/equipment');
        tbody.innerHTML = '';

        if (eqList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="py-6 text-center text-gray-500">ยังไม่มีข้อมูลอุปกรณ์ในระบบ</td></tr>';
            return;
        }

        eqList.forEach(eq => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-800/40 transition border-b border-gray-800';
            tr.innerHTML = `
                <td class="py-3 px-3 font-mono font-bold text-gray-300">${esc(eq.equipmentId)}</td>
                <td class="py-3 px-3 font-bold text-white">${esc(eq.name)}</td>
                <td class="py-3 px-3">
                    <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${eq.type === 'วัสดุสิ้นเปลือง' ? 'badge-consumable' : 'badge-durable'}">
                        ${esc(eq.type)}
                    </span>
                </td>
                <td class="py-3 px-3 text-center font-mono font-bold">${eq.totalQuantity}</td>
                <td class="py-3 px-3 text-center font-mono font-bold text-emerald-400">${eq.remainingQuantity}</td>
                <td class="py-3 px-3 text-center font-mono font-bold text-blue-400">${eq.borrowedQuantity || 0}</td>
                <td class="py-3 px-3 text-center font-mono font-bold text-red-400">${(eq.damagedQuantity || 0) + (eq.lostQuantity || 0)}</td>
                <td class="py-3 px-3 text-gray-400">${esc(eq.location || '-')}</td>
                <td class="py-3 px-3">
                    <span class="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-800 text-gray-300">
                        ${esc(eq.status)}
                    </span>
                </td>
                <td class="py-3 px-3 text-right space-x-2">
                    <button onclick="openEquipmentModal('${eq._id}')" class="text-blue-400 hover:underline">แก้ไข</button>
                    <button onclick="deleteEquipment('${eq._id}', '${esc(eq.name)}')" class="text-red-400 hover:underline">ลบ</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="10" class="py-6 text-center text-red-400">${esc(err.message)}</td></tr>`;
    }
}

function openEquipmentModal(eqId = null) {
    const modal = document.getElementById('equipment-modal');
    const title = document.getElementById('modal-eq-title');
    document.getElementById('modal-eq-id').value = eqId || '';

    if (eqId) {
        title.innerText = 'แก้ไขข้อมูลอุปกรณ์';
        api(`/equipment/${eqId}`).then(eq => {
            document.getElementById('modal-eq-code').value = eq.equipmentId;
            document.getElementById('modal-eq-code').readOnly = true;
            document.getElementById('modal-eq-name').value = eq.name;
            document.getElementById('modal-eq-type').value = eq.type;
            document.getElementById('modal-eq-location').value = eq.location || '';
            document.getElementById('modal-eq-total').value = eq.totalQuantity;
            document.getElementById('modal-eq-remaining').value = eq.remainingQuantity;
            document.getElementById('modal-eq-status').value = eq.status;
            document.getElementById('modal-eq-image').value = eq.image || '';
            document.getElementById('modal-eq-desc').value = eq.description || '';
        });
    } else {
        title.innerText = 'เพิ่มอุปกรณ์ใหม่เข้าคลัง';
        document.getElementById('modal-eq-code').value = '';
        document.getElementById('modal-eq-code').readOnly = false;
        document.getElementById('modal-eq-name').value = '';
        document.getElementById('modal-eq-type').value = 'ครุภัณฑ์';
        document.getElementById('modal-eq-location').value = 'Cabinet A, Shelf 1';
        document.getElementById('modal-eq-total').value = '10';
        document.getElementById('modal-eq-remaining').value = '10';
        document.getElementById('modal-eq-status').value = 'พร้อมใช้งาน';
        document.getElementById('modal-eq-image').value = '';
        document.getElementById('modal-eq-desc').value = '';
    }

    modal.classList.remove('hidden');
}

function closeEquipmentModal() {
    document.getElementById('equipment-modal').classList.add('hidden');
}

async function handleEquipmentFormSubmit(e) {
    e.preventDefault();
    const eqId = document.getElementById('modal-eq-id').value;
    const payload = {
        equipmentId: document.getElementById('modal-eq-code').value.trim(),
        name: document.getElementById('modal-eq-name').value.trim(),
        type: document.getElementById('modal-eq-type').value,
        location: document.getElementById('modal-eq-location').value.trim(),
        totalQuantity: parseInt(document.getElementById('modal-eq-total').value) || 0,
        remainingQuantity: parseInt(document.getElementById('modal-eq-remaining').value) || 0,
        status: document.getElementById('modal-eq-status').value,
        image: document.getElementById('modal-eq-image').value.trim(),
        description: document.getElementById('modal-eq-desc').value.trim()
    };

    try {
        if (eqId) {
            await api(`/equipment/${eqId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            alert('อัปเดตข้อมูลอุปกรณ์สำเร็จ');
        } else {
            await api('/equipment', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            alert('เพิ่มอุปกรณ์ใหม่เข้าคลังสำเร็จ');
        }
        closeEquipmentModal();
        loadManageEquipment();
        loadEquipment();
    } catch (err) {
        alert(err.message);
    }
}

async function deleteEquipment(id, name) {
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบอุปกรณ์ "${name}" ออกจากระบบ?`)) return;
    try {
        await api(`/equipment/${id}`, { method: 'DELETE' });
        alert('ลบอุปกรณ์เรียบร้อยแล้ว');
        loadManageEquipment();
        loadEquipment();
    } catch (err) {
        alert(err.message);
    }
}

// ==========================================
// INITIALIZATION
// ==========================================
window.onload = () => {
    checkAuth();
    initLoanFormDates();
};
