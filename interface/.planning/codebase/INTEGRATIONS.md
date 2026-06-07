# External Integrations

**Last updated:** 2026-05-23
**Scope:** Full repo

## 1. Credo Backend API (Express/Node.js)

| Property | Value |
|----------|-------|
| **URL** | `http://localhost:4002` (configurable via `NEXT_PUBLIC_API_URL`) |
| **Auth** | None (local network) |
| **Transport** | HTTP via `axios` |
| **Docs** | Not published — reverse-engineered from frontend calls |

The frontend communicates with an external Express.js backend that wraps Hyperledger Credo (previously Aries Framework JavaScript). This backend handles all SSI agent operations, including credential issuance, proof verification, and DID communication.

### API Endpoints Consumed

**Issuer endpoints:**
- `GET /api/issuer/register` — Register a new connection invitation (returns invitation URL)
- `GET /api/issuer/connections` — List active issuer connections
- `GET /api/issuer/credential/:connectionId` — Issue credential to established connection
- `GET /api/issuer/schemaId` — Get schema ID
- `GET /api/issuer/credDefId` — Get credential definition ID

**Verifier endpoints:**
- `GET /api/verifier/register` — Register new verification invitation
- `GET /api/verifier/connections` — List active verifier connections
- `POST /api/verifier/send-proof-request/:connectionId` — Request proof from connection
- `GET /api/verifier/proofs/:connectionId` — Get proof status for connection

## 2. BCovrin TestNet (Indy Ledger)

| Property | Value |
|----------|-------|
| **Network** | BCovrin TestNet (public permissioned Indy ledger) |
| **DID** | `did:indy:bcovrin:test:7ZYfL2LQHtp2XgWYBi2rkh` |
| **Purpose** | Schema registry, credential definition registry, DID registry |
| **Access** | Via Credo backend (frontend does not interact directly) |

Used by the backend to:
- Register DID documents
- Publish credential schemas
- Store credential definitions (`credDefId`)
- Resolve DIDs during proof verification

## 3. AnonCreds (Anonymous Credentials)

| Property | Value |
|----------|-------|
| **Standard** | Hyperledger AnonCreds (AKA Indy AnonCreds) |
| **Type** | CL (Camenisch-Lysyanskaya) signatures |
| **Purpose** | Zero-knowledge credential issuance and verification |

Handled entirely by the backend. The frontend triggers issuance and verification flows but does not handle cryptographic operations.

## 4. DIDComm (DID Communication)

| Property | Value |
|----------|-------|
| **Protocol** | DIDComm v1 (Aries RFCs) |
| **Transport** | HTTP (invitation URLs contain DIDComm messages) |
| **Mediation** | Not used (peer-to-peer via ngrok tunnels) |

The backend routes DIDComm messages between issuer, verifier, and holder (mobile wallet) agents. The frontend displays invitation QR codes that the mobile wallet scans to establish DIDComm connections.

## 5. Bifold Wallet (Mobile)

| Property | Value |
|----------|-------|
| **App** | Bifold (open source Aries mobile wallet) |
| **Platform** | iOS / Android |
| **Connection** | User scans QR code from frontend |

The end-user holds credentials in the Bifold mobile wallet. Flow:
1. Frontend displays QR code with DIDComm invitation URL
2. User scans with Bifold wallet
3. Wallet establishes DIDComm connection with backend agent
4. Credential is issued/verified through this connection

## 6. ngrok (Tunnel)

| Property | Value |
|----------|-------|
| **Purpose** | Expose local backend to internet for mobile wallet connectivity |
| **Included URLs** | Yes (in invitation payloads) |

The backend uses ngrok to create a publicly accessible URL so the Bifold mobile wallet can reach the local agent from a different network.

## Integration Architecture

```
[Browser Frontend]  ←→  [Express/Credo Backend]  ←→  [BCovrin TestNet]
      ↓                       ↕                           (Indy Ledger)
   (QR code)             (DIDComm via ngrok)
      ↓                       ↕
[Bifold Wallet]  ←→  [Mobile User Agent]
```

## No External Integrations (Explicitly Not Used)

- **Auth providers** — No OAuth, SSO, or social login
- **Monitoring** — No Sentry, DataDog, or similar
- **CI/CD** — No GitHub Actions, CircleCI, or similar
- **Webhooks** — No external webhook receivers
- **Email/SMS** — No notification services
- **Cloud storage** — No S3, Cloud Storage, or similar
- **Analytics** — No GA, Mixpanel, or similar
