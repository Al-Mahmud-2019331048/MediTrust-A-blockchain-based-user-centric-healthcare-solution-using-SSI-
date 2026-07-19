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
  // isVerified reflects the proof exchange record's REAL state (must be
  // "done" — see cache-utils.ts's isVerifiedState), not merely whether
  // getFormatData() returned a non-null object. getFormatData() returns the
  // request's format data as soon as a request is sent, before any
  // presentation exists — treating that as "verified" let an unanswered
  // proof request report isVerified:true. This endpoint backs
  // verifyActorRoleProof()'s trust decision for role-bound Permission
  // grants, so it must reflect real cryptographic verification.
  app.get("/proof-data/:proofRecordId", async (req: Request, res: Response) => {
    const { proofRecordId } = req.params;
    if (!proofRecordId) return res.status(400).send({ error: "proofRecordId is required" });

    try {
      const proofRecords = await agent.getProofRecords(proofRecordId);
      const proofRecord = proofRecords?.[0];
      if (!proofRecord) {
        return res.status(200).send({ isVerified: false });
      }

      const isVerified = proofCache.isVerifiedState(proofRecord.state);
      proofCache.update(proofRecordId, proofRecord.state, isVerified, proofRecord.connectionId);

      const result = await agent.getProofData(proofRecordId);
      res.status(200).send({ ...result, isVerified, state: proofRecord.state });
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
