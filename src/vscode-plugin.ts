import type { Options as TsdownOptions } from 'tsdown';
import type { IndexHtmlTransformContext, ResolvedConfig, UserConfig, ViteDevServer } from 'vite';
import type { ExtensionOptions, PluginOptions, WebviewOption } from './types';
import path from 'node:path';
import { cwd } from 'node:process';
import merge from 'lodash.merge';
import { build as tsdownBuild } from 'tsdown';
import { PACKAGE_NAME, PLUGIN_NAME, WEBVIEW_METHOD_NAME } from './constants';
import { createLogger } from './logger';
import { getDevWebviewClient, getPkg, resolveServerUrl } from './utils';
import WebviewHelper from './webview-helper';

const isDev = process.env.NODE_ENV === 'development';
const logger = createLogger();

export default class VscodePlugin {
  private options: PluginOptions;
  private resolvedConfig: ResolvedConfig | null = null;
  private prodHtmlCache: Record<string, string> = {};
  private devWebviewClient: string = '';
  constructor(options?: PluginOptions) {
    this.options = this.mergeOptions(options);
    if (this.options.webview) {
      this.devWebviewClient = getDevWebviewClient();
    }
  }

  private mergeOptions(options?: PluginOptions): PluginOptions {
    const pkg = getPkg();
    const format = pkg.type === 'module' ? 'esm' : 'cjs';
    const opts: PluginOptions = merge(
      {
        webview: true,
        recommended: true,
        debug: false,
        extension: {
          entry: 'extension/index.ts',
          outDir: 'dist-extension',
          target: format === 'esm' ? ['node20'] : ['es2019', 'node14'],
          format,
          shims: true,
          clean: true,
          dts: false,
          treeshake: !isDev,
          outExtensions() {
            return { js: '.js' };
          },
          external: ['vscode'],
        } as ExtensionOptions,
      },
      options,
    );

    const opt = opts.extension || {};

    ['entry', 'format'].forEach((prop) => {
      const value = opt[prop];
      if (!Array.isArray(value) && value) {
        opt[prop] = [value];
      }
    });
    if (isDev) {
      opt.sourcemap = opt.sourcemap ?? true;
    }
    else {
      opt.minify ??= true;
    }
    if (typeof opt.external !== 'function') {
      opt.external = (['vscode'] as (string | RegExp)[]).concat(opt.external ?? []);
    }
    else {
      const fn = opt.external;
      opt.external = function (id, parentId, isResolved) {
        return id === 'vscode' || fn.call(this, id, parentId, isResolved);
      };
    }
    if (!opt.skipNodeModulesBundle) {
      opt.noExternal = Object.keys(pkg.dependencies || {}).concat(
        Object.keys(pkg.peerDependencies || {}),
      );
    }

    opts.extension = opt;

    if (opts.webview !== false) {
      let name = WEBVIEW_METHOD_NAME;
      if (typeof opts.webview === 'string') {
        name = opts.webview ?? WEBVIEW_METHOD_NAME;
      }
      opts.webview = Object.assign({ name }, opts.webview);
    }

    return opts;
  }

  private build({ env, webviewPath, onSuccess, watch }: {
    env: Record<string, any>;
    webviewPath: string;
    watch?: boolean;
    onSuccess: () => void;
  }) {
    const { onSuccess: _onSuccess, ...tsdownOptions } = this.options.extension || {};
    const webview = this.options?.webview as WebviewOption;
    const injectPlugin: TsdownOptions['plugins'] = [
      {
        name: `${PLUGIN_NAME}:inject`,
        transform(code) {
          if (code.includes(`${webview.name}(`)) {
            return `import ${webview.name} from '${webviewPath}';\n${code}`;
          }
          return code;
        },
      },
    ];
    return tsdownBuild(
      merge<TsdownOptions, TsdownOptions>(tsdownOptions, {
        watch,
        env,
        silent: true,
        plugins: webview ? injectPlugin : [],
        async onSuccess() {
          if (typeof _onSuccess === 'function') {
            await _onSuccess();
          }
          onSuccess();
        },
      }),
    );
  }

