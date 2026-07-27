import { AnonCredsSchema } from "@credo-ts/anoncreds";
import {
  Agent,
  AutoAcceptCredential,
  BasicMessageEventTypes,
  BasicMessageRole,
  BasicMessageStateChangedEvent,
  ConnectionEventTypes,
  ConnectionStateChangedEvent,
  CredentialEventTypes,
  CredentialStateChangedEvent,
  DidRecord,
  HandshakeProtocol,
  HttpOutboundTransport,
  InitConfig,
  KeyType,
  ProofEventTypes,
  ProofStateChangedEvent,
  TypedArrayEncoder,
  WsOutboundTransport,
} from "@credo-ts/core";
import { agentDependencies, HttpInboundTransport } from "@credo-ts/node";
import { IndyVdrPoolService } from "@credo-ts/indy-vdr";
// Deep import, not from the package's public index — this is a real,
// genuinely exported function (@credo-ts/indy-vdr/build/utils/sign.js), just
// not re-exported from the package root. Deliberately used INSTEAD OF
// casting IndyVdrApi's own (`private` in its .d.ts, but same underlying
// logic) signRequest method to `any` — this repo's Code Quality Rules treat
// suppressors as a last resort, and a real typed function was available
// here, so no suppressor was actually needed.
import { signRequest } from "@credo-ts/indy-vdr/build/utils/sign";
import { AttribRequest } from "@hyperledger/indy-vdr-shared";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { AgentModules, baseAgentModule } from "./module/module-config";
import {
  AcceptInvitationOptions,
  AttributeElement,
  CreateInvitationOptions,
  GetConnectionsOptions,
  SendProofRequest,
} from "./types";

export class BaseAgent {
  public port: number;
  public label: string;
  protected readonly config: InitConfig;
  protected endpoints: string[];
  protected agent: AgentModules;
  protected isInitialized: boolean = false;

  public constructor({
    port,
    label,
    publicEndpoint,
  }: {
    port: number;
    label: string;
    publicEndpoint: string;
  }) {
    this.port = port;
    this.label = label;
    this.endpoints = [publicEndpoint];

    this.config = {
      label: label,
      endpoints: this.endpoints,
      walletConfig: {
        key: crypto.randomBytes(32).toString("hex"),
        id: `wallet-${this.label}-${crypto.randomUUID()}`,
      },
    } satisfies InitConfig;

    this.agent = new Agent({
      config: this.config,
      dependencies: agentDependencies,
      modules: baseAgentModule(),
    });

    this.agent.registerInboundTransport(new HttpInboundTransport({ port }));
    this.agent.registerOutboundTransport(new HttpOutboundTransport());
    this.agent.registerOutboundTransport(new WsOutboundTransport());
  }

  public async init() {
    try {
      await this.agent.initialize();
      this.isInitialized = true;

      this.agent.events.on<ConnectionStateChangedEvent>(
        ConnectionEventTypes.ConnectionStateChanged,
        async (event) => {
          const connectionRecord = event.payload.connectionRecord;
          const previousState = event.payload.previousState;

          console.log(
            `Connection State Changed: ${previousState} -> ${connectionRecord.state} (ID: ${connectionRecord.id})`
          );
          console.log(`- Their Label: ${connectionRecord.theirLabel || "Unknown"}`);
          console.log(`- Their DID: ${connectionRecord.theirDid || "Not established yet"}`);
          console.log(`- My DID: ${connectionRecord.did || "Not established yet"}`);
          console.log(`- Protocol: ${connectionRecord.protocol || "Unknown"}`);

          switch (connectionRecord.state) {
            case "request-received":
              if (previousState === "request-received") {
                try {
                  await this.agent.connections.acceptRequest(connectionRecord.id);
                } catch (error) {
                  console.log(`Error auto-accepting connection: ${error.message}`);
                }
              }
              break;
            case "response-sent":
              console.log(`Public endpoint: ${this.endpoints[0]}`);
              break;
            case "completed":
              console.log(`Connection established: ${connectionRecord.id}`);
              break;
            case "abandoned":
              console.log(`Connection abandoned: ${connectionRecord.errorMessage || "Unknown"}`);
              break;
          }
        }
      );

      this.agent.events.on<ProofStateChangedEvent>(
        ProofEventTypes.ProofStateChanged,
        async (event) => {
          console.log(`Proof Record State: ${event.payload.proofRecord.state}`);
        }
      );

      this.agent.events.on(
        BasicMessageEventTypes.BasicMessageStateChanged,
        async (event: BasicMessageStateChangedEvent) => {
          if (event.payload.basicMessageRecord.role === BasicMessageRole.Receiver) {
            console.log(`Received message: ${event.payload.basicMessageRecord.content}`);
          }
        }
      );

      this.agent.events.on<CredentialStateChangedEvent>(
        CredentialEventTypes.CredentialStateChanged,
        async (event) => {
          console.log(`Credential Record State: ${event.payload.credentialRecord.state}`);
        }
      );
    } catch (e) {
      throw new Error(`Error initializing agent: ${e}`);
    }
  }

