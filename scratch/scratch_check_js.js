import fs from 'fs';
import path from 'path';
import vm from 'vm';

const htmlPath = 'C:\\Users\\AIO-01\\.gemini\\antigravity\\scratch\\BLDE_os_Institutional_server\\backend\\frontend\\index.html';
const html = fs.readFileSync(htmlPath, 'utf8');

// Extract script content
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let scriptContent = '';

while ((match = scriptRegex.exec(html)) !== null) {
  scriptContent += match[1] + '\n';
}

// Mock browser globals to prevent reference errors during compilation
const sandbox = {
  window: {},
  document: {
    addEventListener: () => {},
  },
  navigator: {
    serviceWorker: {
      getRegistrations: () => Promise.resolve([]),
    },
  },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => {},
  },
  console: console,
  setTimeout: setTimeout,
  setInterval: setInterval,
  clearTimeout: clearTimeout,
  clearInterval: clearInterval,
};

try {
  const script = new vm.Script(scriptContent, { filename: 'index.html_script.js' });
  console.log('✅ Syntax Check Passed: No syntax errors found in index.html scripts.');
} catch (err) {
  console.error('❌ Syntax Check Failed:', err.stack);
}
