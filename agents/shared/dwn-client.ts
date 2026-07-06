import { DWNRecord } from './types';

export interface StoreRecordInput {
  patientDID: string;
  recordType: DWNRecord['recordType'];
  protocol: string;
  contentType: DWNRecord['contentType'];
  data: Record<string, unknown> | string;
  authorDID?: string;
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

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (err) {
    throw new Error(`Failed to reach DWN at ${url}: ${(err as Error).message}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DWN storeRecord failed with status ${response.status}: ${body}`);
  }

  return (await response.json()) as DWNRecord;
}
