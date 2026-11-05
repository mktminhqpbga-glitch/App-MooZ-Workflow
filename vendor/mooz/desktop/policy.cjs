'use strict';

const fs = require('node:fs');
const path = require('node:path');

// A URL from the renderer is a request, never permission to access a host/file.
function parseURL(value) {
  if (typeof value !== 'string' || !value || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

const {providerForURL}=require('../ai-sites.js');

// Deliberately limited to the HTTPS match patterns used by the AI connectors.
// Chrome's *.example.com includes both the bare domain and its subdomains.
function matchesPattern(value, pattern) {
  const url = parseURL(value);
  if (!providerForURL(value) || typeof pattern !== 'string') return false;
  const match = /^https:\/\/(\*\.)?([a-z0-9.-]+)(\/[^\s#]*)$/.exec(pattern);
  if (!match) return false;
  const [, wildcard, hostname, pathname] = match;
  if (wildcard && hostname !== 'muse.ai') return false;
  if (wildcard ? url.hostname !== hostname && !url.hostname.endsWith('.' + hostname) : url.hostname !== hostname) return false;
  const expression = pathname.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + expression + '$').test(url.pathname + url.search);
}

function allowedNetworkURL(value) {
  const url = parseURL(value);
  if (!url) return false;
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '9473') {
    return /^(?:\/health|\/jobs|\/jobs\/[a-f0-9]{32}(?:\/cancel)?|\/files\/[a-f0-9]{32})$/.test(url.pathname);
  }
  if (url.protocol !== 'https:' || url.port) return false;
  return ['api.openai.com', 'generativelanguage.googleapis.com', 'queue.fal.run',
    'raw.githubusercontent.com', 'api.github.com', 'fal.media'].includes(url.hostname)
    || url.hostname.endsWith('.fal.media');
}

const RESOURCE_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.wasm', '.ttf', '.txt', '.woff', '.woff2']);
const PRIVATE_DIRECTORIES = new Set(['node_modules', 'downloads', 'tests', 'tools']);

/** Return an existing, permitted resource's real absolute path, or null.
 * Checks the original URL before URL parsing can normalize dot segments, then
 * checks real paths so a repository symlink cannot expose files outside root.
 */
function resolveAppPath(root, value) {
  const url = parseURL(value);
  if (!url || url.protocol !== 'workflow:' || url.hostname !== 'app' || url.port) return null;
  const rawPath = value.replace(/^workflow:\/\/app(?=\/|[?#]|$)/i, '').split(/[?#]/, 1)[0] || '/';
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { return null; }
  if (!decoded.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(decoded) || /%[0-9a-f]{2}/i.test(decoded)) return null;
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some(segment => segment.startsWith('.') || PRIVATE_DIRECTORIES.has(segment))) return null;
  const relative = segments.length ? segments.join('/') : 'app.html';
  if (!RESOURCE_EXTENSIONS.has(path.extname(relative).toLowerCase())) return null;
  try {
    const actualRoot = fs.realpathSync(root);
    const candidate = fs.realpathSync(path.join(actualRoot, relative));
    const within = path.relative(actualRoot, candidate);
    if (!within || within.startsWith('..' + path.sep) || path.isAbsolute(within) || !fs.statSync(candidate).isFile()) return null;
    if (within.split(path.sep).some(segment => segment.startsWith('.') || PRIVATE_DIRECTORIES.has(segment))
      || !RESOURCE_EXTENSIONS.has(path.extname(candidate).toLowerCase())) return null;
    return candidate;
  } catch {
    return null;
  }
}

module.exports = {providerForURL, matchesPattern, allowedNetworkURL, resolveAppPath};
