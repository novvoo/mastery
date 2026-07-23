export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "**/dist/**",
      ".test-temp/**",
      ".sandboxes/**",
      "test-*.mjs",
    ],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        setImmediate: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        Promise: "readonly",
        Map: "readonly",
        Set: "readonly",
        Math: "readonly",
        JSON: "readonly",
        Date: "readonly",
        Intl: "readonly",
        global: "readonly",
        encodeURIComponent: "readonly",
        decodeURIComponent: "readonly",
        fetch: "readonly",
        Response: "readonly",
        AbortController: "readonly",
        Buffer: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      // Keep lint focused on correctness errors. This codebase intentionally keeps
      // dormant UI components, optional extension hooks, and defensive empty
      // catch blocks around platform integrations; reporting those as warnings
      // creates noisy output that hides real failures such as no-undef.
      "no-unused-vars": "off",
      "no-undef": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-empty": "off",
      "no-console": "off",
      "no-constant-condition": "off",
      "no-redeclare": "error",
      "no-shadow": "off",
      "eqeqeq": "off",
      "curly": "off",
      "no-throw-literal": "error",
    },
  },
  {
    // Tests directory: allow more flexibility
    files: ["tests/**/*.{js,mjs}", "desktop/tests/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        expect: "readonly",
        performance: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-throw-literal": "off",
      "no-undef": "error",
      "no-console": "off",
    },
  },
  {
    files: ["desktop/renderer/**/*.{js,jsx}"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        CustomEvent: "readonly",
        Event: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        File: "readonly",
        FileReader: "readonly",
        Blob: "readonly",
        FormData: "readonly",
        HTMLElement: "readonly",
        HTMLTextAreaElement: "readonly",
        Node: "readonly",
        ResizeObserver: "readonly",
        MutationObserver: "readonly",
      },
    },
  },
  {
    files: ["examples/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        performance: "readonly",
        window: "readonly",
      },
    },
  },
];
