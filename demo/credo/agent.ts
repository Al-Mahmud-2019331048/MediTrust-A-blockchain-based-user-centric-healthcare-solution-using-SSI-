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
import { AgentModules, baseAgentModule } from "./module";
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

      // Listen for connection state changes
      this.agent.events.on<ConnectionStateChangedEvent>(
        ConnectionEventTypes.ConnectionStateChanged,
        async (event) => {
          const connectionRecord = event.payload.connectionRecord;
          const previousState = event.payload.previousState;

          console.log(
            `Connection State Changed: ${previousState} -> ${connectionRecord.state} (ID: ${connectionRecord.id})`
          );

          // Log additional connection details for debugging
          console.log(`Connection Details:`);
          console.log(
            `- Their Label: ${connectionRecord.theirLabel || "Unknown"}`
          );
          console.log(
            `- Their DID: ${connectionRecord.theirDid || "Not established yet"}`
          );
          console.log(
            `- My DID: ${connectionRecord.did || "Not established yet"}`
          );
          console.log(`- Protocol: ${connectionRecord.protocol || "Unknown"}`);

          switch (connectionRecord.state) {
            case "invitation-received":
              console.log(
                "Received invitation, waiting for connection request..."
              );
              break;

            case "request-received":
              console.log("Connection request received...");
              // Try to auto-accept the request if it's stuck
              if (previousState === "request-received") {
                console.log(
                  "Connection appears to be stuck, attempting to process..."
                );
                try {
                  // Pass the connection ID directly as a string
                  await this.agent.connections.acceptRequest(
                    connectionRecord.id
                  );
                } catch (error) {
                  console.log(
                    `Error auto-accepting connection: ${error.message}`
                  );
                }
              }
              break;

            case "response-sent":
              console.log(
                "Connection response sent, waiting for completion..."
              );
              console.log(
                "If this state persists, check that the client can reach the agent's public endpoint."
              );
              console.log(`Public endpoint: ${this.endpoints[0]}`);
              break;

            case "completed":
              console.log(
                `Connection established successfully with ID: ${connectionRecord.id}`
              );
              break;

            case "abandoned":
              console.log(
                `Connection abandoned. Reason: ${
                  connectionRecord.errorMessage || "Unknown"
                }`
              );
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
          if (
            event.payload.basicMessageRecord.role === BasicMessageRole.Receiver
          ) {
            console.log(
              `Received message: ${event.payload.basicMessageRecord.content}`
            );
          }
        }
      );
      this.agent.events.on<CredentialStateChangedEvent>(
        CredentialEventTypes.CredentialStateChanged,
        async (event) => {
          console.log(
            `Credential Record State: ${event.payload.credentialRecord.state}`
          );
        }
      );

      this.agent.events.on<ConnectionStateChangedEvent>(
        ConnectionEventTypes.ConnectionStateChanged,
        async (event) => {
          console.log(
            `Connection Record State: ${event.payload.connectionRecord.state}`
          );
        }
      );
    } catch (e) {
      throw new Error(`Error initializing agent: ${e}`);
    }
  }
  public async getWalletDids(method?: string): Promise<DidRecord[]> {
    return this.agent.dids.getCreatedDids({
      method: method,
    });
  }
  public async importDid(did: string, seed: string) {
    // Check if we're in development mode
    const isDevMode = process.env.NODE_ENV === "development";

    if (!did) {
      const message = "DID is required";
      if (isDevMode) {
        console.warn(`⚠️ Warning: ${message} (continuing in development mode)`);
        return;
      }
      throw new Error(message);
    }

    if (!seed) {
      const message = "Seed is required";
      if (isDevMode) {
        console.warn(`⚠️ Warning: ${message} (continuing in development mode)`);
        return;
      }
      throw new Error(message);
    }

    try {
      // Try to import the DID with the seed as a string
      await this.agent.dids.import({
        did,
        overwrite: true,
        privateKeys: [
          {
            keyType: KeyType.Ed25519,
            privateKey: TypedArrayEncoder.fromString(seed),
          },
        ],
      });
      console.log(`Successfully imported DID: ${did}`);
    } catch (error) {
      const message = `Failed to import DID: ${error.message}`;
      console.error("Error importing DID:", error);

      if (isDevMode) {
        console.warn(`⚠️ Warning: ${message}`);
        console.warn("Continuing in development mode without DID import.");
        return;
      }

      throw new Error(message);
    }
  }

  /**
   * Create a new DID for the agent
   * This is useful when the predefined DID cannot be imported
   * @returns The newly created DID
   */
  public async createNewDid() {
    try {
      // Create a new DID of type key
      const didResult = await this.agent.dids.create({
        method: "key",
        options: {
          keyType: KeyType.Ed25519,
        },
      });

      if (didResult.didState.state !== "finished") {
        throw new Error(
          `Failed to create DID: ${JSON.stringify(didResult.didState)}`
        );
      }

      console.log(`Created new DID: ${didResult.didState.did}`);
      return didResult.didState.did;
    } catch (error) {
      console.error(`Error creating new DID: ${error.message}`);
      throw error;
    }
  }
  public async createInvitation(options: CreateInvitationOptions) {
    try {
      // Generate a unique ID for each invitation
      const uniqueId = this.generateRandomString(10);

      // Create the invitation with unique label and alias to help avoid conflicts
      const invitation = await this.agent.oob.createInvitation({
        label: options.label || `Invitation-${uniqueId}`,
        alias: options.alias || `alias-${uniqueId}`,
        multiUseInvitation: true, // Changed to true to allow multiple uses for testing
        autoAcceptConnection: true, // Auto-accept the connection when someone responds
        // Important: Use ConnectionsModule's connection protocol
        handshakeProtocols: [HandshakeProtocol.Connections],
      });

      // Log the effective endpoint being used
      console.log(`Agent endpoints: ${JSON.stringify(this.endpoints)}`);
      const domain = options.domain || this.endpoints[0];
      console.log(`Using domain for invitation: ${domain}`);

      // Generate invitation URL
      const invitationUrl = invitation.outOfBandInvitation.toUrl({
        domain: domain,
      });

      console.log(`Created invitation with ID: ${invitation.id}`);
      console.log(`Invitation URL: ${invitationUrl}`);
      return { invitationUrl, invitation };
    } catch (error) {
      console.error("Error creating invitation:", error.message);
      throw error;
    }
  }
  public async acceptInvitation(options: AcceptInvitationOptions) {
    try {
      console.log(`Accepting invitation from URL: ${options.invitationUrl}`);

      // Create a unique alias and label if not provided
      const uniqueId = this.generateRandomString(8);
      const alias = options.alias || `connection-${uniqueId}`;
      const label = options.label || `Connection-${uniqueId}`;

      // Receive the invitation with auto-accept enabled
      const record = await this.agent.oob.receiveInvitationFromUrl(
        options.invitationUrl,
        {
          autoAcceptConnection: true,
          autoAcceptInvitation: true,
          alias: alias,
          label: label,
          reuseConnection: false, // Force creation of a new connection
        }
      );

      console.log(
        `Successfully accepted invitation, connection record ID: ${
          record.connectionRecord?.id || "N/A"
        }`
      );
      return record;
    } catch (error) {
      console.error("Error accepting invitation:", error);
      throw error;
    }
  }
  public async getConnections(options: GetConnectionsOptions) {
    if (options.connectionId) {
      const record = await this.agent.connections.findById(
        options.connectionId
      );
      return record ? [record] : [];
    }
    if (options.outOfBandId) {
      return await this.agent.connections.findAllByOutOfBandId(
        options.outOfBandId
      );
    }
    return await this.agent.connections.getAll();
  }
  public async createSchema(did: string, schema: AnonCredsSchema) {
    return await this.agent.modules.anoncreds.registerSchema({
      schema,
      options: {
        endorserMode: "internal",
        endorserDid: did,
      },
    });
  }
  public async getSchema(schemaId?: string) {
    if (schemaId) {
      return await this.agent.modules.anoncreds.getCreatedSchemas({
        schemaId,
      });
    }
    return await this.agent.modules.anoncreds.getCreatedSchemas({});
  }
  public async createCredentialDefinition(
    did: string,
    schemaId: string,
    tag?: string
  ) {
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
    if (credentialDefinitionId) {
      return await this.agent.modules.anoncreds.getCreatedCredentialDefinitions(
        {
          credentialDefinitionId,
        }
      );
    }
    return await this.agent.modules.anoncreds.getCreatedCredentialDefinitions(
      {}
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
      comment: "Identity Credential",
      autoAcceptCredential: AutoAcceptCredential.Always,
      credentialFormats: {
        anoncreds: {
          credentialDefinitionId,
          attributes,
        },
      },
    });
  }

  /**
   * Offer a W3C Verifiable Credential to a connection
   * This is a simplified version that sends a formatted credential as a basic message
   * since the full W3C credential issuance requires additional setup
   */
  public async offerW3cCredential(connectionId: string, credential: any) {
    try {
      // Format the credential as a JSON string
      const formattedCredential = JSON.stringify(credential, null, 2);

      // Create a formatted message with the credential data
      const message =
        `W3C VERIFIABLE CREDENTIAL\n\n` +
        `Type: ${
          Array.isArray(credential.type)
            ? credential.type.join(", ")
            : credential.type
        }\n` +
        `Issuer: ${credential.issuer}\n` +
        `Issued: ${credential.issuanceDate}\n\n` +
        `Subject ID: ${credential.credentialSubject.id}\n` +
        `Document ID: ${credential.credentialSubject.documentId}\n` +
        `Document Type: ${credential.credentialSubject.documentType}\n` +
        `Document Hash: ${credential.credentialSubject.documentHash}\n` +
        `Issued By: ${credential.credentialSubject.issuedBy}\n` +
        `Issued At: ${credential.credentialSubject.issuedAt}\n\n` +
        `FULL CREDENTIAL DATA:\n${formattedCredential}\n\n` +
        `NOTE: This is a W3C Verifiable Credential sent as a basic message.\n` +
        `In a production environment, this would be a properly signed credential.`;

      // Send the credential as a basic message
      const messageRecord = await this.sendMessage(connectionId, message);
      console.log("W3C credential sent as basic message:", messageRecord.id);

      // Return the message record to mimic the credential record interface
      return messageRecord;
    } catch (error) {
      console.error("Error sending W3C credential as message:", error);
      throw error;
    }
  }

  /**
   * Send a basic message with credential information
   * This is a workaround for development environments where credential issuance might not work
   */
  public async sendCredentialAsMessage(
    connectionId: string,
    attributes: Record<string, string>
  ) {
    // Format the attributes as a readable message
    const attributesList = Object.entries(attributes)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");

    const message = `IDENTITY CREDENTIAL\n\n${attributesList}\n\nIssued by: ${
      this.label
    }\nDate: ${new Date().toISOString()}`;

    // Send the credential information as a basic message
    return await this.sendMessage(connectionId, message);
  }
  public async getIssuedCredenitalRecords(credentialExchangeRecordId?: string) {
    if (credentialExchangeRecordId) {
      return await this.agent.credentials.findAllByQuery({
        credentialIds: [credentialExchangeRecordId],
      });
    }
    return await this.agent.credentials.findAllByQuery({});
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
    if (proofRecordId) {
      return await this.agent.proofs.findAllByQuery({
        proofIds: [proofRecordId],
      });
    }
    return await this.agent.proofs.findAllByQuery({});
  }
  public async getProofData(proofRecordId: string) {
    return await this.agent.proofs.getFormatData(proofRecordId);
  }
  public async sendMessage(connectionId: string, message: string) {
    return await this.agent.basicMessages.sendMessage(connectionId, message);
  }

  // Register a callback for proof state changes
  public registerProofStateListener(callback: (proofRecord: any) => void) {
    this.agent.events.on(
      ProofEventTypes.ProofStateChanged,
      async (event: ProofStateChangedEvent) => {
        const proofRecord = event.payload.proofRecord;
        callback(proofRecord);
      }
    );
  }

  public async sendCredential(
    recipientDid: string,
    credentialDefinitionId: string,
    attributes: any[]
  ) {
    // Find connection with the recipient
    const connections = await this.agent.connections.getAll();
    const connection = connections.find(
      (conn) => conn.theirDid === recipientDid
    );

    if (!connection) {
      throw new Error(`No connection found for recipient DID: ${recipientDid}`);
    }

    // Send credential offer using the connection with AnonCreds format
    return await this.agent.credentials.offerCredential({
      connectionId: connection.id,
      protocolVersion: "v2",
      credentialFormats: {
        anoncreds: {
          credentialDefinitionId,
          attributes,
        },
      },
    });
  }

  // issueAnonCredsCredential method already exists in the class

  private generateRandomString(length: number) {
    const charset =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      result += charset[randomIndex];
    }
    return result;
  }
}
