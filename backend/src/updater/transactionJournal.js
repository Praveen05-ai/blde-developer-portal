import fs from 'fs';
import path from 'path';
import { runtime } from '../config/runtimeConfig.js';

const journalPath = path.join(runtime.storagePaths.temp, 'update_transaction.json');
const tempJournalPath = path.join(runtime.storagePaths.temp, 'update_transaction.tmp.json');

/**
 * Loads the current transaction journal checkpoints list.
 * Survives system reboot / process crash states.
 */
export const loadJournal = () => {
  if (!fs.existsSync(journalPath)) {
    return [];
  }
  try {
    const rawData = fs.readFileSync(journalPath, 'utf8');
    return JSON.parse(rawData);
  } catch (err) {
    console.error(`⚠️  [JOURNAL CORRUPTION] Failed to parse transaction journal: ${err.message}`);
    // Return empty fallback list to trigger self-healing rollback blocks
    return [];
  }
};

/**
 * Appends an execution checkpoint atomically into the journal.
 * - Writes to a temporary file first
 * - Uses atomic fs.renameSync to overwrite the active journal file (fsync-safe)
 */
export const appendCheckpoint = (step, completed = false) => {
  const checkpoints = loadJournal();
  
  // Update or append checkpoint
  const existingIndex = checkpoints.findIndex(cp => cp.step === step);
  const newCheckpoint = {
    step,
    completed,
    timestamp: new Date().toISOString()
  };

  if (existingIndex >= 0) {
    checkpoints[existingIndex] = newCheckpoint;
  } else {
    checkpoints.push(newCheckpoint);
  }

  try {
    // 1. Write stringified data to a temporary file
    fs.writeFileSync(tempJournalPath, JSON.stringify(checkpoints, null, 2), 'utf8');
    
    // 2. Atomically rename the temp file to target file (guarantees zero partial write states)
    fs.renameSync(tempJournalPath, journalPath);
    
    // 3. Fsync to disk
    const fd = fs.openSync(journalPath, 'r+');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch (err) {
    console.error(`❌ [JOURNAL WRITE FAULT] Failed to write journal checkpoints atomically: ${err.message}`);
    throw err;
  }
};

/**
 * Clears the transaction journal safely.
 */
export const clearJournal = () => {
  try {
    if (fs.existsSync(journalPath)) {
      fs.unlinkSync(journalPath);
    }
    if (fs.existsSync(tempJournalPath)) {
      fs.unlinkSync(tempJournalPath);
    }
  } catch (err) {
    console.error(`⚠️  Failed to clear transaction journal: ${err.message}`);
  }
};

export default {
  loadJournal,
  appendCheckpoint,
  clearJournal
};
