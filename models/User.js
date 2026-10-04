const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  studentId: { type: String, required: true, unique: true }, // รหัสนักศึกษา/บุคลากร
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, enum: ['Admin', 'Professor', 'Student'], default: 'Student' },
  faculty: { type: String, default: '' }, // คณะ (เลือกจากรายการ)
  department: { type: String, default: '' }, // (เดิม) สาขา/สังกัด — เก็บไว้เพื่อรองรับข้อมูลเก่า
  phone: { type: String, default: '' }, // เบอร์โทร
  email: { type: String, default: '' } // Email
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
