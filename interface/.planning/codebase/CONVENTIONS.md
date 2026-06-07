# Coding Conventions

**Analysis Date:** 2026-05-23

## Languages & File Types

**Primary:** JavaScript (JSX) - All components and pages use `.jsx` extension
**Config:** TypeScript (`.ts`) - Next.js config, Tailwind config, tsconfig
**Services:** Plain JavaScript (`.js`) - `src/services/apiService.js`
**CSS:** Tailwind CSS via `postcss.config.mjs`

**Mixed JS/TS:** Project runs `allowJs: true` in `tsconfig.json`. Pages and components are `.jsx` despite full TypeScript toolchain. Config files are `.ts` or `.mjs`.

## Naming Patterns

**Files:**
- Components: `PascalCase.jsx` — e.g., `Navigation.jsx`, `EstablishConenction.jsx`, `QRCodeDisplay.jsx`
- Pages: `kebab-case/page.jsx` — e.g., `patient/page.jsx`, `doctor/page.jsx`
- Services: `camelCase.js` — e.g., `apiService.js`
- Sub-components by role: `SubDirectory/PascalCase.jsx` — e.g., `pharmacist/PharmacistHeader.jsx`, `pharmacist/StatusMessages.jsx`
- **Inconsistency noted:** `header.jsx` (lowercase) vs `Navigation.jsx` (PascalCase). Also: `loading.jsx` (lowercase) vs `GetStarted.jsx` (PascalCase). Use PascalCase for component files.

**Components:**
- Primary export: `export default function ComponentName()` — used in all page components and most shared components
- Named export: `export function GetStart()`, `export function IssuerStepper()`, `export function Header()` — used in stepper and some components
- Arrow function with `const` for sub-components embedded in the same file — e.g., `const Navigation = () => {}` in `Navigation.jsx` (then `export default Navigation`)

**Functions:**
- camelCase: `handleCreateInvitation`, `getConnectionStatus`, `generateQR`, `formatTime`, `issueCredential`
- Async functions: `const fetchX = async () => { ... }` or `async function handleX() { ... }` (both forms used interchangeably)
- Event handlers: `handle{Action}` pattern — e.g., `handleAcceptInvitation`, `handleShareCredential`, `handleReset`

**Variables:**
- camelCase for all JS identifiers
- State variables: descriptive nouns — `loading`, `error`, `success`, `connections`, `connectionId`, `invitationUrl`, `selectedConnection`
- Boolean state: `isVerified`, `isFirstStep`, `isLastStep`, `showLoading`, `waitingForConnection`
- Constants: `UPPER_SNAKE_CASE` for endpoint maps — `AGENT_ENDPOINTS`, `PHARMACIST_API_URL`
- Refs: `{name}Ref` — e.g., `requestSentRef`, `fileInputRef`

**Types/Interfaces:**
- Not used — no TypeScript in source files (`.jsx`/`.js` only). TypeScript used only in config files.

## Code Style

**Formatting:**
- No Prettier config detected — no `.prettierrc` or `.prettierrc.*` present
- No ESLint config detected — only `next lint` in package.json scripts, no `.eslintrc` or `eslint.config.*`
- Lint command: `"lint": "next lint"` (relies on Next.js built-in ESLint)

**Linting:**
- Tool: Next.js built-in ESLint (via `next lint`)
- No custom rules configured
- No strict mode enforcement beyond `tsconfig.json` `strict: true` (which only applies to `.ts` files)

**Quotes:**
- Inconsistent: Some files use double quotes (`" "`), some use single quotes (`' '`)
- `header.jsx`: double quotes
- `Navigation.jsx`: single quotes
- `apiService.js`: double quotes
- `doctor/page.jsx`: double quotes (primary), single quotes in imports

**Semicolons:**
- Consistent semicolon usage across all files

**JSX:**
- Multi-line JSX with 2-space indentation
- Tailwind classes on separate lines for readability
- Inline conditional rendering using `&&` and ternary operators
- SVG elements inlined extensively

## Import Organization

**Order observed (informal):**
1. Next.js core imports (e.g., `next/link`, `next/navigation`, `next/image`)
2. React imports (`React`, `useEffect`, `useState`, etc.)
3. Third-party libraries (`axios`, `qrcode`, `lottie-react`, `@heroicons/react`, `@material-tailwind/react`)
4. Local components (`@/components/...`)
5. Local services (`@/services/apiService`)
6. Assets (`../../public/...`)

**Path Aliases:**
- `@/*` maps to `./src/*` (configured in `tsconfig.json`)
- Used for local imports: `import Navigation from '@/components/Navigation'`
- Asset imports use relative paths: `import loader from "../../public/waiting-animation.json"`

## Error Handling

