const crypto = require('crypto');

function wmCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(function(part) {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function wmMakeAuth(scope, secret) {
  const body = Buffer.from(JSON.stringify({
    scope: scope,
    exp: Date.now() + (12 * 60 * 60 * 1000)
  })).toString('base64url');

  const sig = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url');

  return body + '.' + sig;
}

function wmValidAuth(token, scope, secret) {
  try {
    if (!token) return false;

    const parts = String(token).split('.');
    if (parts.length !== 2) return false;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(parts[0])
      .digest('base64url');

    if (parts[1] !== expected) return false;

    const data = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8')
    );

    return data.scope === scope && Number(data.exp || 0) > Date.now();
  } catch (e) {
    return false;
  }
}

function wmAddCookie(res, cookie) {
  const old = res.getHeader('Set-Cookie');
  if (!old) res.setHeader('Set-Cookie', cookie);
  else if (Array.isArray(old)) res.setHeader('Set-Cookie', old.concat(cookie));
  else res.setHeader('Set-Cookie', [old, cookie]);
}

function wmSetAuthCookie(res, name, value) {
  wmAddCookie(
    res,
    name + '=' + encodeURIComponent(value) +
    '; Path=/; HttpOnly; Secure; SameSite=Strict'
  );
}

function wmClearAuthCookie(res, name) {
  wmAddCookie(
    res,
    name + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'
  );
}

function wmRefererPath(req) {
  try {
    const ref = String(req.headers.referer || '');
    if (!ref) return '';

    const url = new URL(ref);

    if (url.origin !== 'https://word-mate-real.vercel.app') return '';

    return url.pathname || '/';
  } catch (e) {
    return '';
  }
}

module.exports = async function handler(req, res) {
  try {
    const appsScriptUrl = process.env.WM_APPS_SCRIPT_URL;
    const proxyKey = process.env.WM_PROXY_KEY;

    if (!appsScriptUrl || !proxyKey) {
      return res.status(500).json({
        success: false,
        message: 'Proxy environment variables are missing.'
      });
    }

    const incomingUrl = new URL(req.url, 'https://word-mate-real.vercel.app');
    const targetUrl = new URL(appsScriptUrl);

        const action = String(
      incomingUrl.searchParams.get('action') ||
      incomingUrl.searchParams.get('mode') ||
      ''
    ).trim();

    const refererPath = (wmRefererPath(req).replace(/\/+$/, '') || '/');
    const cookies = wmCookies(req);

    const studentAuth = wmValidAuth(
      cookies.WM_STUDENT_AUTH,
      'student',
      proxyKey
    );

    const adminAuth = wmValidAuth(
      cookies.WM_ADMIN_AUTH,
      'admin',
      proxyKey
    );

    let allowed = false;

    if (action === 'studentLogin') {
      allowed = true;
    } else if (action === 'lmsLogin') {
      allowed = true;
    } else if (
      action === 'publicReport' &&
      refererPath.indexOf('/report/') === 0
    ) {
      allowed = true;
    } else if (
      (refererPath === '/map' || refererPath === '/study') &&
      studentAuth
    ) {
      allowed = true;
    } else if (
      (refererPath === '/lms' || refererPath === '/dev') &&
      adminAuth
    ) {
      allowed = true;
    }

    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: 'Direct access blocked.'
      });
    }

    incomingUrl.searchParams.forEach((value, key) => {
      targetUrl.searchParams.append(key, value);
    });

    targetUrl.searchParams.set('_wmProxyKey', proxyKey);

    const method = String(req.method || 'GET').toUpperCase();
    const headers = {};

    const contentType = req.headers['content-type'];
    if (contentType) {
      headers['content-type'] = contentType;
    }

    let body;

    if (method !== 'GET' && method !== 'HEAD') {
      if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
        body = req.body;
      } else if (req.body != null) {
        if (
          contentType &&
          contentType.includes('application/x-www-form-urlencoded')
        ) {
          body = new URLSearchParams(req.body).toString();
        } else {
          body = JSON.stringify(req.body);
        }
      }
    }

    const response = await fetch(targetUrl.toString(), {
      method,
      headers,
      body,
      redirect: 'follow',
      cache: 'no-store'
    });

    const responseText = await response.text();

        try {
      const data = JSON.parse(responseText);

      if (data && data.success === true) {
        if (action === 'studentLogin') {
          wmSetAuthCookie(
            res,
            'WM_STUDENT_AUTH',
            wmMakeAuth('student', proxyKey)
          );
        }

        if (action === 'lmsLogin') {
          wmSetAuthCookie(
            res,
            'WM_ADMIN_AUTH',
            wmMakeAuth('admin', proxyKey)
          );
        }
      }
    } catch (e) {}

    if (action === 'studentLogout') {
      wmClearAuthCookie(res, 'WM_STUDENT_AUTH');
    }

    res.status(response.status);
    res.setHeader(
      'Content-Type',
      response.headers.get('content-type') || 'text/plain; charset=utf-8'
    );
    res.setHeader('Cache-Control', 'no-store');

    return res.send(responseText);

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Word Mate proxy error'
    });
  }
};
