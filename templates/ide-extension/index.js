// Universal CommonJS-to-ESM Bridge for VS Code Extension Host
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const url = require('node:url');

function getRealExtensionDir() {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(__dirname) : fs.realpathSync(__dirname);
  } catch {
    return __dirname;
  }
}

function resolveExtensionEntry(vscodeApi) {
  const homeDir = os.homedir ? os.homedir() : (process.env.HOME || process.env.USERPROFILE || '');
  const realDir = getRealExtensionDir();
  const candidates = [
    // 1. Self-contained bundled runtime inside copied extension directory
    path.join(realDir, 'runtime', 'dist', 'ide', 'vscode-extension.js'),
    // 2. Direct relative dist entry if mounted via junction/symlink from templates/ide-extension
    path.resolve(realDir, '..', '..', 'dist', 'ide', 'vscode-extension.js'),
    path.resolve(__dirname, '..', '..', 'dist', 'ide', 'vscode-extension.js'),
    path.resolve(realDir, 'dist', 'ide', 'vscode-extension.js'),
    path.resolve(realDir, 'vscode-extension.js'),
  ];

  // 3. Explicit environment variable override
  if (process.env.EVO_KERNEL_ROOT) {
    candidates.push(path.join(path.resolve(process.env.EVO_KERNEL_ROOT), 'dist', 'ide', 'vscode-extension.js'));
  }

  // 4. Open workspace folders or local node_modules install
  try {
    const folders = vscodeApi && vscodeApi.workspace && vscodeApi.workspace.workspaceFolders;
    if (Array.isArray(folders)) {
      for (const folder of folders) {
        const fsPath = folder && folder.uri && folder.uri.fsPath;
        if (!fsPath) continue;
        candidates.push(
          path.join(fsPath, 'dist', 'ide', 'vscode-extension.js'),
          path.join(fsPath, 'node_modules', 'evo-kernel', 'dist', 'ide', 'vscode-extension.js')
        );
      }
    }
  } catch {}

  // 5. User host plugin installations
  if (homeDir) {
    candidates.push(
      path.join(homeDir, '.gemini', 'config', 'plugins', 'evo-kernel', 'dist', 'ide', 'vscode-extension.js'),
      path.join(homeDir, '.gemini', 'extensions', 'evo-kernel', 'dist', 'ide', 'vscode-extension.js')
    );
  }

  // 6. Global npm modules
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
  let vscode = null;
  try {
    vscode = require('vscode');
  } catch {}

  const entry = resolveExtensionEntry(vscode);
  if (!entry) {
    if (vscode && vscode.commands && typeof vscode.commands.registerCommand === 'function') {
      const showMissingRuntime = () => {
        if (vscode.window && typeof vscode.window.showErrorMessage === 'function') {
          vscode.window.showErrorMessage(
            '[EvoKernel] Unable to locate EvoKernel runtime. Please run "npm install -g evo-kernel" or "evo init --install-ide".'
          );
        }
      };
      const d1 = vscode.commands.registerCommand('evo.openWorkbench', showMissingRuntime);
      const d2 = vscode.commands.registerCommand('evo.viewCockpit', showMissingRuntime);
      if (context && Array.isArray(context.subscriptions)) {
        context.subscriptions.push(d1, d2);
      }
    }
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
