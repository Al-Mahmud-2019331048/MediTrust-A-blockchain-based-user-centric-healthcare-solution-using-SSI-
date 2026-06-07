# Testing Patterns

**Analysis Date:** 2026-05-23

## Test Framework

**NOT DETECTED.** No test framework is installed or configured in this project.

**Dependencies check:**
- `package.json` devDependencies do not include Jest, Vitest, Mocha, Playwright, or any test runner
- No `jest.config.*`, `vitest.config.*`, or test configuration files exist
- No test script is defined in `package.json`
- The only script is `"lint": "next lint"` (Next.js built-in)

**Available/Recommended:**
```bash
npm install --save-dev jest @testing-library/react @testing-library/jest-dom
# or
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom
```

## Test File Organization

**No test files exist anywhere in the project.**

Glob searches for `*.test.*`, `*.spec.*`, `**/__tests__/**` all returned empty.

## Test Structure

**No test patterns exist.** The project has zero test coverage.

**Implications for adding tests:**
- No existing patterns to follow — team must establish conventions
- All component/page/service code would need test scaffolding
- `@/` path alias would need resolution in Jest/Vitest config

## Mocking

**No mocking patterns exist.**

**Required for new tests:**
- `axios` calls would need mocking (axios-mock-adapter or jest.mock)
- `fetch` calls in `apiService.js` would need global fetch mocking or a polyfill
- `next/navigation` hooks (`useRouter`, `usePathname`) need Next.js router mocking
- `next/image` needs Next.js image mocking
- Lottie animations need mock components
- `localStorage` operations need mock storage

## Fixtures and Factories

**Not applicable.** No test data fixtures exist.

## Coverage

**Requirements:** Not enforced. No coverage tool is installed.

**Current baseline:** 0% test coverage across all 35 source files.

**Coverage tool options:**
- Jest: built-in `--coverage` flag
- Vitest: built-in `--coverage` flag (requires `@vitest/coverage-v8`)
- Istanbul: standalone coverage

## Test Types

**Unit Tests:** Not used.

**Integration Tests:** Not used.

**E2E Tests:** Not used.

## Current Quality Safeguards

**None.** The project relies entirely on:
- Manual browser testing during development
- Next.js build-time type checking (`.ts` files only)
- `console.log` debugging statements (pervasive)
- No CI/CD pipeline detected

## Recommended Baseline Setup

**Minimal test setup for this project:**

```bash
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom
```

**Suggested vitest.config.ts:**
```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test-setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**What to test first (priority order):**
1. `src/services/apiService.js` — pure function calls, HTTP logic
2. `src/components/QRCodeDisplay.jsx` — rendering logic, presentation
3. `src/components/Navigation.jsx` — active link detection
4. `src/components/StatusMessages.jsx` — conditional rendering branches
5. Integration tests for multi-step flows (doctor, pharmacist, government pages)

## Components Eligible for Testing

| Component | File | Testable Logic |
|-----------|------|----------------|
| apiService | `src/services/apiService.js` | 10+ exported async functions |
| Navigation | `src/components/Navigation.jsx` | `isActive()` path matching |
| QRCodeDisplay | `src/components/QRCodeDisplay.jsx` | `getInvitationUrl()` format handling |
| StatusMessages | `src/components/pharmacist/StatusMessages.jsx` | Conditional rendering |
| Loading | `src/components/loading.jsx` | Lottie render |
| Congrats | `src/components/Congrats.jsx` | Static render |
| Failure | `src/components/Failure.jsx` | Static render |
| Header | `src/components/header.jsx` | Agent type detection |
| Apply | `src/components/Apply.jsx` | Certificate list render, API call |
| AcceptCredential | `src/components/AcceptCredential.jsx` | Duplicate-call guard via useRef |

---

*Testing analysis: 2026-05-23*
