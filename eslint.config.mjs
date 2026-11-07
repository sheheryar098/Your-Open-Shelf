// Import boundaries.
//
//   app/       may import features, shared and server, but not the database client
//   features/  may import shared/ and server/ (not the database client), never another feature or app/
//   shared/    may import server/ (not the database client) and shared/, never features/ or app/
//   server/    may import server/ and shared/lib only (pure helpers); no React, Next.js or UI code
import { readdirSync } from "node:fs";
import tseslint from "typescript-eslint";

const features = readdirSync(new URL("./src/features", import.meta.url), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const noBarrels = {
  group: ["**/index", "./index", "../index"],
  message: "No barrel files: import from the source module.",
};
const noDirectDb = {
  group: ["@/server/db"],
  message: "Only src/server talks to the database. Add a query or domain function there and call it.",
};

const restrict = (patterns) => ({
  "no-restricted-imports": ["error", { patterns: [noBarrels, ...patterns] }],
});

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "storage/**", "next-env.d.ts"] },
  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      ...restrict([]),
    },
  },
  ...features.map((f) => ({
    files: [`src/features/${f}/**/*.{ts,tsx}`],
    rules: restrict([
      noDirectDb,
      {
        group: ["@/features/*", `!@/features/${f}`, `!@/features/${f}/**`],
        message: "Features must not import each other. Move shared code to src/shared.",
      },
      {
        group: ["../../*", "../../../*"],
        message: "Don't reach outside the feature with relative imports; use @/shared or @/server.",
      },
      { group: ["@/app/*", "@/app/**"], message: "Features must not import from app/." },
    ]),
  })),
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: restrict([
      noDirectDb,
      {
        group: ["@/features/*", "@/features/**", "@/app/*", "@/app/**"],
        message: "shared/ must not depend on features/ or app/.",
      },
    ]),
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: restrict([noDirectDb]),
  },
  {
    files: ["src/server/**/*.ts"],
    rules: restrict([
      {
        group: ["@/features/*", "@/features/**", "@/app/*", "@/app/**"],
        message: "server/ must not depend on the web layer.",
      },
      {
        group: ["@/shared/ui/*", "@/shared/ui/**", "@/shared/api/*", "@/shared/api/**"],
        message: "server/ may only use shared/lib (framework-free helpers).",
      },
      {
        group: ["react", "react-dom", "next", "next/*"],
        message: "server/ is framework-free: keep React and Next.js in app/, features/ and shared/.",
      },
    ]),
  },
);
