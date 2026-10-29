import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { BaseAgent } from '../shared/agent-base';
import { createProofStatusCache } from '../shared/cache-utils';
import { registerCommonRoutes, AgentConfig } from '../shared/common-routes';
import { registerVerifierRoutes } from '../shared/verifier-routes';
import { registerDebugRoutes } from '../shared/debug-routes';
import { registerDoctorRoutes } from './src/routes/medical-routes';

const apiPort = parseInt(process.env.DOCTOR_API_PORT || '4002');
const agentPort = apiPort + 1;
const agentLabel = process.env.DOCTOR_AGENT_LABEL || 'Doctor Office';
const agentPublicEndpoint = process.env.DOCTOR_AGENT_PUBLIC_ENDPOINT || `http://localhost:${agentPort}`;
const agentDid = process.env.DOCTOR_DID || '';
const agentSeed = process.env.DOCTOR_SEED || '';

const app = express();
app.use(cors());
// Default 100kb limit is too small for base64-encoded PDF/image attachments
// on /issue-medical-credential and /issue-prescription — matches the DWN's
// own server.ts limit.
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

  // Doctor registers its own schema + credential definition for medical
  // documents/prescriptions — separate from government's identity credential.
  // Attributes match the paper's Medical Document credential (Section 6.1);
  // patient name/ID stay in the DWN record only, not in the credential.
  // Falls back to a dummy credDef id on failure so routes still mount.
  let credentialDefinitionId = 'dummy-credential-definition-id-for-doctor';
  try {
    const schemaResult = await agent.createSchema(agentDid, {
      name: 'medical_document_credential',
      version: `1.0.${Math.floor(Math.random() * 100)}`,
      attrNames: ['documentId', 'documentType', 'documentHash', 'diagnosis', 'prescription', 'issuerDid', 'issuedAt'],
      issuerId: agentDid,
    });
    if (schemaResult.schemaState.state !== 'finished') {
      throw new Error(`Schema registration did not finish: ${JSON.stringify(schemaResult.schemaState)}`);
    }
    const credDefResult = await agent.createCredentialDefinition(
      agentDid,
      schemaResult.schemaState.schemaId,
      'medical_document_credential'
    );
    if (credDefResult.credentialDefinitionState.state !== 'finished') {
      throw new Error(`Cred def registration did not finish: ${JSON.stringify(credDefResult.credentialDefinitionState)}`);
    }
    credentialDefinitionId = credDefResult.credentialDefinitionState.credentialDefinitionId;
    console.log(`Doctor schema + credential definition registered: ${credentialDefinitionId}`);
    console.log(
      `NOTE: to let the pharmacy agent verify prescriptions against this credDef, copy this id into ` +
        `DOCTOR_MEDICAL_CRED_DEF_ID in .env and (re)start the pharmacy agent — each agent is a separate ` +
        `process with its own env, so this can't propagate automatically.`
    );
  } catch (error) {
    console.warn(`Doctor schema/credDef registration failed, routes will mount with a dummy id: ${(error as Error).message}`);
  }

  const commonConfig: AgentConfig = {
    agentType: '--doctor',
    agentLabel,
    agentPublicEndpoint,
    credentialDefinitionId,
  };

  registerDoctorRoutes(app, agent, agentDid, () => credentialDefinitionId);
  registerCommonRoutes(app, agent, commonConfig, proofCache);
  registerVerifierRoutes(app, agent, proofCache);
  registerDebugRoutes(app, agent, agentLabel, agentPublicEndpoint, apiPort, '--doctor', agentDid, credentialDefinitionId);

  console.log(`${agentLabel} routes mounted. Ready.`);
});
