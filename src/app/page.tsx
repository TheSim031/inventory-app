import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>
          ระบบจัดการ<span>คลังพัสดุ</span>
        </h1>
        <p>Inventory · Requisition · Pick & Pack</p>
      </header>

      <div className={styles.grid}>
        <Link href="/request" className={`${styles.card} ${styles.cardAccent}`}>
          <div className={styles.icon}>📦</div>
          <h2>
            <small>For Employees</small>
            เบิกพัสดุ
          </h2>
          <p>สำหรับพนักงานที่ต้องการเบิกพัสดุ — รองรับการใช้งานบนมือถือ</p>
        </Link>

        <Link href="/in" className={`${styles.card} ${styles.cardDark}`}>
          <div className={styles.icon}>📥</div>
          <h2>
            <small>Warehouse · IN</small>
            รับของเข้าคลัง
          </h2>
          <p>บันทึกพัสดุที่นำเข้าใหม่ พร้อมตัดสต็อกอัตโนมัติ</p>
        </Link>

        <Link href="/out" className={`${styles.card} ${styles.cardDark}`}>
          <div className={styles.icon}>📤</div>
          <h2>
            <small>Warehouse · OUT</small>
            จัดของตามใบเบิก
          </h2>
          <p>รีวิวรายการ พิมพ์ใบจัด/ใบปะหน้า และยืนยันตัดสต็อก</p>
        </Link>
      </div>
    </div>
  );
}