**Pattern:** try/catch with `console.error` + UI state feedback
```js
try {
  const response = await fetch(...);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Server responded with ${response.status}: ${errorText}`);
  }
  // success case
} catch (error) {
  console.error("Error description:", error);
  setError(`User-friendly message: ${error.message}`);
}
```

**Key patterns:**
- Errors stored in `error` state, displayed via dedicated alert banners
- `console.error()` for all caught errors (used extensively for debugging)
- API functions re-throw wrapped errors: `throw new Error(\`Failed to ...: ${error.message}\`)`
- Service layer returns empty arrays/`null` instead of throwing when agent unavailable (polling safety)
- Form validation: manual checks before API calls with early returns

**Graceful degradation:**
- `getConnections` returns `[]` on agent unavailable instead of throwing
- `getProofData` returns `null` on failure
- `getProofStatus` returns `{ isVerified: false, state: "unknown" }` on failure

## Logging

**Framework:** `console.log` / `console.error` / `console.warn`

**Patterns:**
- `console.log("Descriptive text:", variable)` — for flow tracking
- `console.error("Error description:", error)` — for all error cases
- `console.warn()` — for non-critical failures (agent unavailable)
- Heavy debugging logging throughout, especially in `apiService.js` and complex state flows
- Emoji prefixes in user-facing messages: `"🎉 Connection Successful!"`, `"❌ Verification failed"`, `"✅ Secure connection ready!"`
- No structured logging library (no pino, winston, etc.)

## Comments

**When to Comment:**
- File-level doc comments: `// API service for interacting with SSI agents`
- Section headers within files: `// Get proof records`, `// Send proof request`
- TODO/FIXME: Not detected in current codebase
- Inline comments explaining business logic: `// Add a convenience property to check verification status`
- Commented-out code blocks preserved in several files (e.g., commented form sections, alternate UI blocks)
- Development guard comments: `// Prevent duplicate calls in development mode`

**JSDoc/TSDoc:**
- Not used in source files. Function signatures lack JSDoc annotations.

## Function Design

**Size:** Highly variable — some components are 400+ lines with complex state logic (e.g., `doctor/page.jsx` at 1220+ lines, `government/page.jsx` at 1500+ lines). Others are under 25 lines.

**Parameters:**
- Destructured props pattern for all components: `({ prop1, prop2, ... })`
- Service functions accept positional params: `createInvitation(agentType, label, alias)`
- Callbacks passed as props from parent to child (no Context API used)

**Return Values:**
- Components: JSX (with conditional rendering branches)
- Service functions: `return data;` on success, `return [];` or `return null;` on graceful failure
- Async functions: always async, always return a value or throw

## Module Design

**Exports:**
- Pages: `export default function PageName()` — single default export per file
- Components: mix of `export default ComponentName` and named `export function ComponentName`
- Services: named exports — `export const createInvitation = async (...) => {...}`
- No barrel files (`index.js`) in component directories

**Sub-component organization:**
- Role-specific components in subdirectories: `src/components/pharmacist/`
- Stepper orchestrators: `IssuerStepper.jsx`, `VerifierStepper.jsx`
- No shared types file or constants file

## State Management

**Pattern:** React `useState` + `useEffect` hooks — no Context API, no Redux, no Zustand

**Typical state shape:**
```js
const [step, setStep] = useState(1);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);
const [success, setSuccess] = useState(null);
```

**Ref usage:**
- `useRef` to prevent duplicate API calls in Strict Mode: `requestSentRef`
- `useRef` for DOM element access: `fileInputRef`

**Effects:**
- Polling pattern: `setInterval` inside `useEffect` with cleanup via `clearInterval`
- Dependency arrays explicitly managed (minor issue: `ShareProof.jsx` calls `useEffect` with no deps array)

## Component Patterns

**`"use client"` directive:** Present in all interactive components (client components). Missing from simple presentational components (`Congrats.jsx`, `Failure.jsx`, `loading.jsx`, `GetStarted.jsx`).

**Conditional rendering:**
- Ternary: `{condition ? <ComponentA /> : <ComponentB />}`
- Short-circuit: `{error && <ErrorBanner />}`
- Multi-step: `{step === 1 ? <Step1 /> : step === 2 ? <Step2 /> : <Step3 />}`

**UI Library:** `@material-tailwind/react` — uses `Card`, `CardHeader`, `CardBody`, `CardFooter`, `Typography`, `Button`, `Stepper`, `Step`, `Input`, `Navbar`, `MobileNav`

## API Call Patterns

**Dual pattern:**
1. **Service module** (`apiService.js`): centralized fetch calls with consistent error handling
2. **Inline fetch/axios:** Some pages make direct API calls instead of using the service — `government/page.jsx` uses raw `fetch` directly, `EstablishConenction.jsx` uses `axios`
3. **Environment variables:** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ISSUER_API` — but some URLs are hardcoded (`http://localhost:4000`, `http://localhost:4004`)

---

*Convention analysis: 2026-05-23*
