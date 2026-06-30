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
import crypto from "crypto";
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

  public async getIssuedCredentialRecords(credentialExchangeRecordId?: string) {
    return await this.agent.credentials.findAllByQuery(
      credentialExchangeRecordId
        ? { credentialIds: [credentialExchangeRecordId] }
        : {}
    );
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

  public async getProofRecords(proofRecordId?: string) {
    return await this.agent.proofs.findAllByQuery(
      proofRecordId ? { proofIds: [proofRecordId] } : {}
    );
  }

  public async getProofData(proofRecordId: string) {
    return await this.agent.proofs.getFormatData(proofRecordId);
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
