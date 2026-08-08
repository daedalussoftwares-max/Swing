const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;

module.exports = mergeConfig(getDefaultConfig(projectRoot), {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName.startsWith('@/')) {
        return context.resolveRequest(
          context,
          path.join(projectRoot, moduleName.slice(2)),
          platform,
        );
      }

      return context.resolveRequest(context, moduleName, platform);
    },
  },
});
