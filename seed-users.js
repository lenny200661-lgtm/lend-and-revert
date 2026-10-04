require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('./models/User');
const Equipment = require('./models/Equipment');
const Loan = require('./models/Loan');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lend-and-revert';

if (MONGO_URI.startsWith('mongodb+srv://')) {
    require('dns').setServers(['8.8.8.8', '1.1.1.1']);
}

const seedDatabase = async () => {
    try {
        await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
        console.log(`Connected to database: ${mongoose.connection.name}`);

        // 1. Seed Users (Admin, Professor, Students)
        const salt = await bcrypt.genSalt(10);
        const defaultPassword = await bcrypt.hash('password123', salt);

        const usersData = [
            {
                studentId: 'admin01',
                password: defaultPassword,
                name: 'พี่ตั้ม (ผู้ดูแลแล็บ)',
                role: 'Admin',
                faculty: 'หน่วยงานสนับสนุน / เจ้าหน้าที่',
                phone: '081-234-5678',
                email: 'staff.tum@university.ac.th'
            },
            {
                studentId: 'prof01',
                password: defaultPassword,
                name: 'อ.เบียร์ (ดร.เอกสิทธิ์)',
                role: 'Professor',
                faculty: 'คณะวิศวกรรมศาสตร์',
                phone: '089-987-6543',
                email: 'beer.eakasit@university.ac.th'
            },
            {
                studentId: '66010482',
                password: defaultPassword,
                name: 'นายกิตติคุณ ชัยมงคล',
                role: 'Student',
                faculty: 'คณะวิศวกรรมศาสตร์',
                phone: '082-111-2233',
                email: 'kittikun.c@student.ac.th'
            },
            {
                studentId: '65020194',
                password: defaultPassword,
                name: 'น.ส.แพรวา ทวีสุข',
                role: 'Student',
                faculty: 'คณะวิศวกรรมศาสตร์',
                phone: '083-444-5566',
                email: 'praewa.t@student.ac.th'
            },
            {
                studentId: '66010001',
                password: defaultPassword,
                name: 'นัทที นักศึกษา',
                role: 'Student',
                faculty: 'คณะวิศวกรรมศาสตร์',
                phone: '085-777-8899',
                email: 'natthee@student.ac.th'
            }
        ];

        for (const u of usersData) {
            const exists = await User.findOne({ studentId: u.studentId });
            if (!exists) {
                await User.create(u);
                console.log(`Created user: ${u.studentId} (${u.role}) - ${u.name}`);
            }
        }

        // 2. Seed Equipment matching PDF design
        const equipmentData = [
            {
                equipmentId: 'EQ-OSC-012',
                name: 'Digital Storage Oscilloscope 50MHz',
                type: 'ครุภัณฑ์',
                totalQuantity: 10,
                remainingQuantity: 8,
                borrowedQuantity: 2,
                damagedQuantity: 0,
                lostQuantity: 0,
                location: 'Cabinet A, Shelf 2',
                description: 'เครื่องวัดสัญญาณดิจิทัล 50MHz 2 แชนแนล พร้อมสายโพรบครบชุด',
                status: 'พร้อมใช้งาน'
            },
            {
                equipmentId: 'EQ-ESP-042',
                name: 'ESP32 DevKit V1 (Type-C)',
                type: 'ครุภัณฑ์',
                totalQuantity: 50,
                remainingQuantity: 38,
                borrowedQuantity: 12,
                damagedQuantity: 0,
                lostQuantity: 0,
                location: 'ตู้ B, ชั้น 1',
                description: 'ไมโครคอนโทรลเลอร์ ESP32 30-Pin Type-C รองรับ Wi-Fi / Bluetooth',
                status: 'พร้อมใช้งาน'
            },
            {
                equipmentId: 'EQ-ESP-033',
                name: 'ESP32 DevKit V1 + เซนเซอร์ IMU 9-Axis',
                type: 'ครุภัณฑ์',
                totalQuantity: 20,
                remainingQuantity: 18,
                borrowedQuantity: 2,
                damagedQuantity: 0,
                lostQuantity: 0,
                location: 'ตู้ B, ชั้น 2',
                description: 'ชุดทดลองหุ่นยนต์ทรงตัวพร้อมเซนเซอร์ Gyroscope & Accelerometer',
                status: 'พร้อมใช้งาน'
            },
            {
                equipmentId: 'EQ-PWR-008',
                name: 'DC Regulated Power Supply 30V 5A',
                type: 'ครุภัณฑ์',
                totalQuantity: 8,
                remainingQuantity: 7,
                borrowedQuantity: 1,
                damagedQuantity: 0,
                lostQuantity: 0,
                location: 'ตู้ C, ชั้น 1',
                description: 'แหล่งจ่ายไฟตรงปรับค่าได้ 0-30V 0-5A หน้าจอ LED ดิจิทัล',
                status: 'พร้อมใช้งาน'
            },
            {
                equipmentId: 'EQ-SRV-024',
                name: 'SG90 Micro Servo Motor 9g',
                type: 'วัสดุสิ้นเปลือง',
                totalQuantity: 100,
                remainingQuantity: 80,
                borrowedQuantity: 20,
                damagedQuantity: 2,
                lostQuantity: 0,
                location: 'ตู้ A, ชั้น 3',
                description: 'เซอร์โวมอเตอร์ขนาดเล็ก 180 องศา แรงบิด 1.8 kg-cm สำหรับโครงงานแขนกล',
                status: 'พร้อมใช้งาน'
            },
            {
                equipmentId: 'EQ-JMP-001',
                name: 'Jumper Wire (ผู้-เมีย 40 เส้น)',
                type: 'วัสดุสิ้นเปลือง',
                totalQuantity: 200,
                remainingQuantity: 150,
                borrowedQuantity: 50,
                damagedQuantity: 0,
                lostQuantity: 0,
                location: 'ตู้ A, ลิ้นชัก 1',
                description: 'สายต่อวงจรทดลองบอร์ดแผงทดลอง ความยาว 20cm',
                status: 'พร้อมใช้งาน'
            },
            {
                equipmentId: 'EQ-OSC-003',
                name: 'Handheld Digital Oscilloscope 100MHz',
                type: 'ครุภัณฑ์',
                totalQuantity: 4,
                remainingQuantity: 2,
                borrowedQuantity: 1,
                damagedQuantity: 1,
                lostQuantity: 0,
                location: 'ตู้ A, ชั้น 2',
                description: 'ช่องอินพุต CH1 มีสัญญาณรบกวนสูงผิดปกติ คาดว่าภาค Analog Front-end เสียหาย รอส่งซ่อม',
                status: 'ชำรุด'
            }
        ];

        for (const eq of equipmentData) {
            const exists = await Equipment.findOne({ equipmentId: eq.equipmentId });
            if (!exists) {
                await Equipment.create(eq);
                console.log(`Created equipment: ${eq.equipmentId} - ${eq.name}`);
            }
        }

        // 3. Seed Realistic Loans matching PDF
        const osc = await Equipment.findOne({ equipmentId: 'EQ-OSC-012' });
        const esp = await Equipment.findOne({ equipmentId: 'EQ-ESP-033' });
        const pwr = await Equipment.findOne({ equipmentId: 'EQ-PWR-008' });

        if (osc && esp && pwr) {
            const loansCount = await Loan.countDocuments();
            if (loansCount === 0) {
                const now = new Date();
                const dueSoon = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000); // 4 days later
                const overdue = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days overdue
                const dueLater = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days later

                await Loan.create([
                    {
                        studentId: '66010482',
                        studentName: 'นายกิตติคุณ ชัยมงคล',
                        group: 'หุ่นยนต์ ปี 3',
                        advisor: 'อ.เบียร์ (ดร.เอกสิทธิ์)',
                        project: 'Robot Arm Vision System',
                        purpose: 'ใช้ต่อวงจรและขับมอเตอร์โครงงานแขนกลตรวจจับวัตถุ สำหรับงานประกวดนวัตกรรม',
                        borrowDate: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
                        dueDate: dueSoon,
                        status: 'กำลังยืม',
                        approvedBy: 'อ.เบียร์ (ดร.เอกสิทธิ์)',
                        approvedDate: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
                        items: [{ equipmentId: osc._id, quantity: 1, returnedQuantity: 0, conditionOnReturn: 'ปกติ' }]
                    },
                    {
                        studentId: '65020194',
                        studentName: 'น.ส.แพรวา ทวีสุข',
                        group: 'หุ่นยนต์ ปี 4',
                        advisor: 'อ.เบียร์ (ดร.เอกสิทธิ์)',
                        project: 'Senior Project: AGV Balance',
                        purpose: 'ทดสอบอัลกอริทึมควบคุมหุ่นยนต์ AGV ทรงตัวสองล้อในวิชา Robot Capstone I',
                        borrowDate: new Date(now.getTime() - 17 * 24 * 60 * 60 * 1000),
                        dueDate: overdue,
                        status: 'กำลังยืม',
                        approvedBy: 'พี่ตั้ม (ผู้ดูแลแล็บ)',
                        approvedDate: new Date(now.getTime() - 17 * 24 * 60 * 60 * 1000),
                        items: [{ equipmentId: esp._id, quantity: 2, returnedQuantity: 0, conditionOnReturn: 'ปกติ' }]
                    },
                    {
                        studentId: '66010001',
                        studentName: 'นัทที นักศึกษา',
                        group: 'หุ่นยนต์ ปี 3',
                        advisor: 'อ.เบียร์ (ดร.เอกสิทธิ์)',
                        project: 'Mini CNC Controller',
                        purpose: 'ทดสอบบอร์ดขับสเต็ปเปอร์มอเตอร์ 3 แกน สำหรับโครงงานเครื่องแกะสลัก',
                        borrowDate: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
                        dueDate: dueLater,
                        status: 'รออนุมัติ',
                        items: [{ equipmentId: pwr._id, quantity: 1, returnedQuantity: 0, conditionOnReturn: 'ปกติ' }]
                    }
                ]);
                console.log('Seeded sample active loans and pending requests.');
            }
        }

        console.log('Database seeding process completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Seeding error:', err);
        process.exit(1);
    }
};

seedDatabase();
