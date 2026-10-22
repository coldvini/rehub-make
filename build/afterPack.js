// Ad-hoc sign the final macOS bundle so Apple Silicon Macs will launch it
// without a paid Developer ID certificate. The per-arch temp builds that get
// merged into the universal app are left untouched so the merge stays clean.
const { execSync } = require('child_process');
const path = require('path');
const { Arch } = require('electron-builder');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (context.arch !== Arch.universal) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' });
};
