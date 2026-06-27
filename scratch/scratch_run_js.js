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

// Minimal DOM implementation
class Element {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.style = {};
    this.classList = {
      add: (c) => {},
      remove: (c) => {},
    };
    this.children = [];
    this.addEventListener = () => {};
  }
  
  trim() {
    return this.value.trim();
  }
  
  appendChild(child) {
    this.children.push(child);
  }
  
  querySelector(selector) {
    return new Element();
  }
}

const elements = {
  'm-uname': new Element('m-uname'),
  'm-urole': new Element('m-urole'),
  'm-uemail': new Element('m-uemail'),
  'm-upw': new Element('m-upw'),
  'm-usite': new Element('m-usite'),
  'toast-container': new Element('toast-container'),
};

const sandbox = {
  window: {
    location: { protocol: 'http:', hostname: 'localhost' },
    addEventListener: () => {}
  },
  location: { protocol: 'http:', hostname: 'localhost' },
  document: {
    addEventListener: () => {},
    getElementById: (id) => {
      if (!elements[id]) {
        elements[id] = new Element(id);
      }
      return elements[id];
    },
    createElement: (tag) => {
      return new Element('', tag);
    },
    body: new Element('body', 'body'),
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

// Run the script to define functions in sandbox
const context = vm.createContext(sandbox);
const script = new vm.Script(scriptContent, { filename: 'index.html_script.js' });
script.runInContext(context);

// Now execute saveUser and check for runtime errors!
console.log('--- Running saveUser() in mocked environment ---');
try {
  // Mock the $ helper which might have been compiled in the sandbox
  context.saveUser().then(() => {
    console.log('✅ saveUser executed successfully without throwing.');
  }).catch((err) => {
    console.error('❌ saveUser promise rejected:', err);
  });
} catch (err) {
  console.error('❌ saveUser threw an exception:', err);
}
