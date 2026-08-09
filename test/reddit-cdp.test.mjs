import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cdpCandidates } from '../collectors/reddit.mjs';

test('Reddit CDP loopback fallback includes localhost for modern Chrome Host validation', () => {
  assert.deepEqual(cdpCandidates('http://127.0.0.1:9222'), [
    'http://127.0.0.1:9222',
    'http://localhost:9222',
    'http://[::1]:9222',
  ]);
});

test('Reddit Chrome launcher waits for IPv4 CDP readiness without PowerShell localhost timeout', () => {
  const script = fs.readFileSync(new URL('../scripts/start-reddit-chrome.ps1', import.meta.url), 'utf8');
  assert.match(script, /http:\/\/127\.0\.0\.1:\$Port\/json\/version/);
  assert.match(script, /--user-data-dir=`"\$profilePath`"/);
  assert.match(script, /ProcessStartInfo/);
  assert.match(script, /Arguments = "--remote-debugging-port=\$Port/);
  assert.match(script, /CDP did not become ready/);
  assert.doesNotMatch(script, /Start-Process "https:\/\/old\.reddit\.com/);
});

test('Reddit Chrome stopper falls back to the dedicated listening port when CIM is unavailable', () => {
  const script = fs.readFileSync(new URL('../scripts/stop-reddit-chrome.ps1', import.meta.url), 'utf8');
  assert.match(script, /netstat -ano/);
  assert.match(script, /ProcessName -eq 'chrome'/);
  assert.match(script, /chromeProcess\.ProcessId/);
  assert.match(script, /Stop-Process[^\n]+-ErrorAction Stop/);
  assert.match(script, /did not release CDP port/);
});
