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
