# Codebase Structure

**Analysis Date:** 2026-05-23

## Directory Layout

```
ssi-tutorial/
├── README.md                          # Project overview
├── app_description.md                 # App description
├── changelog.md                       # Change log
├── TODOS.md                           # Project todos
├── objective1_performance.md          # Performance evaluation doc
├── objective2_selective_disclosure.md # Selective disclosure doc
├── objective3_scalability.md          # Scalability doc
├── objective4_privacy_compliance.md   # Privacy/compliance doc
├── performance evaluation.md          # Performance eval doc
├── slide_performance_evaluation.md    # Slide deck — performance
├── slide_privacy_compliance.md        # Slide deck — privacy compliance
├── received-prescription.json         # Sample received prescription
├── how to write performance evaluation.md  # Guide doc
│
├── interface/                         # FRONTEND — Next.js app
│   ├── next.config.ts                 # Next.js config (minimal)
│   ├── tailwind.config.ts             # Tailwind CSS config + MT wrapper
│   ├── tsconfig.json                  # TypeScript config (allowJs, path alias @/)
│   ├── postcss.config.mjs             # PostCSS config
│   ├── package.json                   # Dependencies
│   ├── .env.sample                    # Env template
│   ├── public/                        # Static assets
│   │   ├── congrats-animation.json    # Lottie animation
│   │   ├── failed-animation.json      # Lottie animation
│   │   ├── get-started.json           # Lottie animation
│   │   ├── share-credential.json      # Lottie animation
│   │   ├── waiting-animation.json     # Lottie animation
│   │   └── accept-cred.json           # Lottie animation
│   └── src/                           # Source code
│       ├── app/                       # Next.js App Router pages
│       │   ├── globals.css            # Global styles (Tailwind base + custom)
│       │   ├── layout.jsx             # Root layout — Geist fonts, metadata
│       │   ├── page.jsx               # Home page — landing + role cards
│       │   ├── patient/page.jsx       # Patient wallet — credentials/connections/documents
│       │   ├── doctor/page.jsx        # Doctor portal — issue prescriptions
│       │   ├── pharmacist/page.jsx    # Pharmacist portal — verify prescriptions
│       │   ├── government/page.jsx    # Government portal — issue identity credentials
│       │   └── verifier/page.jsx      # Verifier portal — verify credentials
│       ├── components/                # Reusable React components
│       │   ├── Navigation.jsx         # Top navigation bar
│       │   ├── header.jsx             # Header component (used by steppers)
│       │   ├── QRCodeDisplay.jsx       # QR code rendering + debug info
│       │   ├── loading.jsx            # Loading spinner
│       │   ├── GetStarted.jsx         # Onboarding step component
│       │   ├── EstablishConenction.jsx # Connection establishment UI (note typo in name)
│       │   ├── ConnectionWithVerifiaction.jsx # Connection + verification combined
│       │   ├── AcceptCredential.jsx   # Accept credential UI
│       │   ├── ShareProof.jsx         # Share proof UI
│       │   ├── IssuerStepper.jsx      # Stepper flow for credential issuer
│       │   ├── VerifierStepper.jsx    # Stepper flow for credential verifier
│       │   ├── Congrats.jsx           # Success animation component
│       │   ├── Failure.jsx            # Failure state component
│       │   ├── Apply.jsx              # Application form component
│       │   └── pharmacist/            # Pharmacist-specific sub-components
│       │       ├── PharmacistHeader.jsx       # Header + progress stepper
│       │       ├── PatientConnectionSection.jsx # QR + connection list
│       │       ├── ConnectionManager.jsx      # Connection CRUD
│       │       ├── QRCodeSection.jsx          # QR code display for pharmacist
│       │       ├── IdentityVerification.jsx   # Identity verification panel
│       │       ├── PrescriptionVerification.jsx # Prescription proof verification
│       │       ├── DocumentManagement.jsx     # Document fetch/download UI
│       │       └── StatusMessages.jsx         # Error/success notification bar
│       └── services/
│           └── apiService.js          # Centralized HTTP client for 3 agent backends
│
└── demo/                              # BACKEND — Credo SSI agents + docs
    ├── postman-api.json               # Postman collection for API testing
    └── credo/                         # Credo SSI agent implementation
        ├── package.json               # Dependencies (Credo TS v0.5.13)
        ├── tsconfig.json              # TypeScript config
        ├── .env                       # Agent config (env vars)
        ├── setup-db.sh                # Database setup script
        ├── server.ts                  # 🔥 Main Express server (1799 lines)
        ├── agent.ts                   # BaseAgent — Credo wrapper class (580 lines)
        ├── module.ts                  # Credo module composition (55 lines)
        ├── network.ts                 # Indy ledger config (bcovrin test net)
        ├── types.ts                   # TypeScript interfaces (42 lines)
        ├── prisma/                    # Prisma ORM
        │   └── schema.prisma          # MongoDB schema definition
        └── src/                       # Application source
            ├── lib/
            │   ├── database.ts        # MongoDB initialization via Prisma
            │   └── document-storage.ts # Local file storage for documents
            ├── routes/
            │   └── document-routes.ts # Document upload/download API routes
            └── services/
                └── document-service.ts # Document CRUD operations
```

## Directory Purposes

**`interface/src/app/`:**
- Purpose: Next.js App Router pages — one file per route
- Contains: Server/client page components, root layout, global CSS
- Key files: `layout.jsx` (root layout with metadata), `page.jsx` (home), `doctor/page.jsx` (1220+ lines), `pharmacist/page.jsx` (558 lines), `government/page.jsx` (1204+ lines), `patient/page.jsx` (388 lines)

