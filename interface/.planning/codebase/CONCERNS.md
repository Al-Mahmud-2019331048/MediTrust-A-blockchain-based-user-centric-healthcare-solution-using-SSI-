# Codebase Concerns

**Analysis Date:** 2026-05-23

## Tech Debt

### Hardcoded Agent API URLs

**Issue:** Backend agent URLs are hardcoded as `http://localhost:XXXX` in `src/services/apiService.js` (lines 5-7) and in `src/app/pharmacist/page.jsx` (line 13). The government page at `src/app/government/page.jsx` bypasses the API service entirely and uses hardcoded URLs directly (lines 36, 102, 197). This prevents deployment to non-localhost environments without source modification.

**Files:**
- `src/services/apiService.js` — lines 5-7
- `src/app/pharmacist/page.jsx` — line 13
- `src/app/government/page.jsx` — lines 36, 102, 197

**Impact:** Cannot deploy to staging/production. Every environment change requires editing source files. No Docker/CI compatibility without inlining env vars.

**Fix approach:** Move all agent URLs to environment variables (e.g., `NEXT_PUBLIC_AGENT_GOV_URL`, `NEXT_PUBLIC_AGENT_DOCTOR_URL`, `NEXT_PUBLIC_AGENT_PHARMACY_URL`). Reference them consistently through the API service.

---

### Inconsistent API Access Patterns

**Issue:** Three different API access patterns exist:
1. `src/services/apiService.js` — centralized service with fetch calls (doctor page uses this)
2. `src/app/government/page.jsx` — direct fetch with hardcoded URLs (bypasses service)
3. `src/components/EstablishConenction.jsx` — uses `process.env.NEXT_PUBLIC_API_URL` with axios

**Files:** `src/services/apiService.js`, `src/app/government/page.jsx`, `src/app/pharmacist/page.jsx`, `src/components/EstablishConenction.jsx`

**Impact:** Inconsistent error handling, duplicated logic, confusion about which pattern to follow. Government page has its own logic for filtering connections that should be shared.

**Fix approach:** Refactor all API calls through `apiService.js`. Remove direct fetch calls from page components.

---

### Excessive console.log Statements

**Issue:** Over 120 `console.log`, `console.error`, and `console.warn` calls throughout the source code. These are debugging artifacts that clutter Browser DevTools console and should not ship to production.

**Files:** All files under `src/`. Worst offenders:
- `src/app/government/page.jsx` — 13 console calls
- `src/app/pharmacist/page.jsx` — 32 console calls
- `src/services/apiService.js` — 23 console calls
- `src/components/EstablishConenction.jsx` — 11 console calls

**Impact:** Console noise in production, potential information leakage of sensitive data (PII like `userData`, connection IDs, etc.), 2-3% performance overhead from unnecessary string serialization.

**Fix approach:** Remove or gate behind `process.env.NODE_ENV !== 'production'`.

---

### Typo in Filename and Exports

**Issue:** The file `src/components/EstablishConenction.jsx` is misspelled (missing 'n' — should be "EstablishConnection"). Similarly, `src/components/ConnectionWithVerifiaction.jsx` has "Verifiaction" instead of "Verification". The `ConnenctionWithVerifier` component export matches the filename typo.

**Files:**
- `src/components/EstablishConenction.jsx`
- `src/components/ConnectionWithVerifiaction.jsx`

**Impact:** Renaming would break imports in `IssuerStepper.jsx` and `VerifierStepper.jsx`. Creates confusion for new developers.

**Fix approach:** Rename files and update all import references.

---

### Simulated/Mock Patient Page

**Issue:** `src/app/patient/page.jsx` uses fully simulated data (hardcoded credentials, connections, documents) with `setTimeout` to simulate async operations. It is not connected to any real SSI infrastructure.

**Files:** `src/app/patient/page.jsx` — lines 15-73 (mock data via useEffect), lines 88-109 (simulated accept/share with setTimeout)

**Impact:** The patient experience cannot be tested end-to-end. This page is essentially a static mockup.

**Fix approach:** Connect to a real wallet API or credential storage backend. Remove simulated data paths.

---

