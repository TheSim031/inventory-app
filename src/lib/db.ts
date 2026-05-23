import Database from 'better-sqlite3';
import path from 'path';

// Define the database path (stored in the project root)
const dbPath = path.resolve(process.cwd(), 'inventory.db');

// Create a singleton instance for the database
const db = new Database(dbPath, { verbose: console.log });

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database tables
const initDb = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      stock INTEGER NOT NULL DEFAULT 0,
      image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS requisitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS requisition_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requisition_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      FOREIGN KEY (requisition_id) REFERENCES requisitions (id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items (id) ON DELETE CASCADE
    );
  `);

  // Insert mock data if items table is empty
  const count = db.prepare('SELECT COUNT(*) as count FROM items').get() as { count: number };
  if (count.count === 0) {
    const insertItem = db.prepare('INSERT INTO items (name, description, stock) VALUES (?, ?, ?)');
    insertItem.run('กระดาษ A4', 'กระดาษพิมพ์งานขนาด A4 80 แกรม', 50);
    insertItem.run('ปากกาน้ำเงิน', 'ปากกาลูกลื่นสีน้ำเงิน', 100);
    insertItem.run('แฟ้มเอกสาร', 'แฟ้มพลาสติกใส ขนาด F4', 30);
    insertItem.run('หมึกเครื่องพิมพ์', 'หมึกพิมพ์สีดำ (Black) รุ่นมาตรฐาน', 10);
    insertItem.run('คลิปหนีบกระดาษ', 'คลิปหนีบกระดาษสีดำเบอร์ 109', 200);
  }
};

// Call initialization
initDb();

export default db;