  // Not called by any of the 4 real, long-lived agents (they're meant to
  // stay up) — for short-lived throwaway agents (benchmark/e2e's
  // createTestPatientAgent) that previously had no way to clean up after
  // themselves. Each agent gets a permanently-unique walletConfig.id
  // (line ~69), and Askar persists every wallet to disk under
  // ~/.afj/data/wallet/<id>/ regardless — with no cleanup, every
  // benchmark/e2e run left new wallet files behind forever (confirmed live
  // 2026-07-25: 73 accumulated test-patient wallets, 146MB). Gracefully
  // shuts down the underlying Credo-TS agent first, then deletes its own
  // wallet directory — never anyone else's, since the path is derived from
  // this instance's own walletConfig.id, not a glob.
  public async shutdown(): Promise<void> {
    try {
      await this.agent.shutdown();
    } catch (e) {
      console.warn(`shutdown: agent.shutdown() failed (continuing to wallet cleanup anyway): ${(e as Error).message}`);
    }
    const walletId = this.config.walletConfig?.id;
    if (!walletId) return;
    const walletDir = path.join(os.homedir(), ".afj", "data", "wallet", walletId);
    try {
      await fs.promises.rm(walletDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`shutdown: failed to remove wallet directory ${walletDir}: ${(e as Error).message}`);
    }
  }

  public async getWalletDids(method?: string): Promise<DidRecord[]> {
    return this.agent.dids.getCreatedDids({ method });
  }

  public async importDid(did: string, seed: string) {
    const isDevMode = process.env.NODE_ENV === "development";

    if (!did) {
      const message = "DID is required";
      if (isDevMode) { console.warn(`⚠️ Warning: ${message}`); return; }
      throw new Error(message);
    }
    if (!seed) {
      const message = "Seed is required";
      if (isDevMode) { console.warn(`⚠️ Warning: ${message}`); return; }
      throw new Error(message);
    }

    try {
      await this.agent.dids.import({
        did,
        overwrite: true,
        privateKeys: [{
          keyType: KeyType.Ed25519,
          privateKey: TypedArrayEncoder.fromString(seed),
        }],
      });
      console.log(`Successfully imported DID: ${did}`);
    } catch (error) {
      const message = `Failed to import DID: ${error.message}`;
      if (isDevMode) { console.warn(`⚠️ Warning: ${message}`); return; }
      throw new Error(message);
    }
  }

  public async createNewDid() {
    const didResult = await this.agent.dids.create({
      method: "key",
      options: { keyType: KeyType.Ed25519 },
    });

    if (didResult.didState.state !== "finished") {
      throw new Error(`Failed to create DID: ${JSON.stringify(didResult.didState)}`);
    }

    console.log(`Created new DID: ${didResult.didState.did}`);
    return didResult.didState.did;
  }

