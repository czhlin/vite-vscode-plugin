import type { PluginOption } from 'vite';
import type { PluginOptions } from './types';
import { PLUGIN_NAME } from './constants';
import VscodePlugin from './vscode-plugin';

function useVSCodePlugin(options?: PluginOptions): PluginOption {
  const vscodePlugin = new VscodePlugin(options);
  return [
    {
      name: PLUGIN_NAME,
      apply: 'serve',
      config(config) {
        return vscodePlugin.handleConfig(config);
      },
      configResolved(config) {
        vscodePlugin.configResolved(config);
      },
      configureServer(server) {
        vscodePlugin.configureServer(server);
      },
      transformIndexHtml(html, ctx) {
        return vscodePlugin.transformIndexHtml({ html, ctx, mode: 'dev' });
      },
    },
    {
      name: PLUGIN_NAME,
      apply: 'build',
      enforce: 'post',
      config(config) {
        return vscodePlugin.handleConfig(config);
      },
      configResolved(config) {
        vscodePlugin.configResolved(config);
      },
      transformIndexHtml(html, ctx) {
        return vscodePlugin.transformIndexHtml({ html, ctx, mode: 'build' });
      },
      closeBundle() {
        vscodePlugin.configBundle();
      },
    },
  ];
}

export default useVSCodePlugin;
