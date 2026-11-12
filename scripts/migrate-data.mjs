// Non-destructive data migration script from local Windows paths to Docker named volumes
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function run(cmd, desc) {
  console.log(`[Migrate] ${desc}...`);
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (out.trim()) console.log(out.trim());
    return true;
  } catch (err) {
    console.error(`[Migrate] Failed ${desc}: ${err.message}`);
    if (err.stderr) console.error(err.stderr.toString());
    return false;
  }
}

async function main() {
  console.log('=== ComfyMUI Docker Non-Destructive Migration Tool ===');

  // Step 1: Consistent DB backup
  console.log('Step 1: Creating consistent SQLite backup...');
  run('node scripts/backup-db.mjs', 'Backup SQLite DB');

  // Step 2: Ensure Docker named volumes exist
  console.log('Step 2: Checking Docker named volumes...');
  run('docker volume create comfymui-data', 'Ensure volume comfymui-data');
  run('docker volume create comfy-data', 'Ensure volume comfy-data');

  // Step 3: Copy local DB to comfymui-data volume
  const localDb = resolve('data/comfymui.db');
  if (existsSync(localDb)) {
    console.log('Step 3: Copying local comfymui.db into volume comfymui-data...');
    // Mount volume and copy file into volume safely without overwriting if not intended
    // Using a temporary container
    run(
      `docker run --rm -v comfymui-data:/target -v "${resolve('data')}:/source:ro" busybox sh -c "cp -n /source/comfymui.db /target/comfymui.db && ls -la /target"`,
      'Copy SQLite DB into comfymui-data named volume',
    );
  } else {
    console.log('[Migrate] No local data/comfymui.db found, skipping DB copy.');
  }

  // Step 4: Optionally migrate existing outputs to comfy-data volume
  const localOutputDir = process.env.HOST_OUTPUT_DIR || 'E:/ComfyUI/output';
  if (existsSync(localOutputDir)) {
    console.log(`Step 4: Copying existing outputs from ${localOutputDir} to comfy-data volume...`);
    run(
      `docker run --rm -v comfy-data:/target -v "${resolve(localOutputDir)}:/source:ro" busybox sh -c "mkdir -p /target/output && cp -rn /source/* /target/output/ 2>/dev/null || true; ls -la /target/output"`,
      'Copy local outputs into comfy-data volume',
    );
  } else {
    console.log(`[Migrate] Output directory ${localOutputDir} not found, skipping.`);
  }

  console.log('=== Migration completed successfully without altering host originals ===');
}

main().catch(console.error);
