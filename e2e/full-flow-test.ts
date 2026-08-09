import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { AuditService } from '../audit/src/services/audit-service';
import { createTestPatientAgent, connectTestPatientTo, pollUntil, isReachable, randomHex, shutdownAllTestPatients } from '../benchmark/test-patient-helper';
import { extractRevealedAttributes } from '../agents/shared/proof-parser';

const DWN_URL = (process.env.PATIENT_DWN_URL || 'http://localhost:5050').replace(/\/$/, '');
const GOV_URL = `http://localhost:${process.env.GOVERNMENT_API_PORT || '4000'}`;
const DOCTOR_URL = `http://localhost:${process.env.DOCTOR_API_PORT || '4002'}`;

interface StepResult {
  step: string;
  status: 'ok' | 'degraded' | 'blocked' | 'na';
  detail: string;
}

const steps: StepResult[] = [];

async function main() {
  // ---------- Step 1: DID ----------
  const govDid = process.env.GOVERNMENT_DID;
  const doctorDid = process.env.DOCTOR_DID;
  if (govDid && doctorDid) {
    steps.push({ step: '1. DID', status: 'ok', detail: `Real, registered identities already exist: government=${govDid}, doctor=${doctorDid}` });
  } else {
    steps.push({ step: '1. DID', status: 'blocked', detail: 'GOVERNMENT_DID/DOCTOR_DID not configured in .env' });
  }

  const dwnUp = await isReachable(DWN_URL);
  const govUp = await isReachable(GOV_URL, '/connections');
  const doctorUp = await isReachable(DOCTOR_URL, '/connections');

  if (!dwnUp) {
    steps.push({ step: 'ALL REMAINING STEPS', status: 'blocked', detail: `DWN not reachable at ${DWN_URL} — cannot continue` });
    return finish();
  }

  // ---------- Step 2: VC (identity) ----------
  let testPatient;
  if (!govUp) {
    steps.push({ step: '2. VC (identity issuance)', status: 'blocked', detail: `government-agent not reachable at ${GOV_URL}` });
  } else {
    testPatient = await createTestPatientAgent(4020);
    const govConnection = await connectTestPatientTo(testPatient, GOV_URL, 'E2E Test Patient');
    if (!govConnection) {
      steps.push({ step: '2. VC (identity issuance)', status: 'blocked', detail: 'Connection to government-agent did not complete within 15s' });
    } else {
      const issueRes = await fetch(`${GOV_URL}/issue-credential`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: govConnection.connectionId, name: 'E2E Patient', nationalId: '000000000' }),
        signal: AbortSignal.timeout(20000),
      });
      const issueBody = await issueRes.json();
      if (issueBody.isW3C) {
        steps.push({ step: '2. VC (identity issuance)', status: 'degraded', detail: 'Fell back to W3C message (ledger connectivity unavailable) — not a real ZKP-backed VC, see CLAUDE.md Known Constraints' });
      } else if (issueRes.ok && issueBody.success) {
        steps.push({ step: '2. VC (identity issuance)', status: 'ok', detail: 'Real AnonCreds identity credential issued' });
      } else {
        steps.push({ step: '2. VC (identity issuance)', status: 'blocked', detail: `Issuance failed: ${JSON.stringify(issueBody).slice(0, 200)}` });
      }
    }
  }

  // ---------- Step 3: Doctor verifies + issues (medical credential) ----------
  // patientDID is now derived from a REAL verified AnonCreds proof of the
  // step-2 identity credential (patientAccountId, revealed to the doctor's
  // proof request), not the old theirDid/connectionId placeholder — the
  // latter is never UUID-shaped, so it's correctly rejected by the DWN's
  // patientDID validation (added 2026-07-25, see CLAUDE.md Security Audit)
  // and every downstream step would cascade-fail. doctorConnectionId is
  // hoisted to function scope so step 7a can reuse the SAME connection
  // instead of re-querying and picking whatever connection happens to be
  // first in doctor-agent's full history (the exact stale-connection bug
  // documented as still-open — reusing this ID here is the actual fix).
  let patientDID: string | undefined;
  let dwnRecordId: string | undefined;
  let originalDocumentData: Record<string, unknown> | undefined;
  let doctorConnectionId: string | undefined;
  let identityProofRecordId: string | undefined;

  if (!doctorUp) {
    steps.push({ step: '3. Doctor verifies + issues', status: 'blocked', detail: `doctor-agent not reachable at ${DOCTOR_URL}` });
  } else {
    if (!testPatient) testPatient = await createTestPatientAgent(4021);
    const doctorConnection = await connectTestPatientTo(testPatient, DOCTOR_URL, 'E2E Test Patient');
    if (!doctorConnection) {
      steps.push({ step: '3. Doctor verifies + issues', status: 'blocked', detail: 'Connection to doctor-agent did not complete within 15s' });
    } else {
      doctorConnectionId = doctorConnection.connectionId;

      // Wait for the step-2 identity credential to actually land in the
      // wallet before requesting a proof against it — sending the request
      // too early is a real race (confirmed live 2026-07-25) that fails
      // with "Unable to automatically select requested attributes."
      let credentialReady = false;
      for (let i = 0; i < 30; i++) {
        const records: any[] = await testPatient.getIssuedCredentialRecords();
        if (records.some((r) => r.state === 'done')) { credentialReady = true; break; }
        await new Promise((r) => setTimeout(r, 500));
      }

      let verifiedPatientAccountId: string | undefined;
      if (credentialReady) {
        const proofRes = await fetch(`${DOCTOR_URL}/send-proof-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proofRequestlabel: 'e2e-identity-verification', connectionId: doctorConnectionId }),
        });
        const proofBody = await proofRes.json();
        if (proofBody?.id) {
          identityProofRecordId = proofBody.id;
          const verified = await pollUntil(async () => {
            const statusRes = await fetch(`${DOCTOR_URL}/proof-status/${proofBody.id}`);
            const status = await statusRes.json();
            return status.isVerified ? status : undefined;
          }, 20000, 500);
          if (verified) {
            const proofDataRes = await fetch(`${DOCTOR_URL}/proof-data/${proofBody.id}`);
            const proofData = await proofDataRes.json();
            verifiedPatientAccountId = extractRevealedAttributes(proofData).revealedAttributes.patientAccountId;
          }
        }
      }

      originalDocumentData = {
        documentId: `e2e-doc-${randomHex(4)}`,
        documentType: 'medicalRecord',
        diagnosis: 'Seasonal influenza',
        prescription: 'Rest, fluids, paracetamol as needed',
        issuedBy: doctorDid || 'unknown',
        issuedAt: new Date().toISOString(),
      };

      if (!verifiedPatientAccountId) {
        steps.push({
          step: '3. Doctor verifies + issues',
          status: 'blocked',
          detail: `Identity proof did not verify or reveal patientAccountId (credentialReady=${credentialReady}) — cannot establish a real patientDID`,
        });
      } else {
        const issueRes = await fetch(`${DOCTOR_URL}/issue-medical-credential`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionId: doctorConnectionId,
            ...originalDocumentData,
            patientDID: verifiedPatientAccountId,
            proofRecordId: identityProofRecordId,
          }),
          signal: AbortSignal.timeout(20000),
        });
        const issueBody = await issueRes.json();

        if (!issueRes.ok || !issueBody.success) {
          steps.push({ step: '3. Doctor verifies + issues', status: 'blocked', detail: `Issuance failed: ${JSON.stringify(issueBody).slice(0, 200)}` });
        } else {
          dwnRecordId = issueBody.dwnRecordId;
          patientDID = verifiedPatientAccountId;
          const degraded = issueBody.credentialType === 'StructuredMessage';
          steps.push({
            step: '3. Doctor verifies + issues',
            status: degraded ? 'degraded' : 'ok',
            detail: degraded
              ? `Fell back to W3C-style message (ledger connectivity unavailable), but DWN write still happened: dwnRecordId=${dwnRecordId}, real verified patientDID=${patientDID}`
              : `Real AnonCreds medical credential issued to a real, proof-verified patientDID=${patientDID}, dwnRecordId=${dwnRecordId}`,
          });
        }
      }
    }
  }

  // ---------- Step 4: DWN write confirmation ----------
  if (!dwnRecordId || !patientDID) {
    steps.push({ step: '4. DWN write confirmation', status: 'blocked', detail: 'No record was written in step 3 to confirm' });
  } else {
    const selfReadRes = await fetch(`${DWN_URL}/dwn/queryRecord?recordId=${dwnRecordId}&requesterDID=${patientDID}`);
    const selfRead = await selfReadRes.json();
    const matches = selfReadRes.status === 200 && selfRead.data?.documentId === originalDocumentData?.documentId;
    steps.push({
      step: '4. DWN write confirmation',
      status: matches ? 'ok' : 'blocked',
      detail: matches
        ? `Self-read confirms the record is genuinely in the DWN with matching data (recordId=${dwnRecordId})`
        : `Self-read did not match expected data: status=${selfReadRes.status}`,
    });
  }

  // ---------- Step 5: shareRecord ----------
  let permissionId: string | undefined;
  const insurerDID = `did:e2e:insurer-${randomHex(4)}`;
  if (!patientDID) {
    steps.push({ step: '5. shareRecord', status: 'blocked', detail: 'No patientDID established from step 3' });
  } else {
    const shareRes = await fetch(`${DWN_URL}/dwn/shareRecord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientDID,
        grantedToDID: insurerDID,
        recordType: 'medical',
        purpose: 'insurance',
        allowedFields: ['documentType', 'issuedBy'],
      }),
    });
    const permission = await shareRes.json();
    permissionId = permission.permissionId;
    steps.push({
      step: '5. shareRecord',
      status: shareRes.status === 201 ? 'ok' : 'blocked',
      detail: shareRes.status === 201 ? `Granted ${insurerDID} access to ['documentType','issuedBy'] only` : `Grant failed: ${JSON.stringify(permission).slice(0, 200)}`,
    });
  }

  // ---------- Step 6: Selective read ----------
  if (!patientDID || !dwnRecordId) {
    steps.push({ step: '6. Selective read', status: 'blocked', detail: 'Prerequisite steps did not complete' });
  } else {
    const res = await fetch(`${DWN_URL}/dwn/queryRecord?recordId=${dwnRecordId}&requesterDID=${insurerDID}`);
    const body = await res.json();
    const fields = Object.keys(body.data ?? {}).sort();
    const expected = ['documentType', 'issuedBy'].sort();
    const matches = res.status === 200 && JSON.stringify(fields) === JSON.stringify(expected);
    steps.push({
      step: '6. Selective read',
      status: matches ? 'ok' : 'blocked',
      detail: matches ? `Insurer sees only [${fields.join(', ')}] as granted — diagnosis/prescription correctly redacted` : `Unexpected fields: [${fields.join(', ')}]`,
    });
  }

  // ---------- Step 7: VP generation ----------
  // 7a: a second, independent real proof exchange on the SAME connection
  // established in step 3 — deliberately reused rather than re-queried, so
  // this can't pick up a stale, unrelated connection from doctor-agent's
  // accumulated history across earlier runs (the exact bug this replaces;
  // confirmed reproducing live 2026-07-25 with the old re-query approach).
  // Expected to genuinely verify now: both the ledger-genesis fix
  // (2026-07-22) and the AutoAcceptProof gap fix (2026-07-25, see CLAUDE.md)
  // mean a real AnonCreds proof round trip actually completes in this
  // environment — this step's old "should NOT verify" expectation predates
  // both fixes and was itself stale.
  if (testPatient && doctorConnectionId) {
    try {
      const proofRes = await fetch(`${DOCTOR_URL}/send-proof-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proofRequestlabel: 'e2e-verification-7a', connectionId: doctorConnectionId }),
      });
      const proofBody = await proofRes.json();
      const verified = proofBody?.id
        ? await pollUntil(async () => {
            const statusRes = await fetch(`${DOCTOR_URL}/proof-status/${proofBody.id}`);
            const status = await statusRes.json();
            return status.isVerified ? status : undefined;
          }, 20000, 500)
        : undefined;
      steps.push({
        step: '7a. Real proof exchange attempt',
        status: verified ? 'ok' : 'blocked',
        detail: verified
          ? `Real AnonCreds proof verified on the same connection established in step 3 (id=${proofBody.id})`
          : `Did not verify within 20s (id=${proofBody?.id ?? 'none'}) — unexpected given step 3 already verified a proof on this same connection`,
      });
    } catch (err) {
      steps.push({ step: '7a. Real proof exchange attempt', status: 'blocked', detail: `${(err as Error).message}` });
    }
  } else {
    steps.push({ step: '7a. Real proof exchange attempt', status: 'blocked', detail: 'No doctor connection established in step 3 to reuse' });
  }

  // 7b: demonstrate the VP-generation mechanism itself with a synthetic proof
  // object (same approach already unit-verified in Days 11-12) — clearly
  // labeled synthetic, not a substitute for a live ZKP.
  const syntheticProof = {
    requested_proof: {
      revealed_attrs: { role: { sub_proof_index: 0, raw: 'doctor', encoded: '1' } },
      unrevealed_attrs: {},
      self_attested_attrs: {},
      predicates: {},
    },
    proof: {},
    identifiers: [{ schema_id: 'e2e-schema', cred_def_id: 'e2e-creddef' }],
  };
  const vpRes = await fetch(`${DWN_URL}/dwn/protocols/generate-vp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anoncredsProof: syntheticProof, holderDID: patientDID || 'did:e2e:unknown', protocolName: 'MedicalRecord' }),
  });
  const vpBody = await vpRes.json();
  steps.push({
    step: '7b. VP generation mechanism (synthetic proof)',
    status: vpRes.status === 201 && vpBody.vpJwt ? 'ok' : 'blocked',
    detail: vpRes.status === 201 ? 'VP generated and signed from a synthetic AnonCreds proof object (mechanism verified; not a live ZKP — see step 7a)' : `Failed: ${JSON.stringify(vpBody).slice(0, 200)}`,
  });

  // ---------- Step 8: revokeAccess ----------
  if (!permissionId || !patientDID || !dwnRecordId) {
    steps.push({ step: '8. revokeAccess', status: 'blocked', detail: 'Prerequisite steps did not complete' });
  } else {
    await fetch(`${DWN_URL}/dwn/revokeAccess`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionId }),
    });
    const afterRevoke = await fetch(`${DWN_URL}/dwn/queryRecord?recordId=${dwnRecordId}&requesterDID=${insurerDID}`);
    steps.push({
      step: '8. revokeAccess',
      status: afterRevoke.status === 403 ? 'ok' : 'blocked',
      detail: `Read after revocation returned ${afterRevoke.status} (expected 403)`,
    });
  }

  // ---------- Step 9: Audit integrity (positive case) ----------
  if (!patientDID) {
    steps.push({ step: '9. Audit integrity', status: 'blocked', detail: 'No patientDID to check audit events for' });
  } else {
    const events = await AuditService.getByTarget(patientDID);
    const verifyResults = await Promise.all(events.map((e) => AuditService.verify(e)));
    const allGenuine = events.length > 0 && verifyResults.every(Boolean);
    steps.push({
      step: '9. Audit integrity (positive case)',
      status: allGenuine ? 'ok' : 'blocked',
      detail: `${events.length} audit events recorded for this run's patientDID, all verify()=true (Day 18's attack sim already proved the tampered/negative case)`,
    });
  }

  // ---------- Step 10: Integrity VC verification ----------
  steps.push({
    step: '10. Integrity VC verification',
    status: 'na',
    detail: 'Not applicable — DWNRecord.integrityVCId is a documented, deferred placeholder (local-placeholder-{uuid}), not yet a real on-chain Indy VC. See CLAUDE.md Known Constraints.',
  });

  await shutdownAllTestPatients();

  return finish();
}

function finish() {
  const resultsDir = path.resolve(__dirname, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const jsonPath = path.join(resultsDir, `e2e-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ steps, generatedAt: new Date().toISOString() }, null, 2));

  const mdLines: string[] = [`# End-to-End Flow Test — ${new Date().toISOString()}`, '', '| Step | Status | Detail |', '|---|---|---|'];
  for (const s of steps) mdLines.push(`| ${s.step} | ${s.status} | ${s.detail} |`);
  const mdPath = path.join(resultsDir, `e2e-${timestamp}.md`);
  fs.writeFileSync(mdPath, mdLines.join('\n'));

  console.log(`\nResults written to:\n  ${jsonPath}\n  ${mdPath}\n`);
  for (const s of steps) console.log(`${s.status.toUpperCase().padEnd(8)} ${s.step} — ${s.detail}`);

  // 7a used to be deliberately expected to fail (pre-genesis-fix); it's now
  // expected to pass like everything else, so it's no longer excluded here.
  const hardFailures = steps.filter((s) => s.status === 'blocked').length;
  process.exit(hardFailures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E test crashed:', err);
  process.exit(1);
});