### Hardcoded isVerified to true

**Issue:** In `src/services/apiService.js` line 337, `data.isVerified = true` is hardcoded with the comment "If we got data back, it's verified (the endpoint only returns data for verified proofs)". This is a dangerous assumption — an error response or empty data object would still be marked as verified.

**Files:** `src/services/apiService.js` — line 337

**Impact:** False positive verification results. If the API returns an error or unexpected response, the UI will still show "verified".

**Fix approach:** Check the actual verification status from the response data. Remove the hardcoded `isVerified` assignment.

---

### Two Different Navigation/Header Components

**Issue:** There are two separate navigation implementations: `src/components/Navigation.jsx` (used by doctor, government, pharmacist, patient pages) and `src/components/header.jsx` (used by the Stepper-based old pages via `IssuerStepper` which imports it). They have different styles and link structures.

**Files:**
- `src/components/Navigation.jsx`
- `src/components/header.jsx`

**Impact:** Visual inconsistency. The `header.jsx` has placeholder nav links (Pages, Account, Blocks, Docs) that go to `#`.

**Fix approach:** Consolidate into a single navigation component. Remove `header.jsx`.

---

### Package.json Name Mismatch

**Issue:** `package.json` "name" field is `"recruitement-website"` while the project is an SSI healthcare credential system. This is clearly a copy-paste from a different project.

**Files:** `interface/package.json` — line 2

**Impact:** Confusion about project identity. Could affect deployment tooling that reads the name field.

**Fix approach:** Rename to `"patient-centric-ssi"` or appropriate project name.

---

## Known Bugs

### ShareProof useEffect Runs on Every Render

**Issue:** `src/components/ShareProof.jsx` line 108 calls `useEffect(() => { proofRequestHandler(); });` with no dependency array. This sends a proof request on EVERY render, causing infinite API call loops.

**Files:** `src/components/ShareProof.jsx` — line 108-110

**Trigger:** Component renders → sends proof request → state changes → re-renders → sends another proof request.

**Workaround:** The `requestSentRef` pattern (lines 23-25) prevents duplicate calls during development strict mode, but the effect has no dependencies so it still runs on every render cycle.

**Fix approach:** Add empty dependency array `[]` to run once on mount.

---

### SVG Spinner Path Malformed in Pharmacist Components

**Issue:** In `IdentityVerification.jsx` (line 92) and `PrescriptionVerification.jsx` (line 89), the SVG spinner animation path contains a malformed string: `818-8V0C5.373` instead of `018-8V0C5.373`. This produces a broken spinner animation.

**Files:**
- `src/components/pharmacist/IdentityVerification.jsx` — line 92
- `src/components/pharmacist/PrescriptionVerification.jsx` — line 89

**Trigger:** Clicking "Verify Patient Identity" or "Verify Prescription" buttons while loading.

**Workaround:** None — visual glitch only, doesn't block functionality.

**Fix approach:** Replace `818-8V0C5.373` with `018-8V0C5.373` in both files. Also present in `DocumentManagement.jsx` line 161.

---

### DOM Manipulation for File Input Feedback

**Issue:** `src/app/doctor/page.jsx` uses `document.getElementById("selected-filename")` and direct DOM manipulation (lines 1053-1060) instead of React state to show the selected filename.

**Files:** `src/app/doctor/page.jsx` — lines 1051-1061

**Trigger:** User selects a file for upload.

**Workaround:** Works but breaks React's declarative model.

**Fix approach:** Use React state (`useState`) to track selected filename.

---

### Duplicate Verification Success Code Paths

**Issue:** In `src/app/doctor/page.jsx` lines 141-170, there are two nearly identical code blocks for handling successful verification — one when `getProofData` succeeds and one when it throws. Both set the same state.

**Files:** `src/app/doctor/page.jsx` — lines 141-170

**Trigger:** Successful identity verification during proof polling.

**Workaround:** Not a crash bug, but indicates error handling logic is duplicated.

**Fix approach:** Consolidate into a single success handler.

---

## Security Considerations

### Hardcoded localhost URLs with No TLS

