import crypto from 'crypto';
import { DWNRecord } from './types';

export interface StoreRecordInput {
  patientDID: string;
  recordType: DWNRecord['recordType'];
  protocol: string;
  contentType: DWNRecord['contentType'];
  data: Record<string, unknown> | string;
  authorDID?: string;
  // Original filename for binary contentTypes (PDF/image) — the DWN's own
  // storeRecord route accepts this and stores it as DWNRecord.fileName;
  // omitted (null on the DWN side) for JSON records.
  fileName?: string;
}

// Thrown by both storeRecord() and queryRecords() for a non-2xx DWN
// response. Carries the real HTTP status (e.g. 403 for "no permission
// grant") so callers can distinguish "denied" from "unreachable" without
// parsing the message string.
export class DWNRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'DWNRequestError';
  }
}

// Thin HTTP client wrapping the DWN's POST /storeRecord contract
// (dwn/patient-node/src/routes/record-routes.ts). PATIENT_DWN_URL defaults to
// http://localhost:5050, matching the DWN's own established default port.
// Network/HTTP failures throw — callers decide how to handle a failed write
// (a doctor's already-issued credential can't be un-issued, so a DWN write
// failure shouldn't necessarily fail the whole request).
export async function storeRecord(input: StoreRecordInput): Promise<DWNRecord> {
  const baseUrl = (process.env.PATIENT_DWN_URL || 'http://localhost:5050').replace(/\/$/, '');
  const url = `${baseUrl}/dwn/storeRecord`;

  // Generated fresh per call, never exposed to storeRecord()'s own callers —
  // the DWN rejects a repeat of the same nonce as a replay (record-routes.ts).
  const nonce = crypto.randomUUID();

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, nonce }),
    });
  } catch (err) {
    throw new Error(`Failed to reach DWN at ${url}: ${(err as Error).message}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new DWNRequestError(response.status, `DWN storeRecord failed with status ${response.status}: ${body}`);
  }

  return (await response.json()) as DWNRecord;
}

export interface QueryRecordsInput {
  requesterDID: string;
  patientDID: string;
  recordType?: DWNRecord['recordType'];
}

// A record as returned by GET /dwn/queryRecord: the encrypted fields are
// replaced by a decrypted `data` (JSON object, or base64 for binary content),
// possibly field-redacted per the requester's Permission/Protocol grant.
export type ReadableDWNRecord = Omit<DWNRecord, 'encryptedData' | 'encryptedKey' | 'iv' | 'tag'> & {
  data: Record<string, unknown> | string;
  // Only present on self-reads — the DWN omits this entirely for non-self/
  // grant-based reads (e.g. every doctor-agent/pharmacy-agent queryRecords()
  // call, which always reads as a third party) since it would otherwise
  // leak the patient's full consent graph to whoever holds the grant.
  accessPolicy?: Record<string, boolean>;
};

// Thin HTTP client wrapping the DWN's GET /queryRecord contract — the read
// counterpart to storeRecord() above. Returns whatever the requester is
// authorized to see (full record for a self-read, field-redacted otherwise);
// a DWNRequestError with status 403 means the patient hasn't granted this
// requesterDID access yet, not a broken connection.
export async function queryRecords(input: QueryRecordsInput): Promise<ReadableDWNRecord[]> {
  const baseUrl = (process.env.PATIENT_DWN_URL || 'http://localhost:5050').replace(/\/$/, '');
  const params = new URLSearchParams({ requesterDID: input.requesterDID, patientDID: input.patientDID });
  if (input.recordType) params.set('recordType', input.recordType);
  const url = `${baseUrl}/dwn/queryRecord?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`Failed to reach DWN at ${url}: ${(err as Error).message}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new DWNRequestError(response.status, `DWN queryRecord failed with status ${response.status}: ${body}`);
  }

  return (await response.json()) as ReadableDWNRecord[];
}
