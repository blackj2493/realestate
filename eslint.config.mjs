// Next.js 16 ships native ESLint flat configs; spread them directly.
// (`next lint` was removed in Next 16 — lint via the ESLint CLI: `npm run lint`.)
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Brand-new React Compiler rules in eslint-plugin-react-hooks v6 (pulled in
      // by eslint-config-next 16). They flag legitimate patterns used throughout
      // this codebase (sync effects; reading refs while building deck.gl layers in
      // a render-time useMemo) and had no equivalent under the old `next lint`
      // setup. Keep them visible but non-blocking so the migration preserves the
      // prior severity profile; revisit if/when adopting the React Compiler.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
  {
    // Plain .js files here are CommonJS Node scripts/tests (package.json has no
    // "type":"module"), so require() is correct — the rule targets TS/ESM.
    files: ["**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
