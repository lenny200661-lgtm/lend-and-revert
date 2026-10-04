const mongoose = require('mongoose');

const equipmentSchema = new mongoose.Schema({
  equipmentId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['ครุภัณฑ์', 'วัสดุสิ้นเปลือง'], required: true }, // Durable vs Consumable
  totalQuantity: { type: Number, required: true, default: 0 },
  remainingQuantity: { type: Number, required: true, default: 0 }, // พร้อมใช้งาน
  borrowedQuantity: { type: Number, default: 0 }, // ถูกยืม
  damagedQuantity: { type: Number, default: 0 }, // เสีย / ชำรุด
  lostQuantity: { type: Number, default: 0 }, // สูญหาย
  location: { type: String, default: 'Cabinet A, Shelf 1' },
  image: { type: String, default: '' },
  description: { type: String, default: '' },
  status: { 
    type: String, 
    enum: ['พร้อมใช้งาน', 'ถูกยืม', 'เสีย', 'ชำรุด', 'สูญหาย'], 
    default: 'พร้อมใช้งาน' 
  }
}, { timestamps: true });

module.exports = mongoose.model('Equipment', equipmentSchema);
