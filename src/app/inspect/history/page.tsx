export const dynamic = 'force-dynamic';

export default function InspectHistoryPage() {
  return (
    <div
      style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: '2rem 1.25rem',
      }}
    >
      <div
        style={{
          background: '#fff',
          border: '2px solid #0a0a0a',
          borderTop: '6px solid #DC2626',
          borderRadius: '1rem',
          padding: '2.5rem 2rem',
          textAlign: 'center',
          boxShadow: '0 4px 12px -2px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ fontSize: '3.5rem', marginBottom: '0.75rem' }}>📋</div>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 800,
            color: '#0a0a0a',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            marginBottom: '0.4rem',
          }}
        >
          ประวัติตรวจสอบ
        </h1>
        <div
          style={{
            color: '#DC2626',
            fontWeight: 700,
            fontSize: '0.75rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            marginBottom: '1.25rem',
          }}
        >
          Inspection History
        </div>
        <p style={{ color: '#4B5563', lineHeight: 1.6 }}>
          ประวัติการตรวจสอบสินค้าทั้งหมด — สำหรับคลัง / จัดซื้อ / ผู้บริหาร / QC
          <br />
          ฟีเจอร์เต็มกำลังพัฒนาอยู่
        </p>
      </div>
    </div>
  );
}
