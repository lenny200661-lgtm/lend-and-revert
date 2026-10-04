require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lend-and-revert';

// Node's built-in resolver fails SRV lookups on some Windows/ISP DNS setups.
// Only apply locally — on Vercel the platform resolver must be used.
if (MONGO_URI.startsWith('mongodb+srv://') && !process.env.VERCEL) {
  require('dns').setServers(['8.8.8.8', '1.1.1.1']);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB (cached across serverless invocations)
let connPromise = null;
function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!connPromise) {
    connPromise = mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
      .then(() => console.log(`MongoDB Connected: host=${mongoose.connection.host} db=${mongoose.connection.name}`))
      .catch(err => {
        connPromise = null; // allow retry on next request
        console.error(`MongoDB connection failed: ${err.message}`);
        throw err;
      });
  }
  return connPromise;
}
connectDB().catch(() => {});

// Import Models
const User = require('./models/User');
const Equipment = require('./models/Equipment');
const Loan = require('./models/Loan');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Fail fast if DB disconnected
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    return res.status(503).json({ error: 'ไม่สามารถเชื่อมต่อฐานข้อมูล MongoDB ได้ กรุณาตรวจสอบว่า MongoDB เปิดอยู่', detail: err.message });
  }
});

// ==========================================
// 1. AUTH & USER MANAGEMENT APIs
// ==========================================

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { studentId, password, name, role, faculty, phone, email } = req.body;
    if (!studentId || !password || !name || !faculty) {
      return res.status(400).json({ error: 'กรุณากรอกรหัสนักศึกษา/บุคลากร, ชื่อ-นามสกุล, คณะ และรหัสผ่าน' });
    }

    const trimmedId = studentId.trim();
    const existing = await User.findOne({ studentId: trimmedId });
    if (existing) {
      if (existing.status === 'รออนุมัติ') {
        return res.status(400).json({ error: 'รหัสผู้ใช้งานนี้ได้ส่งคำขอสร้างบัญชีแล้ว อยู่ระหว่างรอ Admin ท่านอื่นกดยอมรับคำขอ' });
      }
      return res.status(400).json({ error: 'มีผู้ใช้งานรหัสนี้ในระบบแล้ว' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    let userStatus = 'อนุมัติแล้ว';
    let requiresApproval = false;

    if (role === 'Admin') {
      // Check if there is an existing active Admin in the database
      const existingAdmin = await User.findOne({
        role: 'Admin',
        status: { $ne: 'รออนุมัติ' }
      });

      // If an active Admin already exists, new Admin registration MUST be approved by another Admin
      if (existingAdmin) {
        userStatus = 'รออนุมัติ';
        requiresApproval = true;
      }
    }

    const newUser = new User({
      studentId: trimmedId,
      password: hashedPassword,
      name: name.trim(),
      role: role || 'Student',
      faculty: String(faculty).trim(),
      phone: (phone || '').trim(),
      email: (email || '').trim(),
      status: userStatus
    });
    
    await newUser.save();

    if (requiresApproval) {
      return res.json({ 
        message: 'ส่งคำขอสร้างบัญชีผู้ดูแลระบบ (Admin) สำเร็จ! ระบบได้ส่งคำขอไปยัง Admin คนอื่นแล้ว กรุณารอให้ Admin กดยอมรับคำขอก่อนจึงจะเข้าสู่ระบบได้', 
        pendingApproval: true 
      });
    }

    res.json({ message: 'สมัครสมาชิกสำเร็จ', user: { studentId: newUser.studentId, name: newUser.name, role: newUser.role, faculty: newUser.faculty } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { studentId, password } = req.body;
    if (!studentId || !password) {
      return res.status(400).json({ error: 'กรุณากรอกรหัสผู้ใช้งานและรหัสผ่าน' });
    }
    const user = await User.findOne({ studentId: studentId.trim() });
    if (!user) return res.status(400).json({ error: 'ไม่พบรหัสผู้ใช้งานนี้' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'รหัสผ่านไม่ถูกต้อง' });

    if (user.status === 'รออนุมัติ') {
      return res.status(403).json({ 
        error: 'บัญชีผู้ดูแลระบบ (Admin) นี้อยู่ระหว่างรอการกดยอมรับคำขอจาก Admin ท่านอื่น กรุณารอการอนุมัติก่อนเข้าสู่ระบบ' 
      });
    }

    if (user.status === 'ปฏิเสธ') {
      return res.status(403).json({ 
        error: 'คำขอสร้างบัญชีผู้ดูแลระบบนี้ไม่ได้รับการอนุมัติจาก Admin' 
      });
    }

    res.json({ 
      message: 'เข้าสู่ระบบสำเร็จ', 
      user: { 
        id: user._id,
        studentId: user.studentId, 
        name: user.name, 
        role: user.role,
        faculty: user.faculty,
        phone: user.phone,
        email: user.email,
        status: user.status
      } 
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all users (Admin only)
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update user profile/role
app.put('/api/users/:id', async (req, res) => {
  try {
    const { name, role, faculty, phone, email } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id, 
      { name, role, faculty, phone, email },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get pending Admin registration requests (Admin only)
app.get('/api/admin-requests', async (req, res) => {
  try {
    const requests = await User.find({ role: 'Admin', status: 'รออนุมัติ' })
      .select('-password')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Approve Admin registration request (Existing Admin accepts request)
app.put('/api/admin-requests/:id/approve', async (req, res) => {
  try {
    const { approverName, approverId } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีผู้ใช้งานนี้' });
    if (user.role !== 'Admin') return res.status(400).json({ error: 'บัญชีนี้ไม่ใช่สิทธิ์ Admin' });
    if (user.status !== 'รออนุมัติ') {
      return res.status(400).json({ error: 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ' });
    }

    if (approverId && user.studentId === approverId) {
      return res.status(400).json({ error: 'ไม่สามารถกดยอมรับคำขอของตนเองได้ ต้องให้ Admin คนอื่นเป็นผู้กดยอมรับ' });
    }

    user.status = 'อนุมัติแล้ว';
    user.approvedBy = approverName || 'Admin';
    user.approvedAt = new Date();
    await user.save();

    res.json({ 
      message: `กดยอมรับคำขอสร้างบัญชี Admin สำหรับ "${user.name}" สำเร็จ`,
      user: {
        id: user._id,
        studentId: user.studentId,
        name: user.name,
        role: user.role,
        status: user.status
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reject Admin registration request (Existing Admin rejects request)
app.put('/api/admin-requests/:id/reject', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'ไม่พบบัญชีผู้ใช้งานนี้' });
    if (user.status !== 'รออนุมัติ') {
      return res.status(400).json({ error: 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ' });
    }

    const targetName = user.name;
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: `ปฏิเสธคำขอสร้างบัญชี Admin สำหรับ "${targetName}" เรียบร้อยแล้ว` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 2. EQUIPMENT & STOCK MANAGEMENT APIs
// ==========================================

// List Equipment with filters
app.get('/api/equipment', async (req, res) => {
  try {
    const { search, type, inStock } = req.query;
    let query = {};

    if (type && type !== 'ทั้งหมด') {
      query.type = type;
    }
    if (inStock === 'true') {
      query.remainingQuantity = { $gt: 0 };
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { equipmentId: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const items = await Equipment.find(query).sort({ equipmentId: 1 });
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get Single Equipment
app.get('/api/equipment/:id', async (req, res) => {
  try {
    const eq = isValidId(req.params.id) 
      ? await Equipment.findById(req.params.id)
      : await Equipment.findOne({ equipmentId: req.params.id });
    if (!eq) return res.status(404).json({ error: 'ไม่พบข้อมูลอุปกรณ์' });
    res.json(eq);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add Equipment (Admin)
app.post('/api/equipment', async (req, res) => {
  try {
    const { equipmentId, name, type, totalQuantity, remainingQuantity, location, image, description, status } = req.body;
    if (!equipmentId || !name || !type) {
      return res.status(400).json({ error: 'กรุณากรอกรหัสอุปกรณ์, ชื่อ และประเภท' });
    }

    const exists = await Equipment.findOne({ equipmentId: equipmentId.trim() });
    if (exists) return res.status(400).json({ error: `มีรหัสอุปกรณ์ ${equipmentId} ในระบบแล้ว` });

    const total = Number(totalQuantity) || 0;
    const remaining = remainingQuantity !== undefined ? Number(remainingQuantity) : total;

    const newEq = new Equipment({
      equipmentId: equipmentId.trim(),
      name: name.trim(),
      type,
      totalQuantity: total,
      remainingQuantity: remaining,
      borrowedQuantity: 0,
      damagedQuantity: 0,
      lostQuantity: 0,
      location: (location || 'Cabinet A, Shelf 1').trim(),
      image: (image || '').trim(),
      description: (description || '').trim(),
      status: status || (remaining > 0 ? 'พร้อมใช้งาน' : 'เสีย')
    });

    await newEq.save();
    res.status(201).json(newEq);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Update Equipment (Admin)
app.put('/api/equipment/:id', async (req, res) => {
  try {
    const { name, type, totalQuantity, remainingQuantity, borrowedQuantity, damagedQuantity, lostQuantity, location, image, description, status } = req.body;
    const eq = await Equipment.findById(req.params.id);
    if (!eq) return res.status(404).json({ error: 'ไม่พบอุปกรณ์ที่ต้องการแก้ไข' });

    if (name) eq.name = name.trim();
    if (type) eq.type = type;
    if (totalQuantity !== undefined) eq.totalQuantity = Number(totalQuantity);
    if (remainingQuantity !== undefined) eq.remainingQuantity = Number(remainingQuantity);
    if (borrowedQuantity !== undefined) eq.borrowedQuantity = Number(borrowedQuantity);
    if (damagedQuantity !== undefined) eq.damagedQuantity = Number(damagedQuantity);
    if (lostQuantity !== undefined) eq.lostQuantity = Number(lostQuantity);
    if (location !== undefined) eq.location = location.trim();
    if (image !== undefined) eq.image = image.trim();
    if (description !== undefined) eq.description = description.trim();
    if (status !== undefined) eq.status = status;

    await eq.save();
    res.json(eq);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Delete Equipment (Admin)
app.delete('/api/equipment/:id', async (req, res) => {
  try {
    const eq = await Equipment.findById(req.params.id);
    if (!eq) return res.status(404).json({ error: 'ไม่พบอุปกรณ์' });
    if (eq.borrowedQuantity > 0) {
      return res.status(400).json({ error: 'ไม่สามารถลบได้เนื่องจากอุปกรณ์กำลังถูกยืมอยู่' });
    }
    await Equipment.findByIdAndDelete(req.params.id);
    res.json({ message: 'ลบอุปกรณ์เรียบร้อยแล้ว' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 3. LOAN (BORROW - RETURN) APIs
// ==========================================

// List Loans with filtering & automatic overdue check
app.get('/api/loans', async (req, res) => {
  try {
    const { status, studentId, project, advisor } = req.query;
    let query = {};

    if (status && status !== 'ทั้งหมด') query.status = status;
    if (studentId) query.studentId = studentId;
    if (project) query.project = { $regex: project, $options: 'i' };
    if (advisor) query.advisor = { $regex: advisor, $options: 'i' };

    const loans = await Loan.find(query)
      .populate('items.equipmentId')
      .sort({ createdAt: -1 });

    // Mark overdue if active and past due date
    const now = new Date();
    const updatedLoans = loans.map(loan => {
      const loanObj = loan.toObject();
      if (loanObj.status === 'กำลังยืม' && new Date(loanObj.dueDate) < now) {
        loanObj.isOverdue = true;
      } else {
        loanObj.isOverdue = false;
      }
      return loanObj;
    });

    res.json(updatedLoans);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create Loan Request (Student) - Default status: "รออนุมัติ"
app.post('/api/loans', async (req, res) => {
  try {
    const { studentId, studentName, group, advisor, project, purpose, note, borrowDate, dueDate, items } = req.body;

    if (!studentId || !studentName || !project || !purpose || !dueDate) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลผู้ยืม, โครงงาน, วัตถุประสงค์ และกำหนดส่งคืนให้ครบถ้วน' });
    }

    // Validate loan period: due date must be after pickup and at most 14 days later
    const MAX_LOAN_DAYS = 14;
    const bDate = borrowDate ? new Date(borrowDate) : new Date();
    const dDate = new Date(dueDate);
    if (isNaN(bDate) || isNaN(dDate)) {
      return res.status(400).json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' });
    }
    const diffDays = Math.round((dDate - bDate) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) {
      return res.status(400).json({ error: 'กำหนดส่งคืนต้องอยู่หลังวันที่รับอุปกรณ์' });
    }
    if (diffDays > MAX_LOAN_DAYS) {
      return res.status(400).json({ error: `ระยะเวลายืมต้องไม่เกิน ${MAX_LOAN_DAYS} วัน` });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'กรุณาเลือกอุปกรณ์ที่ต้องการยืมอย่างน้อย 1 รายการ' });
    }

    // Resolve and validate each item
    const resolvedItems = [];
    for (const item of items) {
      const key = String(item.equipmentId || '').trim();
      const qty = Number(item.quantity) || 0;
      if (!key || qty < 1) return res.status(400).json({ error: 'จำนวนอุปกรณ์ต้องมากกว่าหรือเท่ากับ 1' });

      const eq = isValidId(key)
        ? await Equipment.findById(key)
        : await Equipment.findOne({ equipmentId: key });

      if (!eq) return res.status(404).json({ error: `ไม่พบอุปกรณ์รหัส ${key}` });
      if (eq.remainingQuantity < qty) {
        return res.status(400).json({ error: `${eq.name} คงเหลือไม่เพียงพอ (มีพร้อมใช้ ${eq.remainingQuantity} ชิ้น แต่ขอยืม ${qty} ชิ้น)` });
      }

      resolvedItems.push({
        equipmentId: eq._id,
        quantity: qty,
        returnedQuantity: 0,
        conditionOnReturn: 'ปกติ'
      });
    }

    const newLoan = new Loan({
      studentId: studentId.trim(),
      studentName: studentName.trim(),
      group: (group || '').trim(),
      advisor: (advisor || '').trim(),
      project: project.trim(),
      purpose: purpose.trim(),
      note: String(note || '').trim().slice(0, 500),
      borrowDate: bDate,
      dueDate: dDate,
      items: resolvedItems,
      status: 'รออนุมัติ' // Awaiting Admin verification & approval
    });

    await newLoan.save();
    const populated = await Loan.findById(newLoan._id).populate('items.equipmentId');
    res.status(201).json(populated);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Admin Approve Loan
app.put('/api/loans/:id/approve', async (req, res) => {
  try {
    const { approvedBy } = req.body;
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ error: 'ไม่พบคำขอยืม' });
    if (loan.status !== 'รออนุมัติ') {
      return res.status(400).json({ error: `ไม่สามารถอนุมัติได้เนื่องจากสถานะปัจจุบันคือ "${loan.status}"` });
    }

    // Check stock for all items before deducting
    for (const item of loan.items) {
      const eq = await Equipment.findById(item.equipmentId);
      if (!eq) return res.status(404).json({ error: 'มีอุปกรณ์ในรายการที่ไม่มีอยู่ในคลังแล้ว' });
      if (eq.remainingQuantity < item.quantity) {
        return res.status(400).json({ error: `${eq.name} คงเหลือไม่เพียงพอสำหรับการอนุมัติ (เหลือ ${eq.remainingQuantity})` });
      }
    }

    // Deduct remainingQuantity and increment borrowedQuantity
    for (const item of loan.items) {
      await Equipment.findByIdAndUpdate(item.equipmentId, {
        $inc: { 
          remainingQuantity: -item.quantity,
          borrowedQuantity: item.quantity 
        }
      });
    }

    loan.status = 'กำลังยืม';
    loan.approvedBy = approvedBy || 'Admin';
    loan.approvedDate = new Date();
    await loan.save();

    const populated = await Loan.findById(loan._id).populate('items.equipmentId');
    res.json({ message: 'อนุมัติการยืมสำเร็จ', loan: populated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin Reject Loan
app.put('/api/loans/:id/reject', async (req, res) => {
  try {
    const { rejectedReason, rejectedBy } = req.body;
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ error: 'ไม่พบคำขอยืม' });
    if (loan.status !== 'รออนุมัติ') {
      return res.status(400).json({ error: `คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ` });
    }

    loan.status = 'ปฏิเสธ';
    loan.rejectedReason = rejectedReason || 'ไม่ผ่านการอนุมัติ';
    await loan.save();

    res.json({ message: 'ปฏิเสธคำขอยืมเรียบร้อย', loan });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Check-in & Return with Condition Inspection & Stock Adjustment
app.put('/api/loans/:id/return', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'รหัสการยืมไม่ถูกต้อง' });

    const { returnedTo, inspectionNotes, itemsInspection } = req.body;
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ error: 'ไม่พบรายการยืมนี้' });
    if (loan.status === 'คืนแล้ว') return res.status(400).json({ error: 'รายการนี้ได้รับการบันทึกคืนไปแล้ว' });

    loan.status = 'คืนแล้ว';
    loan.returnDate = new Date();
    loan.returnedTo = (returnedTo || 'Admin').trim();
    loan.inspectionNotes = (inspectionNotes || '').trim();

    // Process return condition and adjust stock
    for (let i = 0; i < loan.items.length; i++) {
      const item = loan.items[i];
      const inspection = (itemsInspection && itemsInspection[i]) || {};
      const condition = inspection.condition || 'ปกติ'; // ปกติ, ชำรุด, เสีย, สูญหาย
      const damageNote = inspection.damageNote || '';

      item.conditionOnReturn = condition;
      item.returnedQuantity = item.quantity;
      item.damageNote = damageNote;

      const eq = await Equipment.findById(item.equipmentId);
      if (!eq) continue;

      // Adjust borrowed count
      const borrowedDec = Math.min(eq.borrowedQuantity, item.quantity);
      
      if (condition === 'ปกติ') {
        // Returned in good condition -> restore to available stock
        eq.remainingQuantity += item.quantity;
        eq.borrowedQuantity = Math.max(0, eq.borrowedQuantity - borrowedDec);
        if (eq.status === 'ถูกยืม' && eq.remainingQuantity > 0) {
          eq.status = 'พร้อมใช้งาน';
        }
      } else if (condition === 'ชำรุด' || condition === 'เสีย') {
        // Damaged / Broken -> do not add to remaining, record in damaged
        eq.damagedQuantity += item.quantity;
        eq.borrowedQuantity = Math.max(0, eq.borrowedQuantity - borrowedDec);
        if (eq.remainingQuantity === 0) {
          eq.status = 'ชำรุด';
        }
      } else if (condition === 'สูญหาย') {
        // Lost -> record in lostQuantity
        eq.lostQuantity += item.quantity;
        eq.borrowedQuantity = Math.max(0, eq.borrowedQuantity - borrowedDec);
        eq.totalQuantity = Math.max(0, eq.totalQuantity - item.quantity);
      }
      await eq.save();
    }

    await loan.save();
    const populated = await Loan.findById(loan._id).populate('items.equipmentId');
    res.json({ message: 'บันทึกการตรวจรับคืนและปรับปรุงสต็อกสำเร็จ', loan: populated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 4. DASHBOARD & STATISTICS APIs
// ==========================================

app.get('/api/stats', async (req, res) => {
  try {
    // Total stock metrics
    const totalEq = await Equipment.aggregate([{ $group: { _id: null, total: { $sum: "$totalQuantity" } } }]);
    const readyEq = await Equipment.aggregate([{ $group: { _id: null, total: { $sum: "$remainingQuantity" } } }]);
    const borrowedEq = await Equipment.aggregate([{ $group: { _id: null, total: { $sum: "$borrowedQuantity" } } }]);
    const damagedEq = await Equipment.aggregate([{ $group: { _id: null, total: { $sum: "$damagedQuantity" } } }]);
    const lostEq = await Equipment.aggregate([{ $group: { _id: null, total: { $sum: "$lostQuantity" } } }]);

    // Loan counts
    const pendingLoans = await Loan.countDocuments({ status: 'รออนุมัติ' });
    const pendingAdmins = await User.countDocuments({ role: 'Admin', status: 'รออนุมัติ' });
    const activeLoans = await Loan.countDocuments({ status: 'กำลังยืม' });
    const returnedLoans = await Loan.countDocuments({ status: 'คืนแล้ว' });

    // Overdue loans
    const now = new Date();
    const overdueLoans = await Loan.countDocuments({
      status: 'กำลังยืม',
      dueDate: { $lt: now }
    });

    // Consumables statistics: total consumable equipment and how many used
    const consumables = await Equipment.find({ type: 'วัสดุสิ้นเปลือง' });
    const totalConsumables = consumables.reduce((sum, e) => sum + e.totalQuantity, 0);
    const remainingConsumables = consumables.reduce((sum, e) => sum + e.remainingQuantity, 0);
    const usedConsumables = Math.max(0, totalConsumables - remainingConsumables);

    // Durable goods statistics
    const durables = await Equipment.find({ type: 'ครุภัณฑ์' });
    const totalDurables = durables.reduce((sum, e) => sum + e.totalQuantity, 0);
    const readyDurables = durables.reduce((sum, e) => sum + e.remainingQuantity, 0);

    // Damaged equipment log
    const damagedLogs = await Equipment.find({
      $or: [
        { damagedQuantity: { $gt: 0 } },
        { lostQuantity: { $gt: 0 } },
        { status: { $in: ['ชำรุด', 'เสีย', 'สูญหาย'] } }
      ]
    }).limit(10);

    res.json({
      totalEquipment: totalEq[0]?.total || 0,
      readyEquipment: readyEq[0]?.total || 0,
      borrowedEquipment: borrowedEq[0]?.total || 0,
      damagedEquipment: (damagedEq[0]?.total || 0) + (lostEq[0]?.total || 0),
      lostEquipment: lostEq[0]?.total || 0,
      pendingLoans,
      pendingAdmins,
      activeLoans,
      overdueLoans,
      returnedLoans,
      consumables: {
        total: totalConsumables,
        remaining: remainingConsumables,
        used: usedConsumables
      },
      durables: {
        total: totalDurables,
        ready: readyDurables
      },
      damagedLogs
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Project & Group Overview API (For Professors & Admins)
app.get('/api/projects/summary', async (req, res) => {
  try {
    const { advisor } = req.query;
    let query = {};
    if (advisor) query.advisor = { $regex: advisor, $options: 'i' };

    const loans = await Loan.find(query).populate('items.equipmentId').sort({ createdAt: -1 });

    // Group loans by project and group
    const projectMap = {};
    const now = new Date();

    loans.forEach(loan => {
      const projKey = loan.project || 'ไม่มีชื่อโครงงาน';
      if (!projectMap[projKey]) {
        projectMap[projKey] = {
          project: projKey,
          group: loan.group || '-',
          advisor: loan.advisor || '-',
          students: new Set(),
          loansCount: 0,
          activeLoansCount: 0,
          overdueLoansCount: 0,
          itemsBorrowed: {},
          recentDueDate: loan.dueDate,
          loans: []
        };
      }

      const p = projectMap[projKey];
      p.students.add(`${loan.studentName} (${loan.studentId})`);
      p.loansCount++;
      if (loan.status === 'กำลังยืม') {
        p.activeLoansCount++;
        if (new Date(loan.dueDate) < now) {
          p.overdueLoansCount++;
        }
      }

      // Aggregate items
      loan.items.forEach(item => {
        const name = item.equipmentId?.name || 'อุปกรณ์ไม่ระบุชื่อ';
        p.itemsBorrowed[name] = (p.itemsBorrowed[name] || 0) + item.quantity;
      });

      p.loans.push(loan);
    });

    const summary = Object.values(projectMap).map(p => ({
      ...p,
      students: Array.from(p.students),
      itemsSummary: Object.entries(p.itemsBorrowed).map(([name, qty]) => `${name} (${qty} ชิ้น)`)
    }));

    res.json(summary);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Unknown API routes return JSON 404
app.use('/api', (req, res) => res.status(404).json({ error: 'ไม่พบ API นี้' }));

// Serve Frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export for Vercel serverless; listen only when run directly (local dev)
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
