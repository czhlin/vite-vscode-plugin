export const PLUGIN_NAME = '@czhlin:vscode';
export const ORG_NAME = '@czhlin';
export const PACKAGE_NAME = '@czhlin/vite-plugin-vscode';
export const WEBVIEW_METHOD_NAME = '__getWebviewHtml__';
/**
 * @see https://github.com/vitejs/vite/blob/v4.0.1/packages/vite/src/node/constants.ts#L137-L147
 */
export const loopbackHosts = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0000:0000:0000:0000:0000:0000:0000:0001',
]);
export const wildcardHosts = new Set(['0.0.0.0', '::', '0000:0000:0000:0000:0000:0000:0000:0000']);
