# Technology Stack

**Analysis Date:** 2026-05-23

## Languages

**Primary:**
- TypeScript 5.x - All backend Credo agent code (`demo/credo/**/*.ts`), server config
- JavaScript (JSX) - All frontend Next.js pages and components (`interface/src/**/*.jsx`)
- TypeScript - Frontend config files (`next.config.ts`, `tailwind.config.ts`)
- Shell (Bash) - Database setup script (`demo/credo/setup-db.sh`)

**Secondary:**
- CSS - Global styles (`interface/src/app/globals.css`)
- JSON - Static assets, animation files, config manifests
- SVG - Public assets and icons (`interface/public/*.svg`)
- Prisma Schema - Database model definition (`demo/credo/prisma/schema.prisma`)

## Runtime

**Environment:**
- Node.js >=20.0.0 (enforced in `demo/credo/package.json` engines field)
- Node.js ^20 (required by `interface/package.json` via `@types/node`)

**Package Manager:**
- Backend: `yarn` + `npm` - lockfiles `yarn.lock` + `package-lock.json` in `demo/credo/`
- Frontend: `yarn` + `npm` - lockfiles `yarn.lock` + `package-lock.json` in `interface/`

## Frameworks

**Core:**
- Next.js 15.0.1 - React metaframework for the frontend (`interface/`)
- React 18.2.0 - UI component library (`interface/`)
- Express 4.21.2 - HTTP server for Credo agent endpoints (`demo/credo/`)
- Credo TS (formerly Aries Framework JavaScript) 0.5.13 - SSI/Verifiable Credential agent framework (`demo/credo/`)

**UI/Component Libraries:**
- @material-tailwind/react 2.1.10 - Material Design component library built on Tailwind
- @heroicons/react 2.0.18 - SVG icon set
- lucide-react 0.515.0 - Additional icon set
- lottie-react 2.4.0 - Lottie animation rendering (uses JSON animations in `interface/public/`)
- qrcode.react 4.2.0 - QR code display component
- qrcode 1.5.4 - QR code generation utility

**Testing:**
- Not detected - No test files or test configs exist in the codebase

**Build/Dev:**
- TypeScript compiler (`tsc`) - Backend type checking (`demo/credo/tsconfig.json`)
- ts-node 10.9.2 - Run TypeScript backend directly (`demo/credo/`)
- Next.js built-in bundler (webpack/SWC) - Frontend build (`interface/.next/`)

## Key Dependencies

**Critical (SSI/Blockchain):**
- `@credo-ts/core` 0.5.13 - Core Credo agent with DID management, connections, credentials, proofs (`demo/credo/`)
- `@credo-ts/anoncreds` 0.5.13 - AnonCreds credential format support (`demo/credo/`)
- `@credo-ts/askar` 0.5.13 - Secure storage (Askar wallet) (`demo/credo/`)
- `@credo-ts/indy-vdr` 0.5.13 - Indy ledger interaction via VDR (`demo/credo/`)
- `@credo-ts/node` 0.5.13 - Node.js-specific agent transports (`demo/credo/`)
- `@hyperledger/anoncreds-nodejs` 0.2.2 - Native AnonCreds crypto bindings (`demo/credo/`)
- `@hyperledger/aries-askar-nodejs` 0.2.3 - Native Askar secure storage bindings (`demo/credo/`)
- `@hyperledger/indy-vdr-nodejs` 0.2.2 - Native Indy VDR bindings (`demo/credo/`)

**Infrastructure (Backend):**
- `express` 4.21.2 - REST API server (`demo/credo/`)
- `cors` 2.8.5 - CORS middleware (`demo/credo/`)
- `multer` 1.4.5-lts.2 - File upload middleware (`demo/credo/`)
- `@prisma/client` 5.10.0 - MongoDB ORM/client (`demo/credo/`)
- `prisma` 5.10.0 (dev) - Prisma CLI (`demo/credo/`)
- `mongodb` 6.3.0 - MongoDB driver (`demo/credo/`)
- `dotenv` 16.4.7 - Environment variable loading (`demo/credo/`)
- `jsonwebtoken` 9.0.2 - JWT for document signing (`demo/credo/`)
- `node-fetch` 3.3.2 - HTTP fetch for Node.js (`demo/credo/`)

**Infrastructure (Frontend):**
- `axios` 1.7.7 - HTTP client (listed in `package.json` but not used in source — `apiService.js` uses native `fetch`)
- `postcss` 8 - CSS transformation (dev dependency)
- `tailwindcss` 3.4.1 - Utility-first CSS framework (dev dependency)

## Configuration

**Environment:**
- Backend: `.env` file at `demo/credo/.env` (contains DB URL, DID/seeds, agent ports, endpoint URLs)
- Frontend: `.env.sample` at `interface/.env.sample` (template: `NEXT_PUBLIC_API_URL`, `ISSUER_CRED_DEF_ID`)
- Runtime config from `dotenv` package loaded in `demo/credo/server.ts` and `demo/credo/src/lib/database.ts`

**Key env vars required:**
- `ISSUER_API_PORT`, `DOCTOR_API_PORT`, `PHARMACIST_API_PORT` - Agent API ports
- `ISSUER_AGENT_PUBLIC_ENDPOINT` etc. - Public agent URLs (typically ngrok tunnels)
- `ISSUER_DID`, `DOCTOR_DID`, `PHARMACIST_DID` - Indy DID identifiers
- `ISSUER_SEED`, `DOCTOR_SEED`, `PHARMACIST_SEED` - DID seed phrases
- `DATABASE_URL` - MongoDB connection string (Prisma format)
- `DOCUMENT_SIGNING_SECRET` - Secret for JWT document signing
- `ISSUER_CRED_DEF_ID` - Credential definition ID for identity credentials
- `NEXT_PUBLIC_API_URL` - Frontend API base URL

**Build:**
- `demo/credo/tsconfig.json` - `target: ES2020`, `module: NodeNext`
- `interface/tsconfig.json` - `target: ES2017`, `jsx: preserve`, path alias `@/*` → `./src/*`
- `interface/next.config.ts` - Minimal (default config, no custom settings)
- `interface/postcss.config.mjs` - Tailwind CSS plugin only
- `interface/tailwind.config.ts` - withMT wrapper for Material Tailwind integration

## Platform Requirements

**Development:**
- Node.js >=18 (v18 recommended per README; ^20 from engines)
- yarn package manager
- MongoDB instance (local or Atlas)
- ngrok for public agent endpoints (needed for mobile wallet connectivity)
- Git

**Production:**
- Not deployed — development/demo project only (no production Dockerfile, CI/CD, or deployment config)
- Bifold mobile wallet (Aries Framework React Native based) used for holder interactions

---

*Stack analysis: 2026-05-23*
