import { Express, Request, Response } from "express";
import { BaseAgent } from "./agent-base";

export function registerDebugRoutes(
  app: Express,
  agent: BaseAgent,
  agentLabel: string,
  agentPublicEndpoint: string,
  port: number,
  agentType: string,
  agentDid: string,
  credentialDefinitionId: string
) {
  app.get("/debug-agent", async (_req: Request, res: Response) => {
    try {
      const connections = await agent.getConnections({});
      res.status(200).send({
        agent: { label: agentLabel, publicEndpoint: agentPublicEndpoint, port, agentPort: port + 1, agentType },
        connections: connections.map((c) => ({
          id: c.id,
          state: c.state,
          theirLabel: c.theirLabel,
          createdAt: c.createdAt,
          outOfBandId: c.outOfBandId,
        })),
        environmentInfo: { nodeVersion: process.version, platform: process.platform, currentTime: new Date().toISOString() },
      });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  app.get("/agent-status", async (_req: Request, res: Response) => {
    try {
      const connections = await agent.getConnections({});
      res.status(200).send({
        agentType,
        agentLabel,
        agentDid,
        credentialDefinitionId,
        isInitialized: !!credentialDefinitionId && !credentialDefinitionId.startsWith("dummy-"),
        timestamp: new Date().toISOString(),
        connectionsCount: connections.length,
        activeConnections: connections.filter((c) => c.state === "completed").length,
      });
    } catch (error) {
      res.status(500).send({ error: error.message, agentType, timestamp: new Date().toISOString() });
    }
  });
}