**Issue:** All agent API URLs use `http://localhost:XXXX` with no HTTPS. Credential data (PII, medical conditions, national IDs) is transmitted in plaintext.

**Files:** `src/services/apiService.js`, `src/app/government/page.jsx`, `src/app/pharmacist/page.jsx`

**Risk:** Man-in-the-middle attack on same machine or network. Any process on localhost can intercept SSI credential data including name, age, national ID, medical conditions, blood type, and emergency contact info.

**Current mitigation:** None. This is a demonstration/research project.

**Recommendations:** Use HTTPS in production. Add `Content-Security-Policy` headers via next.config.ts. Add environment-aware URL selection.

---

### Sensitive Data in console.log

**Issue:** Personally identifiable information (PII) and medical data are logged to the browser console. `src/app/government/page.jsx` line 168 logs `userData` which contains name, age, email, nationalId, medicalCondition, bloodType, emergencyContact.

**Files:** Multiple files, notably `src/app/government/page.jsx` line 168, `src/app/pharmacist/page.jsx` lines 304-321

**Risk:** Anyone with access to the browser DevTools can see PII and medical information. This includes shared machines, browser extensions with permissions, and recorded sessions.

**Current mitigation:** None.

**Recommendations:** Remove or gate all PII-related console.log statements.

---

### Patient Page Uses Simulated Data — No Real Auth

**Issue:** The patient page (`src/app/patient/page.jsx`) uses hardcoded mock data and simulated connection/credential sharing. There is no real authentication, no wallet integration, and no credential exchange.

**Files:** `src/app/patient/page.jsx`

**Risk:** Provides a false sense of security. A user could mistakenly believe their data is protected by SSI when the page is just showing hardcoded values.

**Current mitigation:** Comments in code acknowledge it's simulated ("Simulated data for demonstration purposes" and "In a real implementation, these would come from the patient's wallet").

**Recommendations:** Clearly mark the page as "Demo/Simulation Mode" in the UI. Add a real wallet connection implementation.

---

## Performance Bottlenecks

### Polling-Based Connection Detection

**Issue:** Multiple pages use `setInterval` for polling connection status every 3-5 seconds indefinitely:
- `src/app/government/page.jsx` — 5 second interval (line 91)
- `src/app/doctor/page.jsx` — 3 second interval (line 58)
- `src/app/pharmacist/page.jsx` — 3 second interval (line 64)
- `src/components/EstablishConenction.jsx` — 2 second interval (line 125)
- `src/components/ShareProof.jsx` — 2 second interval (line 96)

**Files:** All listed above

**Problem:** Continuous polling creates unnecessary network requests even when no connection activity is expected. Browser tabs left open will keep polling server indefinitely.

**Improvement path:** Use WebSocket connections or Server-Sent Events for real-time updates. Implement exponential backoff. Add idle detection to pause polling.

---

### Large Component Files

**Issue:** Two page components exceed 1000 lines:
- `src/app/government/page.jsx` — 1503 lines
- `src/app/doctor/page.jsx` — 1245 lines

These contain extensive JSX with inline SVG icons, duplicated status message patterns, and complex multi-step logic in a single component.

**Files:** `src/app/government/page.jsx`, `src/app/doctor/page.jsx`

**Cause:** Monolithic component pattern. Step indicator, error/success messages, and all workflow steps are in one file.

**Improvement path:** Extract SVG icon components into a shared `Icons.jsx`. Extract step panels into separate components. Extract status message components (already partially done in pharmacist).

---

## Fragile Areas

### apiService.js Error Recovery

**Issue:** `src/services/apiService.js` silently catches errors and returns empty arrays or null values in 5 of 8 functions (lines 87, 108, 278, 304, 344). This masks real server errors during development and could hide integration failures.

**Files:** `src/services/apiService.js`

**Why fragile:** Silent error swallowing means failed API calls show no indication of failure to the user. The UI continues showing empty states as if nothing is wrong.

**Safe modification:** Add optional `throwOnError` parameter. In development, throw errors. In production, use user-facing error messages.

**Test coverage:** No tests exist for this service.

---

### Government Page Direct Fetch Bypass

