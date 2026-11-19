'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const blocked4 = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].forEach(([address, prefix]) => blocked4.addSubnet(address, prefix, 'ipv4'));

const global6 = new net.BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
const blocked6 = new net.BlockList();
[['2001::', 23], ['2001:db8::', 32], ['2002::', 16]].forEach(([address, prefix]) => blocked6.addSubnet(address, prefix, 'ipv6'));

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !blocked4.check(address, 'ipv4');
  if (family === 6) {
    if (/^::ffff:/i.test(address)) return false;
    return global6.check(address, 'ipv6') && !blocked6.check(address, 'ipv6');
  }
  return false;
}

function validateUrl(value, allowedOrigin) {
  let url;
  try { url = value instanceof URL ? value : new URL(value); }
  catch (e) { throw Object.assign(new Error('invalid supplier URL'), { code: 'LIVE_UNSAFE_URL' }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== allowedOrigin
    || url.username || url.password || url.hash) {
    throw Object.assign(new Error('supplier URL is not allowed'), { code: 'LIVE_UNSAFE_URL' });
  }
  return url;
}

function requestOnce(url, { headers, signal, addresses, timeoutMs, maxResponseBytes }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const lookup = (hostname, options, callback) => {
      if (hostname.toLowerCase() !== url.hostname.toLowerCase()) {
        return callback(Object.assign(new Error('supplier hostname changed'), { code: 'LIVE_UNSAFE_URL' }));
      }
      if (options && options.all) return callback(null, addresses);
      const address = addresses[0];
      callback(null, address.address, address.family);
    };

    const req = transport.request(url, { method: 'GET', headers, signal, lookup }, (res) => {
      const status = res.statusCode || 502;
      const responseHeaders = Object.assign({}, res.headers, {
        getSetCookie: () => res.headers['set-cookie'] || []
      });
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.on('end', () => finish(resolve, {
          status, ok: false, headers: responseHeaders, url: url.href, text: async () => ''
        }));
        res.resume();
        return;
      }

      let size = 0;
      const chunks = [];
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          const error = Object.assign(new Error('supplier response too large'), { code: 'LIVE_RESPONSE_TOO_LARGE' });
          res.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        finish(resolve, {
          status, ok: status >= 200 && status < 300, headers: responseHeaders, url: url.href,
          text: async () => body
        });
      });
      res.on('error', error => finish(reject, error));
    });

    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('supplier request timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', error => finish(reject, error));
    req.end();
  });
}

function createSafeFetch({ lookup = dns.lookup, request = requestOnce, maxRedirects = 3, maxResponseBytes = 8 * 1024 * 1024, timeoutMs = 25000 } = {}) {
  return async function safeFetch(value, options = {}) {
    const allowedOrigin = options.allowedOrigin;
    let url = validateUrl(value, allowedOrigin);

    for (let redirects = 0; ; redirects++) {
      url = validateUrl(url, allowedOrigin);
      let addresses;
      if (net.isIP(url.hostname)) addresses = [{ address: url.hostname, family: net.isIP(url.hostname) }];
      else addresses = await lookup(url.hostname, { all: true, verbatim: true });
      if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
        throw Object.assign(new Error('supplier resolved to a non-public address'), { code: 'LIVE_UNSAFE_ADDRESS' });
      }

      const response = await request(url, {
        headers: options.headers || {}, signal: options.signal, addresses, timeoutMs, maxResponseBytes
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      if (redirects >= maxRedirects || !response.headers.location) {
        throw Object.assign(new Error('supplier redirect rejected'), { code: 'LIVE_UNSAFE_REDIRECT' });
      }
      url = new URL(response.headers.location, url);
    }
  };
}

module.exports = { createSafeFetch, isPublicAddress, requestOnce, validateUrl };
