const mongoose = require('mongoose');

const loanItemSchema = new mongoose.Schema({
  equipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true },
  quantity: { type: Number, required: true, default: 1 },
  returnedQuantity: { type: Number, default: 0 },
  conditionOnReturn: { 
    type: String, 
    enum: ['ปกติ', 'ชำรุด', 'เสีย', 'สูญหาย'], 
    default: 'ปกติ' 
  },
  damageNote: { type: String, default: '' }
}, { _id: false });

const loanSchema = new mongoose.Schema({
  studentId: { type: String, required: true },
  studentName: { type: String, required: true },
  group: { type: String, default: '' }, // กลุ่ม เช่น "หุ่นยนต์ ปี 3", "กลุ่ม 1"
  advisor: { type: String, required: true }, // อาจารย์ที่ปรึกษา / ผู้รับรอง
  project: { type: String, required: true }, // โครงงาน / รายวิชา
  purpose: { type: String, required: true }, // วัตถุประสงค์
  note: { type: String, default: '' }, // หมายเหตุเพิ่มเติมจากผู้ยืม
  items: [loanItemSchema],
  borrowDate: { type: Date, default: Date.now },
  dueDate: { type: Date, required: true },
  returnDate: { type: Date },
  status: { 
    type: String, 
    enum: ['รออนุมัติ', 'กำลังยืม', 'ปฏิเสธ', 'คืนแล้ว', 'เกินกำหนด'], 
    default: 'รออนุมัติ' 
  },
  approvedBy: { type: String, default: '' },
  approvedDate: { type: Date },
  rejectedReason: { type: String, default: '' },
  returnedTo: { type: String, default: '' },
  inspectionNotes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Loan', loanSchema);
