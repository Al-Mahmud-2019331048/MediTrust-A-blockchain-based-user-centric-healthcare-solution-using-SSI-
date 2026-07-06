import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { BaseAgent } from '../shared/agent-base';
import { createProofStatusCache } from '../shared/cache-utils';
import { registerCommonRoutes, AgentConfig } from '../shared/common-routes';
import { registerDebugRoutes } from '../shared/debug-routes';
import { registerGovernmentRoutes } from './src/routes/credential-routes';

const apiPort = parseInt(process.env.GOVERNMENT_API_PORT || '4000');
const agentPort = apiPort + 1;
const agentLabel = process.env.GOVERNMENT_AGENT_LABEL || 'Government Identity Issuer';
// registerCommonRoutes()'s /create-invitation handler reads this literal legacy
// name (agents/shared/common-routes.ts), not GOVERNMENT_AGENT_PUBLIC_ENDPOINT.
const agentPublicEndpoint = process.env.ISSUER_AGENT_PUBLIC_ENDPOINT || `http://localhost:${agentPort}`;
const agentDid = process.env.GOVERNMENT_DID || '';
const agentSeed = process.env.GOVERNMENT_SEED || '';

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

  // Government registers its own schema + credential definition for the
  // identity credential it issues. Falls back to a dummy credDef id on
  // failure (e.g. no real DID/seed configured yet) so routes still mount and
  // the server stays up — matches the legacy reference's resilience pattern.
  let credentialDefinitionId = 'dummy-credential-definition-id-for-government';
  try {
    const schemaResult = await agent.createSchema(agentDid, {
      name: 'patient_credential',
      version: `1.0.${Math.floor(Math.random() * 100)}`,
      attrNames: ['name', 'age', 'email', 'nationalId', 'medicalCondition', 'bloodType', 'emergencyContact'],
      issuerId: agentDid,
    });
    if (schemaResult.schemaState.state !== 'finished') {
      throw new Error(`Schema registration did not finish: ${JSON.stringify(schemaResult.schemaState)}`);
    }
    const credDefResult = await agent.createCredentialDefinition(
      agentDid,
      schemaResult.schemaState.schemaId,
      'patient_id_credential'
    );
    if (credDefResult.credentialDefinitionState.state !== 'finished') {
      throw new Error(`Cred def registration did not finish: ${JSON.stringify(credDefResult.credentialDefinitionState)}`);
    }
    credentialDefinitionId = credDefResult.credentialDefinitionState.credentialDefinitionId;
    console.log(`Government schema + credential definition registered: ${credentialDefinitionId}`);
  } catch (error) {
    console.warn(`Government schema/credDef registration failed, routes will mount with a dummy id: ${(error as Error).message}`);
  }

  const commonConfig: AgentConfig = {
    agentType: '--issuer', // literal string registerCommonRoutes/common-routes.ts branches on
    agentLabel,
    agentPublicEndpoint,
    credentialDefinitionId,
  };

  registerGovernmentRoutes(app, agent, agentDid, () => credentialDefinitionId);
  registerCommonRoutes(app, agent, commonConfig, proofCache);
  registerDebugRoutes(app, agent, agentLabel, agentPublicEndpoint, apiPort, '--issuer', agentDid, credentialDefinitionId);

  console.log(`${agentLabel} routes mounted. Ready.`);
});
