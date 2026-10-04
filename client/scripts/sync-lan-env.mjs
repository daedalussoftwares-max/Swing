#!/usr/bin/env node
/**
 * Sync Mac LAN IP into client/.env (API) and ios/.xcode.env.local (Metro hostname hint).
 * Run when Wi‑Fi / hotspot changes: pnpm lan:sync
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const clientRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function getLanIp() {
  for (const iface of ['en0', 'en1', 'en2', 'en3']) {
    try {
      const ip = execSync(`ipconfig getifaddr ${iface}`, { encoding: 'utf8' }).trim();
      if (ip) return ip;
    } catch {
      /* next */
    }
  }
  return '';
}

function upsertEnvLine(content, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, line);
  const trimmed = content.replace(/\n?$/, '');
  return `${trimmed}\n${line}\n`;
}

function syncDotEnv(ip) {
  const envPath = path.join(clientRoot, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Missing client/.env — copy from .env.example first.');
    process.exit(1);
  }
  const apiUrl = `http://${ip}:8080`;
  let content = fs.readFileSync(envPath, 'utf8');
  content = upsertEnvLine(content, 'SWING_API_URL', apiUrl);
  content = upsertEnvLine(content, 'EXPO_PUBLIC_API_URL', apiUrl);
  fs.writeFileSync(envPath, content);
  return apiUrl;
}

function syncXcodeEnvLocal(ip) {
  const localPath = path.join(clientRoot, 'ios', '.xcode.env.local');
  let lines = [];
  if (fs.existsSync(localPath)) {
    lines = fs.readFileSync(localPath, 'utf8').split('\n').filter(Boolean);
  }
  const filtered = lines.filter(
    (l) => !l.startsWith('export REACT_NATIVE_PACKAGER_HOSTNAME='),
  );
  filtered.push(`export REACT_NATIVE_PACKAGER_HOSTNAME=${ip}`);
  if (!filtered.some((l) => l.startsWith('export NODE_BINARY='))) {
    try {
      const node = execSync('command -v node', { encoding: 'utf8' }).trim();
      if (node) filtered.unshift(`export NODE_BINARY=${node}`);
    } catch {
      /* optional */
    }
  }
  fs.writeFileSync(localPath, `${filtered.join('\n')}\n`);
}

const ip = getLanIp();
if (!ip) {
  console.error('Could not detect LAN IP (en0/en1). Connect Wi‑Fi and retry.');
  process.exit(1);
}

const apiUrl = syncDotEnv(ip);
syncXcodeEnvLocal(ip);

console.log('');
console.log('LAN sync OK');
console.log(`  Mac IP:     ${ip}`);
console.log(`  API (.env): ${apiUrl}`);
console.log(`  Metro:      http://${ip}:8081  (run: pnpm start)`);
console.log('');
console.log('Next:');
console.log('  1) pnpm start   (Metro, listens on all interfaces)');
console.log('  2) Phone browser → ' + apiUrl + '/health');
console.log('  3) Rebuild app on device (Xcode Run or pnpm android:apk + reinstall)');
console.log('');
