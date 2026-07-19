import Link from 'next/link';

const PORTALS = [
  {
    href: '/government',
    title: 'Government Portal',
    role: 'Issuer',
    description: 'Issue a verified identity credential to a patient’s Bifold wallet.',
    accent: 'from-blue-500 to-blue-600',
  },
  {
    href: '/doctor',
    title: 'Doctor Portal',
    role: 'Issuer',
    description: 'Connect with a patient and issue a medical record or prescription credential.',
    accent: 'from-emerald-500 to-emerald-600',
  },
  {
    href: '/patient',
    title: 'Patient Dashboard',
    role: 'Data Owner',
    description: 'View your DWN-stored records, manage consent, and back up your recovery key.',
    accent: 'from-violet-500 to-violet-600',
  },
  {
    href: '/pharmacy',
    title: 'Pharmacy Portal',
    role: 'Verifier',
    description: 'Verify a patient’s identity and prescription — via wallet proof or a direct DWN read.',
    accent: 'from-sky-500 to-sky-600',
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center px-6 py-16">
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">MediTrust</h1>
        <p className="mt-3 text-gray-500">
          Decentralized, patient-centric healthcare identity &amp; records
        </p>
      </div>

      <div className="grid w-full gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {PORTALS.map((portal) => (
          <Link
            key={portal.href}
            href={portal.href}
            className="group relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
          >
            <div
              className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${portal.accent} transition-all duration-300 group-hover:h-1.5`}
            />
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {portal.role}
            </span>
            <h2 className="mt-2 text-lg font-bold text-gray-900">{portal.title}</h2>
            <p className="mt-2 text-sm text-gray-500">{portal.description}</p>
            <span className="mt-4 inline-block text-sm font-medium text-blue-600 transition-transform duration-300 group-hover:translate-x-1">
              Open &rarr;
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
