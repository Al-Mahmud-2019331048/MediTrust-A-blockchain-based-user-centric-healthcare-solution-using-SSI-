# Technology Stack

**Last updated:** 2026-05-23
**Scope:** Full repo

## Languages & Runtime

| Layer | Language | Runtime |
|-------|----------|---------|
| Frontend | TypeScript 5.x + JSX | Node.js >=20 |
| Backend/API | JavaScript (`.js`) | Node.js (Express via Credo reverse proxy) |

## Frontend

### Core Framework
- **Next.js 15.0.1** — App Router, server-side rendering, file-based routing
- **React 18.2.0** — Component library, hooks (`useState`, `useEffect`, `useContext`)
- **TypeScript 5.x** — Strict mode enabled in `tsconfig.json`

### UI & Styling
- **Tailwind CSS 3.4** — Utility-first CSS framework
- **@material-tailwind/react 2.1.10** — Material Design component library built on Tailwind
- **PostCSS 8** — CSS processing pipeline

### Icons & Animations
- **@heroicons/react** — SVG icon set
- **lucide-react 0.515.0** — Lucide icon set
- **lottie-react 2.4.0** — Lottie animation player

### QR Code
- **qrcode 1.5.4** — QR code generation (Node.js)
- **qrcode.react 4.2.0** — QR code React component

### HTTP Client
- **axios 1.7.7** — Promise-based HTTP client for API calls

## Backend / Integration Layer

The frontend communicates with an external **Credo/Express backend** (not in this repo) that handles SSI agent operations. The frontend is purely a presentation layer.

## Build & Configuration

| Tool | Config File | Purpose |
|------|------------|---------|
| TypeScript | `tsconfig.json` | Strict mode, ES2017 target, `@/*` path alias |
| Next.js | `next.config.ts` | Minimal config (no custom settings) |
| Tailwind | `tailwind.config.ts` | Custom colors, Material Tailwind plugin |
| PostCSS | `postcss.config.mjs` | Tailwind CSS plugin |
| ESLint | `next lint` via `package.json` | Next.js built-in linting (no custom config) |

## Development Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   Copy `.env.sample` to `.env.local`:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:4002
   ISSUER_CRED_DEF_ID=did:indy:bcovrin:test:7ZYfL2LQHtp2XgWYBi2rkh
   ```

3. **Run development server:**
   ```bash
   npm run dev
   # or: yarn dev / pnpm dev / bun dev
   ```

4. **Open:** http://localhost:3000

## Dependency Summary

| Dependency | Version | Purpose |
|-----------|---------|---------|
| next | 15.0.1 | React framework with App Router |
| react / react-dom | 18.2.0 | UI component library |
| typescript | ^5 | Type checking |
| tailwindcss | ^3.4 | Utility CSS framework |
| @material-tailwind/react | ^2.1.10 | Material Design components |
| axios | ^1.7.7 | HTTP client |
| @heroicons/react | ^2.0.18 | SVG icons |
| lucide-react | ^0.515.0 | SVG icons |
| lottie-react | ^2.4.0 | Animations |
| qrcode | ^1.5.4 | QR generation (server) |
| qrcode.react | ^4.2.0 | QR component (client) |
| postcss | ^8 | CSS processor |
