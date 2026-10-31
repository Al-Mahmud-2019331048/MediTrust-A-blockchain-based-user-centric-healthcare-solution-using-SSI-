import { Express, Request, Response } from "express";
import {
  startVerification,
  confirmVerification,
  readSimulatedInbox,
  VerificationError,
} from "../identity-verification";

// Phone-based identity verification that must succeed before
// /issue-credential will issue — see identity-verification.ts.
export function registerVerificationRoutes(app: Express) {
  // POST /identity-verification/start — checks the phone is a SIM registered
  // to the NID, then sends a one-time code to it.
  app.post("/identity-verification/start", (req: Request, res: Response) => {
    const { connectionId, nationalId, phoneNumber } = req.body;
    if (typeof connectionId !== "string" || !connectionId) return res.status(400).send({ error: "connectionId is required" });
    if (typeof nationalId !== "string" || !nationalId.trim()) return res.status(400).send({ error: "nationalId is required" });
    if (typeof phoneNumber !== "string" || !phoneNumber.trim()) return res.status(400).send({ error: "phoneNumber is required" });

    try {
      res.status(200).send(startVerification(connectionId, nationalId.trim(), phoneNumber));
    } catch (error) {
      if (error instanceof VerificationError) return res.status(error.httpStatus).send({ error: error.message });
      res.status(500).send({ error: (error as Error).message });
    }
  });

  // POST /identity-verification/confirm — checks the code; on success returns
  // the registry's details for this person so the portal can show who is
  // about to be issued a credential.
  app.post("/identity-verification/confirm", (req: Request, res: Response) => {
    const { verificationId, code } = req.body;
    if (typeof verificationId !== "string" || !verificationId) return res.status(400).send({ error: "verificationId is required" });
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) return res.status(400).send({ error: "code must be 6 digits" });

    try {
      res.status(200).send({ verified: true, citizen: confirmVerification(verificationId, code) });
    } catch (error) {
      if (error instanceof VerificationError) return res.status(error.httpStatus).send({ error: error.message });
      res.status(500).send({ error: (error as Error).message });
    }
  });

  // GET /simulated-sms/:phoneNumber — SIMULATED only, stands in for the
  // patient's phone. See readSimulatedInbox for why this exists.
  app.get("/simulated-sms/:phoneNumber", (req: Request, res: Response) => {
    res.status(200).send(readSimulatedInbox(req.params.phoneNumber));
  });
}
