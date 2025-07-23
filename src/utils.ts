import type { AddressInfo } from 'node:net';
import type { ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { readFileSync, readJsonSync } from '@tomjs/node';
import { loopbackHosts, wildcardHosts } from './constants';

export function resolveHostname(hostname: string) {
  return loopbackHosts.has(hostname) || wildcardHosts.has(hostname) ? 'localhost' : hostname;
}
/**
 * @see https://github.com/jonschlinkert/normalize-path/blob/master/index.js#L8
 */
export function normalizePath(path: string, stripTrailing?: boolean) {
  if (typeof path !== 'string') {
    throw new TypeError('expected path to be a string');
  }

  if (path === '\\' || path === '/')
    return '/';

  const len = path.length;
  if (len <= 1)
    return path;

  // ensure that win32 namespaces has two leading slashes, so that the path is
  // handled properly by the win32 version of path.parse() after being normalized
  // https://msdn.microsoft.com/library/windows/desktop/aa365247(v=vs.85).aspx#namespaces
  let prefix = '';
  if (len > 4 && path[3] === '\\') {
    const ch = path[2];
    if ((ch === '?' || ch === '.') && path.slice(0, 2) === '\\\\') {
      path = path.slice(2);
      prefix = '//';
    }
  }

  const segs = path.split(/[/\\]+/);
  if (stripTrailing !== false && segs[segs.length - 1] === '') {
    segs.pop();
  }
  return prefix + segs.join('/');
}

export function resolveServerUrl(server: ViteDevServer) {
  const addressInfo = server.httpServer!.address();
  const isAddressInfo = (x: any): x is AddressInfo => x?.address;

  if (isAddressInfo(addressInfo)) {
    const { address, port } = addressInfo;
    const hostname = resolveHostname(address);

    const options = server.config.server;
    const protocol = options.https ? 'https' : 'http';
    const devBase = server.config.base;

    const path = typeof options.open === 'string' ? options.open : devBase;
    const url = path.startsWith('http') ? path : `${protocol}://${hostname}:${port}${path}`;
    return url;
  }
}

export function getPkg() {
  const pkgFile = path.resolve(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgFile)) {
    throw new Error('Main file is not specified, and no package.json found');
  }

  const pkg = readJsonSync(pkgFile);
  if (!pkg.main) {
    throw new Error('Main file is not specified, please check package.json');
  }

  return pkg;
}

export const isDev = process.env.NODE_ENV === 'development';

export function getDevWebviewClient() {
  return readFileSync(path.join(__dirname, 'client.iife.js'));
}
