import { spawn } from 'child_process';
import path from 'path';

const pgBin = 'C:\\Program Files\\PostgreSQL\\17\\bin';
const dataDir = 'C:\\Users\\IIC 05\\.gemini\\antigravity\\scratch\\pg_data';

console.log('🚀 [START ALL] Starting private PostgreSQL database and backend server...');

// 1. Spawn PostgreSQL server process
const pgProcess = spawn(path.join(pgBin, 'postgres.exe'), ['-D', dataDir]);

pgProcess.stdout.on('data', (data) => {
  console.log(`[PostgreSQL] ${data.toString().trim()}`);
});

pgProcess.stderr.on('data', (data) => {
  console.error(`[PostgreSQL Error] ${data.toString().trim()}`);
});

pgProcess.on('close', (code) => {
  console.log(`[PostgreSQL] Process exited with code ${code}`);
});

// Helper to run a command and return a promise
function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`🏃 Running: ${cmd} ${args.join(' ')}`);
    // Quote the command if it contains spaces to prevent Windows shell parsing issues
    const formattedCmd = cmd.includes(' ') ? `"${cmd}"` : cmd;
    const proc = spawn(formattedCmd, args, { stdio: 'inherit', shell: true, ...options });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
  });
}

// 2. Wait for PostgreSQL to be ready and then run migrations & seeds
setTimeout(async () => {
  try {
    console.log('🔍 [START ALL] Verifying PostgreSQL is ready...');
    await runCommand(path.join(pgBin, 'pg_isready.exe'), ['-p', '5432']);
    
    console.log('🔄 [START ALL] Running database migrations...');
    await runCommand('npm.cmd', ['run', 'migrate:latest']);
    
    console.log('🌱 [START ALL] Running database seeds...');
    await runCommand('npm.cmd', ['run', 'seed:run']);
    
    console.log('🚀 [START ALL] Database is fully ready. Launching backend server...');
    const backendProcess = spawn('npx', ['nodemon', 'src/index.js'], { stdio: 'inherit', shell: true });
    
    backendProcess.on('close', (code) => {
      console.log(`[Backend] Process exited with code ${code}`);
      pgProcess.kill();
      process.exit(code);
    });
    
  } catch (err) {
    console.error('❌ [START ALL] Failed to initialize database:', err.message);
    pgProcess.kill();
    process.exit(1);
  }
}, 4000);

// Handle termination signals
process.on('SIGINT', () => {
  console.log('Shutting down processes...');
  pgProcess.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down processes...');
  pgProcess.kill();
  process.exit(0);
});
