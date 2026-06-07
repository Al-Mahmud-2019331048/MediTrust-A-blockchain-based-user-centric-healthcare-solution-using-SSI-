"use client";
import React, { useState, useEffect } from 'react';
import Navigation from '@/components/Navigation';

export default function PatientPage() {
  const [activeTab, setActiveTab] = useState('credentials');
  const [credentials, setCredentials] = useState([]);
  const [connections, setConnections] = useState([]);
  const [invitationUrl, setInvitationUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Simulated data for demonstration purposes
  useEffect(() => {
    // In a real implementation, these would come from the patient's wallet
    setCredentials([
      {
        id: 'cred-1',
        type: 'IdentityCredential',
        issuer: 'Government',
        issuanceDate: '2025-05-10T10:30:00Z',
        attributes: {
          name: 'John Doe',
          age: 35,
          email: 'john.doe@example.com',
          address: '123 Main St, Anytown',
          nationalId: 'ID12345678'
        }
      },
      {
        id: 'cred-2',
        type: 'PrescriptionCredential',
        issuer: 'Dr. Smith',
        issuanceDate: '2025-05-11T09:15:00Z',
        documentId: 'doc-12345',
        documentHash: 'hash-abcdef123456',
        attributes: {
          medication: 'Amoxicillin',
          dosage: '500mg',
          frequency: 'Three times daily',
          duration: '7 days'
        }
      }
    ]);

    setConnections([
      {
        id: 'conn-1',
        name: 'Government Identity Issuer',
        theirDid: 'did:key:z6MkgYAF7H...',
        myDid: 'did:key:z6MkrW2VC7...',
        state: 'completed',
        createdAt: '2025-05-09T14:20:00Z'
      },
      {
        id: 'conn-2',
        name: 'Dr. Smith Medical Office',
        theirDid: 'did:key:z6MkpQr5T8...',
        myDid: 'did:key:z6MkjL9B3V...',
        state: 'completed',
        createdAt: '2025-05-10T11:45:00Z'
      },
      {
        id: 'conn-3',
        name: 'City Pharmacy',
        theirDid: 'did:key:z6MktH7D2P...',
        myDid: 'did:key:z6MkwF1R8S...',
        state: 'completed',
        createdAt: '2025-05-11T10:30:00Z'
      }
    ]);
  }, []);

  const handleAcceptInvitation = (e) => {
    e.preventDefault();
    
    if (!invitationUrl) {
      setError('Please enter an invitation URL');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    
    // Simulate accepting an invitation
    setTimeout(() => {
      setLoading(false);
      setSuccess('Connection established successfully!');
      setInvitationUrl('');
      
      // In a real implementation, this would add the new connection to the list
    }, 2000);
  };

  const handleShareCredential = (connectionId, credentialId) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    // Simulate sharing a credential
    setTimeout(() => {
      setLoading(false);
      setSuccess('Credential shared successfully!');
      
      // In a real implementation, this would send the credential to the connection
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <main className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-extrabold text-gray-900">
            Patient Wallet
          </h1>
          <p className="mt-2 text-lg text-gray-800">
            Manage your identity credentials and medical documents
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 p-4 rounded-md">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-red-800">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="mb-6 bg-green-50 p-4 rounded-md">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-green-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-green-800">{success}</p>
              </div>
            </div>
          </div>
        )}

        {/* Accept Invitation Form */}
        <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Accept Connection Invitation</h2>
          <form onSubmit={handleAcceptInvitation}>
            <div className="flex items-center">
              <input
                type="text"
                value={invitationUrl}
                onChange={(e) => setInvitationUrl(e.target.value)}
                placeholder="Paste invitation URL here"
                className="flex-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
              />
              <button
                type="submit"
                disabled={loading}
                className="ml-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {loading ? 'Accepting...' : 'Accept Invitation'}
              </button>
            </div>
          </form>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('credentials')}
              className={`${
                activeTab === 'credentials'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              My Credentials
            </button>
            <button
              onClick={() => setActiveTab('connections')}
              className={`${
                activeTab === 'connections'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              My Connections
            </button>
            <button
              onClick={() => setActiveTab('documents')}
              className={`${
                activeTab === 'documents'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              My Documents
            </button>
          </nav>
        </div>

        {/* Credentials Tab */}
        {activeTab === 'credentials' && (
          <div>
            <h2 className="text-xl font-semibold mb-4">My Credentials</h2>
            {credentials.length === 0 ? (
              <p className="text-gray-500">You don't have any credentials yet.</p>
            ) : (
              <div className="space-y-6">
                {credentials.map((credential) => (
                  <div key={credential.id} className="bg-white shadow overflow-hidden sm:rounded-lg">
                    <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
                      <div>
                        <h3 className="text-lg leading-6 font-medium text-gray-900">{credential.type}</h3>
                        <p className="mt-1 max-w-2xl text-sm text-gray-500">Issued by: {credential.issuer}</p>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => {
                            // Show credential details
                          }}
                          className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                          View Details
                        </button>
                        <button
                          onClick={() => {
                            // Open share modal
                          }}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                        >
                          Share
                        </button>
                      </div>
                    </div>
                    <div className="border-t border-gray-200 px-4 py-5 sm:p-0">
                      <dl className="sm:divide-y sm:divide-gray-200">
                        {Object.entries(credential.attributes).map(([key, value]) => (
                          <div key={key} className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                            <dt className="text-sm font-medium text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</dt>
                            <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">{value}</dd>
                          </div>
                        ))}
                        <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                          <dt className="text-sm font-medium text-gray-500">Issuance Date</dt>
                          <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                            {new Date(credential.issuanceDate).toLocaleString()}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Connections Tab */}
        {activeTab === 'connections' && (
          <div>
            <h2 className="text-xl font-semibold mb-4">My Connections</h2>
            {connections.length === 0 ? (
              <p className="text-gray-500">You don't have any connections yet.</p>
            ) : (
              <div className="bg-white shadow overflow-hidden sm:rounded-lg">
                <ul className="divide-y divide-gray-200">
                  {connections.map((connection) => (
                    <li key={connection.id} className="px-4 py-4 sm:px-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{connection.name}</p>
                          <p className="text-sm text-gray-500">
                            Connected: {new Date(connection.createdAt).toLocaleString()}
                          </p>
                          <p className="text-sm text-gray-500 truncate">Their DID: {connection.theirDid}</p>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => {
                              // Show connection details
                            }}
                            className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          >
                            Details
                          </button>
                          <button
                            onClick={() => {
                              // Send message
                            }}
                            className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          >
                            Message
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Documents Tab */}
        {activeTab === 'documents' && (
          <div>
            <h2 className="text-xl font-semibold mb-4">My Medical Documents</h2>
            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              <ul className="divide-y divide-gray-200">
                <li className="px-4 py-4 sm:px-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Prescription - Amoxicillin</p>
                      <p className="text-sm text-gray-500">Issued by Dr. Smith on May 11, 2025</p>
                      <p className="text-sm text-gray-500">Document ID: doc-12345</p>
                      <p className="text-sm text-gray-500 truncate">Hash: hash-abcdef123456</p>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => {
                          // View document
                        }}
                        className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        View
                      </button>
                      <button
                        onClick={() => {
                          // Share document
                        }}
                        className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        Share
                      </button>
                    </div>
                  </div>
                </li>
                <li className="px-4 py-4 sm:px-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Lab Report - Blood Test</p>
                      <p className="text-sm text-gray-500">Issued by City Medical Lab on May 8, 2025</p>
                      <p className="text-sm text-gray-500">Document ID: doc-67890</p>
                      <p className="text-sm text-gray-500 truncate">Hash: hash-ghijkl789012</p>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => {
                          // View document
                        }}
                        className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        View
                      </button>
                      <button
                        onClick={() => {
                          // Share document
                        }}
                        className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        Share
                      </button>
                    </div>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
