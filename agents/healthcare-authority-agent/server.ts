import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { BaseAgent } from '../shared/agent-base';
import { createProofStatusCache } from '../shared/cache-utils';
import { registerCommonRoutes, AgentConfig } from '../shared/common-routes';
import { registerVerifierRoutes } from '../shared/verifier-routes';
import { registerDebugRoutes } from '../shared/debug-routes';
import { registerHealthcareAuthorityRoutes } from './src/routes/healthcare-authority-routes';

const apiPort = parseInt(process.env.HEALTHCARE_AUTHORITY_API_PORT || '4006');
const agentPort = apiPort + 1;
const agentLabel = process.env.HEALTHCARE_AUTHORITY_AGENT_LABEL || 'Healthcare Authority';
const agentPublicEndpoint = process.env.HEALTHCARE_AUTHORITY_AGENT_PUBLIC_ENDPOINT || `http://localhost:${agentPort}`;
const agentDid = process.env.HEALTHCARE_AUTHORITY_DID || '';
const agentSeed = process.env.HEALTHCARE_AUTHORITY_SEED || '';

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

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

  // Healthcare-authority registers its own schema + credential definition for
  // the ProfessionalRoleCredential it issues to doctors — separate from
  // government's identity credential and hospital-authorization credential.
  // Attributes match the paper's Provider Credential (Section 6.1), plus
  // `role`, which the DWN reads from this credential's proof to bind a
  // grant's actorRole (dwn/patient-node/src/interfaces/role-verification.ts).
  // Falls back to a dummy credDef id on failure so routes still mount.
  let credentialDefinitionId = 'dummy-credential-definition-id-for-healthcare-authority';
  try {
    const schemaResult = await agent.createSchema(agentDid, {
      name: 'professional_role_credential',
      version: `1.0.${Math.floor(Math.random() * 100)}`,
      attrNames: ['role', 'licenseNumber', 'specialization', 'hospitalAffiliation', 'validityPeriod'],
      issuerId: agentDid,
    });
    if (schemaResult.schemaState.state !== 'finished') {
      throw new Error(`Schema registration did not finish: ${JSON.stringify(schemaResult.schemaState)}`);
    }
    const credDefResult = await agent.createCredentialDefinition(
      agentDid,
      schemaResult.schemaState.schemaId,
      'professional_role_credential'
    );
    if (credDefResult.credentialDefinitionState.state !== 'finished') {
      throw new Error(`Cred def registration did not finish: ${JSON.stringify(credDefResult.credentialDefinitionState)}`);
    }
    credentialDefinitionId = credDefResult.credentialDefinitionState.credentialDefinitionId;
    console.log(`Healthcare Authority schema + credential definition registered: ${credentialDefinitionId}`);
    console.log(
      `NOTE: to let doctor/DWN role-proof verification check against this credDef, copy this id into ` +
        `PROFESSIONAL_ROLE_CRED_DEF_ID in .env — each agent is a separate process with its own env, so this ` +
        `can't propagate automatically.`
    );
  } catch (error) {
    console.warn(`Healthcare Authority schema/credDef registration failed, routes will mount with a dummy id: ${(error as Error).message}`);
  }

  const commonConfig: AgentConfig = {
    agentType: '--healthcare-authority',
    agentLabel,
    agentPublicEndpoint,
    credentialDefinitionId,
  };

  registerHealthcareAuthorityRoutes(app, agent, agentDid, () => credentialDefinitionId);
  registerCommonRoutes(app, agent, commonConfig, proofCache);
  registerVerifierRoutes(app, agent, proofCache);
  registerDebugRoutes(app, agent, agentLabel, agentPublicEndpoint, apiPort, '--healthcare-authority', agentDid, credentialDefinitionId);

  console.log(`${agentLabel} routes mounted. Ready.`);
});
