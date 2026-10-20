import { defineConfig } from 'oxfmt'

export default defineConfig({
  $schema: './node_modules/oxfmt/configuration_schema.json',

  ignorePatterns: [
    '**/node_modules/',
    'dist/',
    'quasar.config.*.temporary.compiled*',
    '.quasar/',
    'src-cordova/',
    'src-capacitor/',
    'src/router/typed-router.d.ts',
    // fichiers générés par `npm run notices` : textes de licence reproduits tels quels
    'THIRD_PARTY_NOTICES.md',
    'public/legal/',
    'LICENSE',
  ],

  printWidth: 140,
  arrowParens: 'always',
  bracketSpacing: true,
  bracketSameLine: false,
  htmlWhitespaceSensitivity: 'strict',
  semi: false,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'all',
  useTabs: false,
  vueIndentScriptAndStyle: false,
})
