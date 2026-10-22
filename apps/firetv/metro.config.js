const path = require('path');
const fs = require('fs');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const sharedRoot = path.resolve(__dirname, '../../packages/shared');

/**
 * Metro configuration for the Fire TV app.
 *
 * The TV app reads the same domain types and timezone helpers as the backend
 * and the web client, straight from packages/shared, so the three surfaces
 * cannot drift apart. Two small accommodations make that work:
 *
 *   - `watchFolders` lets Metro read files outside this project;
 *   - `resolveRequest` maps the shared package's ESM-style "./x.js" imports
 *     onto the TypeScript sources Metro actually compiles.
 */
const config = {
  watchFolders: [sharedRoot],
  resolver: {
    // Shared sources live outside this project, so Metro has to be told where
    // the app's own node_modules are when it compiles them (Babel's runtime
    // helpers are injected into every transformed file).
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '../../node_modules'),
    ],
    extraNodeModules: {
      '@alongside/shared': sharedRoot,
    },
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName.startsWith('@alongside/shared')) {
        const sub = moduleName.replace('@alongside/shared', '').replace(/^\//, '') || 'src/index';
        return {filePath: path.join(sharedRoot, withTsExtension(sub)), type: 'sourceFile'};
      }
      if (/\.js$/.test(moduleName) && context.originModulePath.startsWith(sharedRoot)) {
        const candidate = path.resolve(path.dirname(context.originModulePath), moduleName).replace(/\.js$/, '.ts');
        if (fs.existsSync(candidate)) {
          return {filePath: candidate, type: 'sourceFile'};
        }
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

function withTsExtension(relative) {
  if (/\.tsx?$/.test(relative)) return relative;
  const direct = path.join(sharedRoot, `${relative}.ts`);
  if (fs.existsSync(direct)) return `${relative}.ts`;
  return path.join(relative, 'index.ts');
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
