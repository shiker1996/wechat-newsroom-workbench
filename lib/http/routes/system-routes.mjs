import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkReddit } from '../../../collectors/reddit.mjs';
import { checkRssHub, ensureStarted, stopRssHub, testSubscription } from '../../../collectors/rsshub.mjs';
import {
  addSubscription,
  listSubscriptions,
  removeSubscription,
  subscriptionTestInput,
  updateSubscription,
} from '../../integrations/subscriptions.mjs';
import { validateWorkbenchBackup } from '../../artifacts/backup-archive.mjs';
import { getGitHubApiHealth } from '../../integrations/github-api.mjs';
import { getRuntimeSettings, runPowerShellScript, updateRuntimeSettings } from '../../integrations/runtime-settings.mjs';

export async function handleSystemRoutes(context) {
  const {
    request, response, pathname, searchParams, root, config, store,
    json, body, binaryBody, createWorkbenchBackup,
  } = context;

  if (request.method === 'GET' && pathname === '/api/system/health') {
    const target = searchParams.get('target') || 'all';
    if (!['all', 'reddit', 'rsshub', 'github'].includes(target)) {
      json(response, 400, { error: '未知的检查目标' });
      return true;
    }
    const [reddit, rsshub] = await Promise.all([
      target === 'all' || target === 'reddit' ? checkReddit(config.reddit) : Promise.resolve(null),
      target === 'all' || target === 'rsshub' ? checkRssHub(config.rsshub) : Promise.resolve(null),
    ]);
    json(response, 200, {
      reddit,
      rsshub,
      github: target === 'all' || target === 'github' ? getGitHubApiHealth() : null,
      node: process.version,
      now: new Date().toISOString(),
      target,
    });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/system/settings') {
    json(response, 200, getRuntimeSettings(root, config));
    return true;
  }
  if (request.method === 'PUT' && pathname === '/api/system/settings') {
    json(response, 200, updateRuntimeSettings(root, config, await body(request)));
    return true;
  }

  const runtimeMatch = pathname.match(/^\/api\/system\/runtime\/(rsshub|reddit)\/(start|stop|restart)$/);
  if (request.method === 'POST' && runtimeMatch) {
    const [, service, action] = runtimeMatch;
    let result = { message: '操作完成' };
    if (service === 'rsshub') {
      if (action === 'stop' || action === 'restart') result = await stopRssHub(config.rsshub);
      if (action === 'start' || action === 'restart') {
        const started = await ensureStarted(config.rsshub, () => {});
        result = { message: started ? 'RSSHub 已启动并通过健康检查' : 'RSSHub 已在运行' };
      }
    } else {
      const port = String(new URL(config.reddit.cdpUrl).port || 9222);
      if (action === 'stop' || action === 'restart') {
        result = await runPowerShellScript(path.join(root, 'scripts', 'stop-reddit-chrome.ps1'), ['-Port', port]);
      }
      if (action === 'start' || action === 'restart') {
        result = await runPowerShellScript(path.join(root, 'scripts', 'start-reddit-chrome.ps1'), ['-Port', port]);
      }
    }
    json(response, 200, { ...result, service, action });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/subscriptions') {
    json(response, 200, listSubscriptions(config, store.listSubscriptionHealth()));
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/system/backup') {
    const backup = await createWorkbenchBackup();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    response.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="write-assistant-${stamp}.zip"`,
      'content-length': backup.buffer.length,
      'cache-control': 'no-store',
    });
    response.end(backup.buffer);
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/system/backup/validate') {
    try {
      const parsed = validateWorkbenchBackup(await binaryBody(request));
      json(response, 200, {
        valid: true,
        createdAt: parsed.manifest.createdAt,
        appVersion: parsed.manifest.appVersion,
        fileCount: parsed.manifest.files.length,
        totalBytes: parsed.manifest.files.reduce((sum, item) => sum + item.size, 0),
      });
    } catch (error) {
      json(response, 400, { valid: false, error: error.message });
    }
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/system/backup/restore') {
    if (request.headers['x-restore-confirm'] !== 'RESTORE') {
      json(response, 409, { error: '缺少恢复确认' });
      return true;
    }
    let tempDir;
    try {
      const parsed = validateWorkbenchBackup(await binaryBody(request));
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-assistant-restore-'));
      const sourceDb = path.join(tempDir, 'workbench.db');
      fs.writeFileSync(sourceDb, parsed.entries.get('data/workbench.db'));
      const probe = new (await import('node:sqlite')).DatabaseSync(sourceDb, { readOnly: true });
      try {
        if (probe.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
          throw new Error('备份数据库完整性检查失败');
        }
      } finally {
        probe.close();
      }
      const safety = await createWorkbenchBackup();
      const backupDir = path.join(root, 'data', 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const safetyName = `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
      fs.writeFileSync(path.join(backupDir, safetyName), safety.buffer);
      const result = store.restoreFromDatabase(sourceDb);
      json(response, 200, { restored: true, batches: result.count, safetyBackup: safetyName });
    } catch (error) {
      json(response, 400, { restored: false, error: error.message });
    } finally {
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    }
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/subscriptions/health-history') {
    json(response, 200, store.listSubscriptionHealthHistory({
      days: Number(searchParams.get('days') ?? 14),
      limit: Number(searchParams.get('limit') ?? 500),
    }));
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/subscriptions/test') {
    json(response, 200, await testSubscription(config.rsshub, subscriptionTestInput(await body(request))));
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/subscriptions') {
    addSubscription(root, config, await body(request));
    json(response, 201, listSubscriptions(config, store.listSubscriptionHealth()));
    return true;
  }
  if (request.method === 'PATCH' && pathname === '/api/subscriptions') {
    updateSubscription(root, config, await body(request));
    json(response, 200, listSubscriptions(config, store.listSubscriptionHealth()));
    return true;
  }
  if (request.method === 'DELETE' && pathname === '/api/subscriptions') {
    removeSubscription(root, config, await body(request));
    json(response, 200, listSubscriptions(config, store.listSubscriptionHealth()));
    return true;
  }
  return false;
}
