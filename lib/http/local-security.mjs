import crypto from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function hostname(value) {
  try { return new URL(`http://${String(value || '')}`).hostname.replace(/^\[|\]$/g, '').toLowerCase(); }
  catch { return ''; }
}

export function createLocalSecurity() {
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const confirmations = new Map();
  const prune = () => { const now = Date.now(); for (const [token, item] of confirmations) if (item.expiresAt <= now) confirmations.delete(token); };
  return {
    csrfToken,
    validateBoundary(request) {
      if (!LOOPBACK_HOSTS.has(hostname(request.headers.host))) return { status: 403, code: 'HOST_NOT_ALLOWED', error: '请求主机不受信任' };
      const origin = request.headers.origin;
      if (origin) {
        let originHost = '';
        try { const parsed = new URL(origin); if (parsed.protocol !== 'http:') throw new Error(); originHost = parsed.hostname.toLowerCase(); } catch { return { status: 403, code: 'ORIGIN_NOT_ALLOWED', error: '请求来源不受信任' }; }
        if (!LOOPBACK_HOSTS.has(originHost)) return { status: 403, code: 'ORIGIN_NOT_ALLOWED', error: '请求来源不受信任' };
      }
      if (!SAFE_METHODS.has(String(request.method || '').toUpperCase()) && request.headers['x-csrf-token'] !== csrfToken) {
        return { status: 403, code: 'CSRF_INVALID', error: '服务已重启，本地会话已更新，请刷新页面后重试' };
      }
      return null;
    },
    issue(action) {
      prune();
      const normalized = String(action || '').trim();
      if (!/^[a-z][a-z0-9.-]{2,63}$/.test(normalized)) throw new Error('敏感操作类型无效');
      const token = crypto.randomBytes(32).toString('base64url');
      confirmations.set(token, { action: normalized, expiresAt: Date.now() + 60_000 });
      return token;
    },
    consume(request, action) {
      prune();
      const token = String(request.headers['x-action-confirm'] || '');
      const item = confirmations.get(token);
      confirmations.delete(token);
      return Boolean(item && item.action === action && item.expiresAt > Date.now());
    },
  };
}
