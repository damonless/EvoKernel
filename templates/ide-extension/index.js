// Universal CommonJS-to-ESM Bridge for VS Code Extension Host
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const url = require('node:url');

function resolveExtensionEntry() {
  const homeDir = os.homedir ? os.homedir() : (process.env.HOME || process.env.USERPROFILE || '');
  const candidates = [
    // 1. Direct relative dist entry if mounted via junction/symlink from templates/ide-extension
    path.resolve(__dirname, '..', '..', 'dist', 'ide', 'vscode-extension.js'),
    path.resolve(__dirname, 'dist', 'ide', 'vscode-extension.js'),
    path.resolve(__dirname, 'vscode-extension.js'),
  ];

  // 2. Explicit environment variable override
  if (process.env.EVO_KERNEL_ROOT) {
    candidates.push(path.join(path.resolve(process.env.EVO_KERNEL_ROOT), 'dist', 'ide', 'vscode-extension.js'));
  }

  // 3. User host plugin installations
  if (homeDir) {
    candidates.push(
      path.join(homeDir, '.gemini', 'config', 'plugins', 'evo-kernel', 'dist', 'ide', 'vscode-extension.js'),
      path.join(homeDir, '.gemini', 'extensions', 'evo-kernel', 'dist', 'ide', 'vscode-extension.js')
    );
  }

  // 4. Global npm modules
  if (process.env.APPDATA) {
    candidates.push(
      path.join(process.env.APPDATA, 'npm', 'node_modules', 'evo-kernel', 'dist', 'ide', 'vscode-extension.js')
    );
  }
  candidates.push(
    path.resolve(process.execPath, '../../lib/node_modules/evo-kernel/dist/ide/vscode-extension.js'),
    path.resolve(process.execPath, '../node_modules/evo-kernel/dist/ide/vscode-extension.js')
  );

  return candidates.find((c) => fs.existsSync(c)) || null;
}

let extensionInstance = null;

exports.activate = async function (context) {
  const entry = resolveExtensionEntry();
  if (!entry) {
    try {
      const vscode = require('vscode');
      vscode.window.showErrorMessage(
        '[EvoKernel] Unable to locate EvoKernel runtime. Please run "npm install -g evo-kernel" or "evo init".'
      );
    } catch {}
    return;
  }

  // Convert Windows path to valid file:// URL to prevent ERR_UNSUPPORTED_ESM_URL_SCHEME
  const entryUrl = url.pathToFileURL(entry).href;
  extensionInstance = await import(entryUrl);
  if (extensionInstance && typeof extensionInstance.activate === 'function') {
    return extensionInstance.activate(context);
  }
};

exports.deactivate = async function () {
  if (extensionInstance && typeof extensionInstance.deactivate === 'function') {
    return extensionInstance.deactivate();
  }
};
