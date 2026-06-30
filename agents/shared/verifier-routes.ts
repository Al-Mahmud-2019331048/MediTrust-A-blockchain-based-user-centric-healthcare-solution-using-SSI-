import { Express, Request, Response } from "express";
import { BaseAgent } from "./agent-base";
import { ProofStatusCacheInstance } from "./cache-utils";

// Registers /proof-data/:id and /proof-status/:id — used by doctor and pharmacist agents
export function registerVerifierRoutes(
  app: Express,
  agent: BaseAgent,
  proofCache: ProofStatusCacheInstance
) {
  // GET /proof-data/:proofRecordId
  app.get("/proof-data/:proofRecordId", async (req: Request, res: Response) => {
    const { proofRecordId } = req.params;
    if (!proofRecordId) return res.status(400).send({ error: "proofRecordId is required" });

    try {
      const cached = proofCache.get(proofRecordId);
      if (cached?.isVerified) {
        const result = await agent.getProofData(proofRecordId);
        return res.status(200).send({ ...result, isVerified: true, state: cached.state });
      }

      const result = await agent.getProofData(proofRecordId);
      if (result) {
        proofCache.update(proofRecordId, "done", true);
        return res.status(200).send({ ...result, isVerified: true, state: "done" });
      }

      res.status(200).send({ isVerified: false });
    } catch (error) {
      const cached = proofCache.get(proofRecordId);
      if (cached) {
        return res.status(200).send({ isVerified: cached.isVerified, state: cached.state, fromCache: true });
      }
      res.status(500).send({ error: error.message });
    }
  });

  // GET /proof-status/:proofRecordId
  app.get("/proof-status/:proofRecordId", async (req: Request, res: Response) => {
    const { proofRecordId } = req.params;
    if (!proofRecordId) return res.status(400).send({ error: "proofRecordId is required" });

    try {
      const cached = proofCache.get(proofRecordId);
      if (cached) return res.status(200).send(cached);

      const proofRecords = await agent.getProofRecords(proofRecordId);
      if (proofRecords?.length > 0) {
        const proofRecord = proofRecords[0];
        const isVerified = proofCache.isVerifiedState(proofRecord.state);
        proofCache.update(proofRecordId, proofRecord.state, isVerified, proofRecord.connectionId);
        return res.status(200).send({ state: proofRecord.state, isVerified, timestamp: Date.now() });
      }

      res.status(404).send({ error: "Proof record not found" });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });
}
