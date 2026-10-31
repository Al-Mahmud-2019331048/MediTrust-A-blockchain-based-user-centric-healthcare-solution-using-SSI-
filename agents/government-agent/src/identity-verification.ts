import crypto from "crypto";
import fs from "fs";
import path from "path";
import { generateId } from "../../../crypto/encryption/src/hash-utils";

// Identity verification before the government issues an identity credential
// (2026-10-30). Previously /issue-credential put whatever name/nationalId the
// caller typed into a real, ledger-backed credential, with no check at all.
//
// The check follows how identity is actually tied to a person in Bangladesh:
// every SIM is registered against an NID with the owner's fingerprint (BTRC),
// and one NID can have several SIMs. The patient names their NID and ONE of
// their registered SIMs; a one-time code is sent to that SIM; issuing
// requires that code back. Controlling a SIM registered to the NID is the
// proof. Credential attributes (name, age, nationalId) then come from the
// registry, never from the request, so a verified person can't put someone
// else's details on their credential either.
//
// The registry and the SMS delivery are both simulated (see
// registry/citizen-registry.json and the simulated inbox below) — there is
// no connection to the real Election Commission or mobile operators.

interface Citizen {
  nationalId: string;
  name: string;
  dateOfBirth: string;
  registeredSims: string[];
}

export interface VerifiedCitizen {
  nationalId: string;
  name: string;
  age: number;
}

type VerificationStatus = "pending" | "verified" | "issuing" | "used";

interface Verification {
  nationalId: string;
  connectionId: string;
  phoneNumber: string;
  codeHash: string;
  status: VerificationStatus;
  attempts: number;
  expiresAt: number;
}

export class VerificationError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
  }
}

const CODE_TTL_MS = 5 * 60 * 1000;
// Once verified, the patient has this long to press "Issue" — a verified
// request shouldn't stay usable forever (same reasoning as the MPOA
// approved-request expiry fix, 2026-07-25).
const VERIFIED_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_CODES_PER_PHONE = 5;
const MAX_CODES_PER_NID = 10;
const MAX_TRACKED_VERIFICATIONS = 10_000;
const MAX_INBOX_MESSAGES = 20;

const REGISTRY_PATH = path.resolve(__dirname, "registry/citizen-registry.json");
// NID -> patientAccountId, so the same person always gets the same account
// (re-verifying after losing a phone returns their existing account instead
// of minting a second one). Gitignored, like the other services' data dirs.
const ACCOUNT_MAP_PATH = process.env.GOVERNMENT_ACCOUNT_MAP_PATH ?? path.resolve(__dirname, "../data/account-map.json");

const citizens: Citizen[] = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")).citizens;
const verifications = new Map<string, Verification>();
const sendLog = new Map<string, number[]>();
const simulatedInbox = new Map<string, { message: string; sentAt: string }[]>();

