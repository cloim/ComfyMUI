// Consistent SQLite backup for comfymui.db (WAL mode aware)
import { DatabaseSync } from 'node:sqlite';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const sourceDbPath = resolve(process.env.STATE_DB || 'data/comfymui.db');

if (!existsSync(sourceDbPath)) {
  console.log(`[Backup] Source database not found at ${sourceDbPath}. Nothing to backup.`);
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = resolve('data/backups');
mkdirSync(backupDir, { recursive: true });
const targetBackupPath = resolve(backupDir, `comfymui-${timestamp}.db`);

console.log(`[Backup] Opening source database: ${sourceDbPath}`);
const db = new DatabaseSync(sourceDbPath);

try {
  // Checkpoint WAL journals to ensure main database file has consistent, complete state
  console.log('[Backup] Running WAL checkpoint (TRUNCATE)...');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.close();

  // Safely copy the consolidated db file
  copyFileSync(sourceDbPath, targetBackupPath);
  console.log(`[Backup] Database backup completed successfully: ${targetBackupPath}`);
} catch (err) {
  console.error('[Backup] Backup failed:', err);
  process.exit(1);
}