**`interface/src/components/`:**
- Purpose: Reusable and role-specific React components
- Contains: Shared components (Navigation, QRCodeDisplay, IssuerStepper, VerifierStepper), pharmacist sub-components directory
- Key files: `Navigation.jsx` (shared nav bar), QRCodeDisplay (QR + debug info)

**`interface/src/services/`:**
- Purpose: API abstraction layer between frontend pages and backend agents
- Contains: One file `apiService.js` with all endpoint functions
- Key files: `apiService.js` (387 lines, 12 exported functions)

**`demo/credo/`:**
- Purpose: Backend SSI agent implementation using Credo TS framework
- Contains: Express server (3 agent types), Credo agent wrapper, module config, docs routes
- Key files: `server.ts` (1799 lines, monolithic), `agent.ts` (580 lines, BaseAgent class)

**`demo/credo/src/`:**
- Purpose: Application-layer backend services
- Contains: Database init, document storage, document routes, document service
- Key files: `document-routes.ts`, `document-service.ts`, `database.ts`, `document-storage.ts`

## Key File Locations

**Entry Points:**
- `interface/src/app/layout.jsx`: Frontend root layout
- `interface/src/app/page.jsx`: Frontend home page
- `demo/credo/server.ts`: Backend entry — 3 agents controlled by `--issuer/--doctor/--pharmacist` CLI flag

**Configuration:**
- `interface/next.config.ts`: Next.js config (minimal)
- `interface/tailwind.config.ts`: Tailwind with `@material-tailwind/react`
- `interface/tsconfig.json`: TypeScript with `@/*` alias mapping to `./src/*`
- `interface/postcss.config.mjs`: PostCSS (Tailwind pipeline)
- `interface/package.json`: npm dependencies
- `demo/credo/tsconfig.json`: Backend TypeScript config
- `demo/credo/package.json`: npm dependencies (Credo TS v0.5.13)
- `demo/credo/prisma/schema.prisma`: MongoDB schema
- `demo/credo/.env`: Agent config (endpoints, ports, DIDs, seeds)

**Core Logic:**
- `interface/src/services/apiService.js`: All frontend-backend HTTP calls
- `demo/credo/agent.ts`: Credo Agent lifecycle and SSI operations
- `demo/credo/server.ts`: All API route handlers
- `demo/credo/module.ts`: Credo module registration
- `demo/credo/network.ts`: Indy blockchain network config

**Testing:**
- Not detected — no test framework, no test files, no test scripts in `package.json`

## Naming Conventions

**Files:**
- Frontend pages: `page.jsx` (Next.js App Router convention) inside named route directories
- Components: PascalCase single-word or compound — `Navigation.jsx`, `QRCodeDisplay.jsx`, `IdentityVerification.jsx`
- Services: camelCase compound — `apiService.js`
- Backend source: kebab-case compound — `document-routes.ts`, `document-storage.ts`, `document-service.ts`

**Directories:**
- Route directories: lowercase role names — `patient/`, `doctor/`, `pharmacist/`, `government/`, `verifier/`
- Component sub-directories: lowercase role names — `pharmacist/`
- Backend source directories: `lib/`, `routes/`, `services/` — lowercase, plural

**Functions:**
- Frontend: camelCase — `handleCreateInvitation`, `fetchConnections`, `verifyPatientIdentity`, `verifyPrescription`
- Services: camelCase — `createInvitation`, `getConnections`, `sendProofRequest`, `uploadMedicalDocument`
- Backend: camelCase — `initializeAgent`, `updateProofStatus`, `clearProofStatusCache`

**Variables:**
- camelCase throughout — `activeStep`, `selectedConnection`, `verificationResult`, `invitationUrl`
- No Hungarian notation or prefixes

**Types:**
- TypeScript interfaces in PascalCase — `CreateInvitationOptions`, `SendProofRequest`, `AttributeElement`

## Where to Add New Code

**New Feature (new role portal):**
- Primary code: `interface/src/app/{rolename}/page.jsx`
- Shared components: `interface/src/components/{rolename}/` if sub-components are needed
- Route registration: Automatic via Next.js App Router — file-based routing, no manual config needed
- Navigation link: Add entry in `interface/src/components/Navigation.jsx`

**New API Route (backend):**
- Route handler: Add to `demo/credo/server.ts` (current pattern) OR create `demo/credo/src/routes/{name}-routes.ts`
- Service logic: `demo/credo/src/services/{name}-service.ts`
- Library/utility: `demo/credo/src/lib/{name}.ts`

**New API Endpoint (frontend client):**
- Add function to `interface/src/services/apiService.js`
- Agent URL config: Add entry to `AGENT_ENDPOINTS` map (line 4-8)

**New Component:**
- Shared: `interface/src/components/{ComponentName}.jsx`
- Pharmacist-specific: `interface/src/components/pharmacist/{ComponentName}.jsx`

**New Agent Type:**
- Add `agentType` branch in `demo/credo/server.ts`
- Add env vars in `demo/credo/.env`
- Add agent endpoint in `interface/src/services/apiService.js:4-8`

**Tests:**
- No test infrastructure exists. First test would need: vitest/jest config, test directory setup

## Special Directories

**`interface/public/`:**
- Purpose: Static Lottie animation JSON files for success/failure/waiting animations
- Generated: No
- Committed: Yes

**`demo/credo/prisma/`:**
- Purpose: Prisma ORM schema for MongoDB document metadata
- Generated: Partially (schema.prisma is source, migrations are generated)
- Committed: Yes

**`demo/credo/node_modules/`:**
- Purpose: 3rd-party dependencies (Credo TS framework, Express, etc.)
- Generated: Yes (by yarn install)
- Committed: No

---

*Structure analysis: 2026-05-23*
