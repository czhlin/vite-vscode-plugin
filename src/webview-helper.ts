import type { WebviewOption } from './types';
import fs from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';
import { emptyDirSync } from '@tomjs/node';
import { parse as htmlParser } from 'node-html-parser';
import { PACKAGE_NAME } from './constants';
import { normalizePath } from './utils';

export default class WebviewHelper {
  private static getCsp(webview?: WebviewOption) {
    return webview?.csp
      || `<meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none';
          style-src {{cspSource}} 'unsafe-inline';
          script-src 'nonce-{{nonce}}' 'unsafe-eval';">`;
  }

  private static getUuidCode() {
    return `
    function uuid() {
      let text = '';
      const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
      }
      return text;
    }
    `;
  }

  private static getWebviewHtmlCode(uuidCode: string, cacheCode: string) {
    return `
    import { Uri } from 'vscode';
    ${uuidCode}
    ${cacheCode}
    export default function getWebviewHtml(options){
      const { webview, context, inputName, injectCode } = options || {};
      const nonce = uuid();
      const baseUri = webview.asWebviewUri(Uri.joinPath(context.extensionUri, (process.env.VITE_WEBVIEW_DIST || 'dist')));
      let html = htmlCode[inputName || 'index'] || '';
      if (injectCode) {
        html = html.replace('<head>', '<head>'+ injectCode);
      }

      return html.replaceAll('{{cspSource}}', webview.cspSource).replaceAll('{{nonce}}', nonce).replaceAll('{{baseUri}}', baseUri);
    }
    `;
  }

  private static handleHtmlCode(html: string, webview?: WebviewOption) {
    const root = htmlParser(html);
    const head = root.querySelector('head')!;
    if (!head) {
      root?.insertAdjacentHTML('beforeend', '<head></head>');
    }
    const csp = this.getCsp(webview);
    head.insertAdjacentHTML('afterbegin', csp);
    if (csp && csp.includes('{{nonce}}')) {
      const tags = {
        script: 'src',
        link: 'href',
      };

      Object.keys(tags).forEach((tag) => {
        const elements = root.querySelectorAll(tag);
        elements.forEach((element) => {
          const attr = element.getAttribute(tags[tag]);
          if (attr) {
            element.setAttribute(tags[tag], `{{baseUri}}${attr}`);
          }

          element.setAttribute('nonce', '{{nonce}}');
        });
      });
    }
    return root.removeWhitespace().toString();
  }

  private static getCacheCode(cache: Record<string, string>, webview?: WebviewOption) {
    return `const htmlCode = {
    ${Object.keys(cache)
      .map(s => `'${s}': \`${this.handleHtmlCode(cache[s], webview)}\`,`)
      .join('\n')}
    };`;
  }

  static getInjectCode(cache: Record<string, string>, webview?: WebviewOption) {
    return this.getWebviewHtmlCode(this.getUuidCode(), this.getCacheCode(cache, webview));
  }

  static writeCode(code: string) {
    const prodCachePkgName = `${PACKAGE_NAME}-inject`;
    const prodCacheFolder = path.join(cwd(), 'node_modules', prodCachePkgName);
    emptyDirSync(prodCacheFolder);
    const destFile = path.join(prodCacheFolder, 'index.js');
    fs.writeFileSync(destFile, code, { encoding: 'utf8' });
    return normalizePath(destFile);
  };
}
