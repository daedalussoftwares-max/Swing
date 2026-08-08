module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        path: '.env',
        safe: false,
        allowUndefined: true,
      },
    ],
    '@babel/plugin-transform-export-namespace-from',
    [
      'module-resolver',
      {
        root: ['./'],
        alias: {
          '@': './',
        },
        extensions: ['.ios.js', '.android.js', '.js', '.ts', '.tsx', '.json'],
      },
    ],
    'react-native-worklets/plugin',
  ],
};