  public async createInvitation(options: CreateInvitationOptions) {
    const uniqueId = this.generateRandomString(10);
    const invitation = await this.agent.oob.createInvitation({
      label: options.label || `Invitation-${uniqueId}`,
      alias: options.alias || `alias-${uniqueId}`,
      multiUseInvitation: true,
      autoAcceptConnection: true,
      // Connections-only, deliberately (2026-07-27) — matches the real
      // device wallet's DIDDoc format. DidExchange was tried the same day
      // to work around a freshly-built Bifold's DIDDoc @context
      // incompatibility, but it made the genesis-patched original wallet
      // also prefer DidExchange, which hits a separate bug in this
      // Credo-TS version's DID-rotation "complete" message handling
      // (CredoError: "Connection is missing in message context", confirmed
      // live — the connection got stuck at response-sent forever). See
      // CLAUDE.md's "Bifold Wallet Genesis Fix" section for the full story;
      // re-add DidExchange only if testing against a current-upstream
      // Bifold build again, and expect that bug in exchange.
      handshakeProtocols: [HandshakeProtocol.Connections],
    });

    const domain = options.domain || this.endpoints[0];
    const invitationUrl = invitation.outOfBandInvitation.toUrl({ domain });
    console.log(`Created invitation: ${invitation.id}`);
    return { invitationUrl, invitation };
  }

  public async acceptInvitation(options: AcceptInvitationOptions) {
    const uniqueId = this.generateRandomString(8);
    const record = await this.agent.oob.receiveInvitationFromUrl(
      options.invitationUrl,
      {
        autoAcceptConnection: true,
        autoAcceptInvitation: true,
        alias: options.alias || `connection-${uniqueId}`,
        label: options.label || `Connection-${uniqueId}`,
        reuseConnection: false,
      }
    );
    return record;
  }

  public async getConnections(options: GetConnectionsOptions) {
    if (options.connectionId) {
      const record = await this.agent.connections.findById(options.connectionId);
      return record ? [record] : [];
    }
    if (options.outOfBandId) {
      return await this.agent.connections.findAllByOutOfBandId(options.outOfBandId);
    }
    return await this.agent.connections.getAll();
  }

  public async createSchema(did: string, schema: AnonCredsSchema) {
    return await this.agent.modules.anoncreds.registerSchema({
      schema,
      options: { endorserMode: "internal", endorserDid: did },
    });
  }

  public async getSchema(schemaId?: string) {
    return await this.agent.modules.anoncreds.getCreatedSchemas(
      schemaId ? { schemaId } : {}
    );
  }

  public async createCredentialDefinition(did: string, schemaId: string, tag?: string) {
    return await this.agent.modules.anoncreds.registerCredentialDefinition({
      credentialDefinition: {
        schemaId,
        issuerId: did,
        tag: tag || "latest",
      },
      options: {
        endorserMode: "internal",
        endorserDid: did,
        supportRevocation: false,
      },
    });
  }

