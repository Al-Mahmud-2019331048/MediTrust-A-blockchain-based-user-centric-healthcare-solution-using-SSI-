import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { BaseAgent } from '../shared/agent-base';
import { createProofStatusCache } from '../shared/cache-utils';
import { registerCommonRoutes, AgentConfig } from '../shared/common-routes';
import { registerVerifierRoutes } from '../shared/verifier-routes';
import { registerDebugRoutes } from '../shared/debug-routes';
import { registerPharmacyRoutes } from './src/routes/pharmacy-routes';

const apiPort = parseInt(process.env.PHARMACY_API_PORT || '4004');
const agentPort = apiPort + 1;
const agentLabel = process.env.PHARMACY_AGENT_LABEL || 'Pharmacy';
// registerCommonRoutes()'s /create-invitation handler reads this literal legacy
// name (agents/shared/common-routes.ts), not PHARMACY_AGENT_PUBLIC_ENDPOINT.
const agentPublicEndpoint = process.env.PHARMACIST_AGENT_PUBLIC_ENDPOINT || `http://localhost:${agentPort}`;
const agentDid = process.env.PHARMACY_DID || '';
const agentSeed = process.env.PHARMACY_SEED || '';

const app = express();
app.use(cors());
app.use(express.json());

const agent = new BaseAgent({ port: agentPort, label: agentLabel, publicEndpoint: agentPublicEndpoint });

app.listen(apiPort, async () => {
  console.log(`${agentLabel} API listening on http://localhost:${apiPort} (agent DIDComm port ${agentPort})`);

  await agent.init();
  console.log(`${agentLabel} agent initialized.`);

  const proofCache = createProofStatusCache();
  agent.registerProofStateListener((proofRecord) => {
    proofCache.update(proofRecord.id, proofRecord.state, proofCache.isVerifiedState(proofRecord.state));
  });

  await agent.importDid(agentDid, agentSeed);

  // Pharmacy is verifier-only — it never issues credentials, so it creates no
  // schema/credDef of its own (matches the legacy reference exactly). It
  // verifies against government's and doctor's credDefs via env vars
  // (ISSUER_CRED_DEF_ID, DOCTOR_MEDICAL_CRED_DEF_ID) instead.
  const credentialDefinitionId = 'pharmacist-verifier-only';

  const commonConfig: AgentConfig = {
    agentType: '--pharmacist', // literal string registerCommonRoutes/common-routes.ts branches on
    agentLabel,
    agentPublicEndpoint,
    credentialDefinitionId,
  };

  registerPharmacyRoutes(app, agent, () => credentialDefinitionId);
  registerCommonRoutes(app, agent, commonConfig, proofCache);
  registerVerifierRoutes(app, agent, proofCache);
  registerDebugRoutes(app, agent, agentLabel, agentPublicEndpoint, apiPort, '--pharmacist', agentDid, credentialDefinitionId);

  console.log(`${agentLabel} routes mounted. Ready.`);
});
