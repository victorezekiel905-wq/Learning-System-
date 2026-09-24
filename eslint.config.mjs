import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "smart"],
      "@next/next/no-img-element": "off",
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // These three rules exist for the opt-in React Compiler (automatic memoisation),
      // which this app does not enable. The patterns they flag (resetting state when a
      // prop changes, latest-value refs, Date.now() for countdowns) are correct in React 19.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off"
    }
  },
  { ignores: ["public/sandbox/**", "extension/**", ".next*/**", "supabase/**", "scripts/**", "tests/**", "next-env.d.ts"] }
];

export default config;