**Issue:** `src/app/government/page.jsx` makes direct fetch calls to the backend (lines 36, 102, 197) instead of using `apiService.js`. This means changes to API endpoints need to be updated in two places.

**Files:** `src/app/government/page.jsx`

**Why fragile:** Direct fetch calls don't benefit from any centralized error handling, logging, or URL management in `apiService.js`. If the API schema changes, this page will break while others work.

**Safe modification:** Refactor all government API calls through `apiService.js`.

**Test coverage:** Zero.

---

### Pharmacy Polling Chain Race Conditions

**Issue:** `src/app/pharmacist/page.jsx` has sequential polling chains that rely on timers (lines 160-218, 265-411). The verification polling, prescription polling, and document fetching are loosely coupled via state. Race conditions can occur where `verificationResult` is not set before `PrescriptionVerification` tries to read it.

**Files:** `src/app/pharmacist/page.jsx`, `src/components/pharmacist/PrescriptionVerification.jsx` (line 11 checks `!verificationResult?.success`)

**Why fragile:** If the identity verification result arrives at the same time as a component re-render, the `PrescriptionVerification` component might not see the updated state and remain hidden.

**Safe modification:** Use a proper state machine pattern. Move polling logic to a custom hook.

---

## Scaling Limits

**Current capacity:** Single-user demo. Pages assume one connection at a time. Lists of connections are fetched but only the first "completed" connection is auto-selected.

**Limit:** The polling-based architecture supports at most a handful of concurrent connections. Each active page polls the backend every 2-5 seconds. With 10 concurrent connections, that's 1200 requests/hour per user.

**Scaling path:** Replace polling with WebSockets. Add connection pagination on the backend. Implement proper session management.

---

## Dependencies at Risk

**@material-tailwind/react (^2.1.10):**
- Risk: Material Tailwind is known for API instability across major versions. The v2.x line has breaking changes from v1.x and may not receive long-term support.
- Impact: UI components (Stepper, Step, Card, Button, Input, etc.) across 8+ components would need migration.
- Migration plan: Consider replacing with shadcn/ui or headless UI components for better maintainability.

**Next.js 15.0.1 (specific patch):**
- Risk: Using an early patch release of Next.js 15 (not the latest). Security patches and bug fixes in later releases (15.0.4+) may be missed.
- Impact: Unpatched vulnerabilities in server components or middleware.
- Migration plan: Update to latest Next.js 15 stable release.

---

## Missing Critical Features

**No tests:** The entire `src/` directory has zero test files. No unit tests, no integration tests, no E2E tests. Everything is verified manually.

**No error boundary:** No React error boundaries are defined. A runtime exception in any component will crash the entire page.

**No loading skeleton:** Loading states use spinners only. No skeleton screens for content loading.

**No WebSocket/SSE support:** All real-time updates use polling (setInterval) instead of proper push-based communication.

**No TypeScript usage despite configuration:** `tsconfig.json` has `strict: true` but all source files are `.jsx`/`.js`. No TypeScript types are used. The config's `include` array even explicitly lists individual `.jsx` files.

---

## Test Coverage Gaps

**What's not tested:** Everything. Zero test files exist anywhere in the `interface/` directory.

**Files:** All `src/` files have no corresponding `.test.jsx` or `.spec.jsx` files.

**Risk:** Any refactoring, dependency upgrade, or feature addition risks regressions that won't be caught.

**Priority:** High

---

## Code Quality Issues

**Inconsistent formatting:** Mixed use of single quotes, double quotes, semicolons, and indentation across files. `globals.css` uses single quotes, components use double quotes inconsistently.

**Dead code:** Commented-out code blocks in `src/app/government/page.jsx` lines 1147-1178 (Quick Fill Sample Data section). The code is disabled but not deleted.

**Multiple unused imports:** `Image` imported but unused in multiple components (`src/app/verifier/page.jsx`, `src/components/loading.jsx`). `React` imported but unused in some components.

**Empty/unused components:** `src/app/verifier/page.jsx` is only 10 lines — just renders `VerifierStepper` with no additional logic. The `IssuerStepper` and `VerifierStepper` components may not be actively used by the main navigation flow.

---

*Concerns audit: 2026-05-23*