// Accepts 01XXXXXXXXX, +8801XXXXXXXXX, 8801XXXXXXXXX, with spaces/dashes.
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("880") ? `0${digits.slice(3)}` : digits;
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}*****${phone.slice(-3)}`;
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function ageFromDateOfBirth(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  if (now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) age--;
  return age;
}

function isRateLimited(key: string, max: number): boolean {
  const now = Date.now();
  const recent = (sendLog.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  sendLog.set(key, recent);
  return recent.length >= max;
}

function recordSend(key: string) {
  sendLog.get(key)!.push(Date.now());
}

function evictStale() {
  const now = Date.now();
  for (const [id, v] of verifications) {
    if (v.expiresAt < now || v.status === "used") verifications.delete(id);
  }
  // Map iterates in insertion order, so this drops the oldest first.
  while (verifications.size > MAX_TRACKED_VERIFICATIONS) {
    verifications.delete(verifications.keys().next().value);
  }
}

export function startVerification(connectionId: string, nationalId: string, rawPhone: string) {
  const phoneNumber = normalizePhone(rawPhone);
  const phoneKey = `phone:${phoneNumber}`;
  const nidKey = `nid:${nationalId}`;
  if (isRateLimited(phoneKey, MAX_CODES_PER_PHONE) || isRateLimited(nidKey, MAX_CODES_PER_NID)) {
    throw new VerificationError("Too many code requests. Please wait a few minutes and try again.", 429);
  }

  // Same message whether the NID is unknown or the SIM isn't registered to
  // it, so this endpoint can't be used to learn which NID owns which number.
  const citizen = citizens.find((c) => c.nationalId === nationalId);
  if (!citizen || !citizen.registeredSims.includes(phoneNumber)) {
    recordSend(phoneKey);
    recordSend(nidKey);
    throw new VerificationError("This phone number is not registered to that National ID.", 400);
  }

  evictStale();
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const verificationId = generateId();
  verifications.set(verificationId, {
    nationalId,
    connectionId,
    phoneNumber,
    codeHash: hashCode(code),
    status: "pending",
    attempts: 0,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  recordSend(phoneKey);
  recordSend(nidKey);

  const inbox = simulatedInbox.get(phoneNumber) ?? [];
  inbox.unshift({
    message: `MediTrust Government ID: your verification code is ${code}. It expires in 5 minutes. Do not share it.`,
    sentAt: new Date().toISOString(),
  });
  simulatedInbox.set(phoneNumber, inbox.slice(0, MAX_INBOX_MESSAGES));

  return { verificationId, maskedPhone: maskPhone(phoneNumber), expiresInSeconds: CODE_TTL_MS / 1000 };
}

export function confirmVerification(verificationId: string, code: string): VerifiedCitizen {
  const v = verifications.get(verificationId);
  if (!v) throw new VerificationError("Verification request not found. Request a new code.", 404);
  if (v.status !== "pending") throw new VerificationError("This verification has already been completed.", 409);
  if (v.expiresAt < Date.now()) throw new VerificationError("This code has expired. Request a new code.", 410);
  if (v.attempts >= MAX_CODE_ATTEMPTS) throw new VerificationError("Too many wrong attempts. Request a new code.", 410);

  const matches = crypto.timingSafeEqual(Buffer.from(hashCode(String(code))), Buffer.from(v.codeHash));
  if (!matches) {
    v.attempts++;
    const remaining = MAX_CODE_ATTEMPTS - v.attempts;
    throw new VerificationError(
      remaining > 0 ? `Wrong code. ${remaining} attempt(s) left.` : "Too many wrong attempts. Request a new code.",
      remaining > 0 ? 400 : 410
    );
  }

  v.status = "verified";
  v.expiresAt = Date.now() + VERIFIED_TTL_MS;
  return toVerifiedCitizen(v.nationalId);
}

// Reserves a verified request for one issuance attempt. It must belong to the
// same wallet connection the credential is being issued to, so a code
// verified on one connection can't be spent issuing to another wallet.
export function claimVerification(verificationId: string, connectionId: string): VerifiedCitizen {
  const v = verificationId ? verifications.get(verificationId) : undefined;
  if (!v || v.status !== "verified" || v.expiresAt < Date.now()) {
    throw new VerificationError("Identity not verified. Complete phone verification before issuing.", 403);
  }
  if (v.connectionId !== connectionId) {
    throw new VerificationError("This verification belongs to a different wallet connection.", 403);
  }
  v.status = "issuing";
  return toVerifiedCitizen(v.nationalId);
}

export function completeVerification(verificationId: string) {
  const v = verifications.get(verificationId);
  if (v) v.status = "used";
}

// Issuance failed for a reason unrelated to identity (e.g. ledger/DIDComm
// trouble) — let the patient retry without re-verifying.
export function releaseVerification(verificationId: string) {
  const v = verifications.get(verificationId);
  if (v && v.status === "issuing") v.status = "verified";
}

function toVerifiedCitizen(nationalId: string): VerifiedCitizen {
  const citizen = citizens.find((c) => c.nationalId === nationalId)!;
  return { nationalId: citizen.nationalId, name: citizen.name, age: ageFromDateOfBirth(citizen.dateOfBirth) };
}

function readAccountMap(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(ACCOUNT_MAP_PATH, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export function getOrCreateAccountId(nationalId: string): string {
  const map = readAccountMap();
  if (map[nationalId]) return map[nationalId];
  map[nationalId] = generateId();
  fs.mkdirSync(path.dirname(ACCOUNT_MAP_PATH), { recursive: true });
  // Write-then-rename so a crash mid-write can't leave a truncated file
  // that loses every existing NID -> account mapping.
  const tmpPath = `${ACCOUNT_MAP_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(map, null, 2));
  fs.renameSync(tmpPath, ACCOUNT_MAP_PATH);
  return map[nationalId];
}

// SIMULATED SMS delivery. Stands in for the patient's own phone receiving
// the text — anyone who can call this can read any number's codes, which is
// only acceptable because no real SMS gateway exists in this PoC. A real
// deployment sends through the mobile operator and has no such endpoint.
export function readSimulatedInbox(rawPhone: string) {
  const phoneNumber = normalizePhone(rawPhone);
  return { phoneNumber, messages: simulatedInbox.get(phoneNumber) ?? [] };
}
