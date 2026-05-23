import Link from 'next/link';
import styles from './page.module.css';

export default function Home() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>ระบบจัดการคลังสินค้าและเบิกจ่ายพัสดุ</h1>
        <p>Inventory & Requisition System</p>
      </header>

      <div className={styles.grid}>
        <Link href="/request" className={styles.card}>
          <div className={styles.icon}>📦</div>
          <h2>ฝั่งผู้เบิกพัสดุ</h2>
          <p>เข้าสู่ระบบสำหรับพนักงานที่ต้องการเบิกพัสดุ (รองรับการใช้งานบนมือถือ)</p>
        </Link>

        <Link href="/warehouse" className={styles.card}>
          <div className={styles.icon}>🏢</div>
          <h2>ฝั่งคลังสินค้า</h2>
          <p>แดชบอร์ดสำหรับเจ้าหน้าที่คลัง จัดการออเดอร์และพิมพ์ใบปะหน้า</p>
        </Link>
      </div>
    </div>
  );
}