  handleConfig(config: UserConfig) {
    let outDir = config?.build?.outDir || 'dist';
    this.options.extension ??= {};
    if (this.options.recommended) {
      this.options.extension.outDir = path.resolve(outDir, 'extension');
      outDir = path.resolve(outDir, 'webview');
    }

    // assets
    const assetsDir = config?.build?.assetsDir || 'assets';
    const output = {
      chunkFileNames: `${assetsDir}/[name].js`,
      entryFileNames: `${assetsDir}/[name].js`,
      assetFileNames: `${assetsDir}/[name].[ext]`,
    };

    let rollupOutput = config?.build?.rollupOptions?.output ?? {};
    if (Array.isArray(rollupOutput)) {
      rollupOutput.map(s => Object.assign(s, output));
    }
    else {
      rollupOutput = Object.assign({}, rollupOutput, output);
    }

    return {
      build: {
        outDir,
        sourcemap: isDev ? true : config?.build?.sourcemap,
        rollupOptions: {
          output: rollupOutput,
        },
      },
    };
  }

  configResolved(config: ResolvedConfig) {
    this.resolvedConfig = config;
  }

  configureServer(server: ViteDevServer) {
    if (!server || !server.httpServer) {
      return;
    }
    server.httpServer?.once('listening', async () => {
      const env = {
        NODE_ENV: server.config.mode || 'development',
        VITE_DEV_SERVER_URL: resolveServerUrl(server),
      };
      let buildCount = 0;
      logger.info('extension build start');
      await this.build({
        env,
        webviewPath: `${PACKAGE_NAME}/webview`,
        watch: true,
        onSuccess() {
          logger.info(buildCount > 0 ? 'extension rebuild success' : 'extension build success');
          buildCount++;
        },
      });
    });
  }

  transformIndexHtml({ html, ctx, mode }: { html: string; ctx: IndexHtmlTransformContext; mode: 'dev' | 'build' }) {
    if (!this.options.webview) {
      return html;
    }
    if (mode === 'build') {
      this.prodHtmlCache[ctx.chunk?.name as string] = html;
      return html;
    }
    if (this.options.devtools ?? true) {
      let port: number | undefined;
      if (
        this.resolvedConfig?.plugins.find(s =>
          ['vite:react-refresh', 'vite:react-swc'].includes(s.name),
        )
      ) {
        port = 8097;
      }
      else if (this.resolvedConfig?.plugins.find(s => ['vite:vue', 'vite:vue2'].includes(s.name))) {
        port = 8098;
      }

      if (port) {
        html = html.replace(
          /<head>/i,
          `<head><script src="http://localhost:${port}"></script>`,
        );
      }
      else {
        logger.warn('Only support react-devtools and vue-devtools!');
      }
    }
    return html.replace(/<head>/i, `<head><script>${this.devWebviewClient}</script>`);
  }

  configBundle() {
    let webviewPath: string = '';

    const webview = this.options.webview as WebviewOption;
    if (webview) {
      const injectCode = WebviewHelper.getInjectCode(this.prodHtmlCache, webview);
      webviewPath = WebviewHelper.writeCode(injectCode);
    }

    let outDir = this.resolvedConfig?.build.outDir.replace(cwd(), '').replaceAll('\\', '/') ?? '';
    if (outDir.startsWith('/')) {
      outDir = outDir.substring(1);
    }
    const env = {
      NODE_ENV: this.resolvedConfig?.mode || 'production',
      VITE_WEBVIEW_DIST: outDir,
    };

    logger.info('extension build start');
    this.build({
      env,
      webviewPath,
      onSuccess() {
        logger.info('extension build success');
      },
    });
  }
}
