import crypto from "crypto";
import { Express, NextFunction, Request, Response } from "express";

// Staff access code for provider agents (doctor, pharmacy) — added 2026-11-19.
//
// The DWN trusts these agents' request signatures, so before this anyone who
// could reach an agent's HTTP API could make it read patient records under
// its grants, write records with its signature, or fetch the attributes
// revealed in its proofs. Every API route of the agent now requires the staff
// access code from <envVarName> in the x-staff-token header; the portal asks
// staff for it once per browser tab (apps/web/src/components/StaffGate.tsx).
// An unset code fails closed (503), matching the other security settings.
//
// /agent-status stays public: it only reports the agent's public DID and
// status. DIDComm traffic from wallets uses the agent's separate DIDComm
// port and is not affected.
export const STAFF_TOKEN_HEADER = "x-staff-token";

const PUBLIC_PATHS = new Set(["/agent-status"]);

export function registerStaffAccess(app: Express, envVarName: string) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS" || PUBLIC_PATHS.has(req.path)) return next();

    const configured = process.env[envVarName];
    if (!configured) {
      return res.status(503).json({ error: `Staff access is not configured (${envVarName} is unset)` });
    }
    const provided = Buffer.from(req.header(STAFF_TOKEN_HEADER) ?? "", "utf8");
    const expected = Buffer.from(configured, "utf8");
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return res.status(401).json({ error: "Staff access code required" });
    }
    next();
  });

  // Lets the portal check a staff access code before showing the page; only
  // reachable with a valid code because the guard above runs first.
  app.get("/staff-check", (_req: Request, res: Response) => {
    res.status(204).end();
  });
}
