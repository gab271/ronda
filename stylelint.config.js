/**
 * Cuadro stylelint configuration.
 *
 * The rule that matters here is the colour-literal ban in the override block.
 * Everything else is house style.
 */
export default {
  extends: ['stylelint-config-standard'],

  rules: {
    // Our token names are layered (--c-* primitives, --color-* semantic,
    // --btn-* component-local), which the default kebab-case pattern rejects.
    'custom-property-pattern': null,
    // CSS Modules class names are camelCase to match `localsConvention`.
    'selector-class-pattern': null,
    'declaration-empty-line-before': null,
    'custom-property-empty-line-before': null,
    'comment-empty-line-before': null,
    'no-descending-specificity': null,
    // Bare-string @import is what Vite resolves through its module graph, and
    // is the idiom across the bundler ecosystem.
    'import-notation': 'string',
  },

  overrides: [
    {
      // TOKEN DISCIPLINE.
      //
      // Outside src/styles/tokens/, a raw colour literal is an error. Every
      // colour must resolve through the semantic layer (--color-*).
      //
      // This is not tidiness. Per-club branding (a paid feature, milestone 7) is
      // implemented by injecting a single <style> element that overrides
      // --color-brand on :root. That works only if no component has baked a hex
      // value in somewhere. Enforcing it from the first commit costs nothing;
      // discovering a hundred violations in milestone 7 costs a refactor.
      //
      // It also protects the sunlight-contrast guarantees: contrast ratios are
      // verified once, at the token layer, rather than per-component.
      files: ['src/**/*.css'],
      excludedFiles: ['src/styles/tokens/**/*.css'],
      rules: {
        'declaration-property-value-disallowed-list': {
          '/^(color|background|background-color|border|border-color|border-top-color|border-right-color|border-bottom-color|border-left-color|outline-color|fill|stroke|box-shadow|text-shadow)$/':
            [/#[0-9a-fA-F]{3,8}/, /\brgba?\(/, /\bhsla?\(/, /\boklch\(/],
        },
      },
    },
  ],
}
