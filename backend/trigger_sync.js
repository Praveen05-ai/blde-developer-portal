import { processOfflineSyncQueue } from './src/services/syncManager.js';

async function main() {
  console.log("Triggering client-side offline sync queue reconciliation...");
  try {
    const result = await processOfflineSyncQueue();
    console.log("Sync Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error triggering sync:", err);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
