'use client';
// Shared record renderer — originally built for the Patient Dashboard,
// reused as-is by the Doctor Portal's records view so both pages render a
// DWN record (JSON fields or image/PDF attachment) identically.
import { useState } from 'react';
import type { DWNRecordSummary } from '@/services/dwnService';

export const RECORD_TYPE_LABELS: Record<string, string> = {
  medical: 'Medical record',
  prescription: 'Prescription',
  lab_report: 'Lab report',
};

// Turns "documentId" / "patientName" into "Document ID" / "Patient Name" —
// a handful of common medical/document abbreviations get their own casing
// rather than the generic Title Case split.
const LABEL_OVERRIDES: Record<string, string> = {
  documentId: 'Document ID',
  documentType: 'Document type',
  documentHash: 'Document hash',
  patientId: 'Patient ID',
};

function humanizeFieldName(key: string): string {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function humanizeFieldValue(key: string, value: unknown): string {
  if ((key === 'issuedAt' || key.endsWith('At')) && typeof value === 'string' && !isNaN(Date.parse(value))) {
    return new Date(value).toLocaleString();
  }
  return String(value);
}

export function RecordCard({ record }: { record: DWNRecordSummary }) {
  const [showRaw, setShowRaw] = useState(false);
  const isImage = record.contentType === 'image/jpeg' || record.contentType === 'image/png';
  const isPdf = record.contentType === 'application/pdf';
  const isBinary = isImage || isPdf;

  return (
    <li className="rounded-lg border border-gray-100 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-800">
          {RECORD_TYPE_LABELS[record.recordType] ?? record.recordType}
        </span>
        <span className="text-xs text-gray-400">{new Date(record.createdAt).toLocaleString()}</span>
      </div>

      {isBinary ? (
        <div className="mt-3">
          {isImage && typeof record.data === 'string' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:${record.contentType};base64,${record.data}`}
              alt={record.fileName ?? 'attachment'}
              className="max-h-64 rounded-lg border border-gray-100 object-contain"
            />
          )}
          {isPdf && typeof record.data === 'string' && (
            <a
              href={`data:${record.contentType};base64,${record.data}`}
              download={record.fileName ?? 'document.pdf'}
              className="inline-block rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-200"
            >
              Download {record.fileName ?? 'PDF'}
            </a>
          )}
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {record.data && typeof record.data === 'object'
            ? Object.entries(record.data as Record<string, unknown>).map(([key, value]) => (
                <div key={key} className="flex flex-col">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                    {humanizeFieldName(key)}
                  </dt>
                  <dd className="text-sm text-gray-700 break-words">{humanizeFieldValue(key, value)}</dd>
                </div>
              ))
            : null}
        </dl>
      )}

      <button
        onClick={() => setShowRaw((v) => !v)}
        className="mt-2 text-[11px] text-gray-400 underline hover:text-gray-600"
      >
        {showRaw ? 'Hide raw data' : 'View raw data'}
      </button>
      {showRaw && (
        <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-600">
          {isBinary ? `(binary ${record.contentType}, ${record.fileName ?? 'no filename'})` : JSON.stringify(record.data, null, 2)}
        </pre>
      )}
    </li>
  );
}