  // Anchors a hash on the Indy ledger via a raw AttribRequest (self-attrib:
  // targetDid === submitterDid) — used for on-chain audit-event anchoring.
  // Never throws; the ledger validator pool is confirmed blocked on this
  // dev network (same block affecting schema/credDef registration), so a
  // real attempt here is expected to genuinely try, time out for that real
  // reason, and report success:false — not a fabricated result. did must be
  // this agent's own qualified DID (did:indy:bcovrin:test:...) — needed to
  // resolve its verification key; the AttribRequest's own submitterDid/
  // targetDid fields use the bare unqualified id, matching the raw ledger's
  // convention (see getPublicDid/getEndpointsForDid in this same package).
  public async anchorHash(did: string, hash: string): Promise<{ success: boolean; ledgerTxnSeqNo?: number; error?: string }> {
    try {
      const unqualifiedDid = did.split(':').pop() ?? did;
      const request = new AttribRequest({ submitterDid: unqualifiedDid, targetDid: unqualifiedDid, hash });

      const poolService = this.agent.dependencyManager.resolve(IndyVdrPoolService);
      const { pool } = await poolService.getPoolForDid(this.agent.context, did);
      const signedRequest = await signRequest(this.agent.context, pool, request, did);
      const response = await pool.submitRequest(signedRequest);

      return { success: true, ledgerTxnSeqNo: response.result.txnMetadata.seqNo };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  public async getCredentialDefinition(credentialDefinitionId?: string) {
    return await this.agent.modules.anoncreds.getCreatedCredentialDefinitions(
      credentialDefinitionId ? { credentialDefinitionId } : {}
    );
  }

  public async issueAnonCredsCredential(
    connectionId: string,
    credentialDefinitionId: string,
    attributes: AttributeElement[]
  ) {
    return await this.agent.credentials.offerCredential({
      connectionId,
      protocolVersion: "v2",
      comment: "Credential Offer",
      autoAcceptCredential: AutoAcceptCredential.Always,
      credentialFormats: {
        anoncreds: { credentialDefinitionId, attributes },
      },
    });
  }

  // `credentialIds` is not a real Credo-TS query key (CredentialsApi has no
  // such filterable field) — findAllByQuery({ credentialIds: [...] }) always
  // silently matched zero records rather than erroring. CredentialsApi.getById()
  // is the actual way to look up one record; this always returned an array
  // to keep existing callers (which do `records?.[0]`) working unchanged.
  public async getIssuedCredentialRecords(credentialExchangeRecordId?: string) {
    if (!credentialExchangeRecordId) {
      return await this.agent.credentials.findAllByQuery({});
    }
    try {
      const record = await this.agent.credentials.getById(credentialExchangeRecordId);
      return [record];
    } catch {
      return [];
    }
  }

  public async sendProofRequest({
    proofRequestlabel,
    connectionId,
    version,
    attributes,
    predicates,
  }: SendProofRequest) {
    return await this.agent.proofs.requestProof({
      connectionId,
      protocolVersion: "v2",
      proofFormats: {
        anoncreds: {
          name: proofRequestlabel,
          version: version || "1.0.0",
          requested_attributes: attributes,
          requested_predicates: predicates,
        },
      },
    });
  }

  // Same bug as getIssuedCredentialRecords above: `proofIds` is not a real
  // Credo-TS query key, so findAllByQuery({ proofIds: [...] }) always
  // silently matched zero records — meaning /proof-data has always returned
  // { isVerified: false } for every agent that mounts it (doctor, pharmacy),
  // never the real presentation payload, since it hit getProofRecords()'s
  // "no record found" early-return before ever reaching getProofData().
  // ProofsApi.getById() is the real lookup method.
  public async getProofRecords(proofRecordId?: string) {
    if (!proofRecordId) {
      return await this.agent.proofs.findAllByQuery({});
    }
    try {
      const record = await this.agent.proofs.getById(proofRecordId);
      return [record];
    } catch {
      return [];
    }
  }

  public async getProofData(proofRecordId: string) {
    return await this.agent.proofs.getFormatData(proofRecordId);
  }

  // Holder-side auto-respond to a received proof REQUEST. Not called by any
  // existing agent today — Credo-TS's AutoAcceptProof.ContentApproved (this
  // project's configured mode, see module-config.ts) only auto-accepts a
  // request that matches a proposal the holder previously sent
  // (V2ProofProtocol.shouldAutoRespondToRequest returns false when there's
  // no such proposal), which never applies to this project's bare
  // verifier-initiated requests. A real human wallet (Bifold) works around
  // this with a manual "Accept" tap; an automated holder (e.g. the
  // benchmark/e2e test-patient agent) needs this explicit equivalent.
  public async acceptProofRequest(proofRecordId: string) {
    const requestedCredentials = await this.agent.proofs.selectCredentialsForRequest({ proofRecordId });
    return await this.agent.proofs.acceptRequest({
      proofRecordId,
      proofFormats: requestedCredentials.proofFormats,
    });
  }

  public async sendMessage(connectionId: string, message: string) {
    return await this.agent.basicMessages.sendMessage(connectionId, message);
  }

  public registerProofStateListener(callback: (proofRecord: any) => void) {
    this.agent.events.on(
      ProofEventTypes.ProofStateChanged,
      async (event: ProofStateChangedEvent) => {
        callback(event.payload.proofRecord);
      }
    );
  }

  private generateRandomString(length: number) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += charset[Math.floor(Math.random() * charset.length)];
    }
    return result;
  }
}
