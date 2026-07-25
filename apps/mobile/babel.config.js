module.exports = function babelConfig(api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: [
      // Reanimated 4 moved its Babel transform into react-native-worklets.
      // It MUST be last in this array — it rewrites function bodies into
      // worklets, and any plugin running after it would transform the already
      // rewritten output.
      'react-native-worklets/plugin',
    ],
  }
}
