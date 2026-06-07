import React from "react";
import ConnectionManager from "./ConnectionManager";
import QRCodeSection from "./QRCodeSection";

const PatientConnectionSection = ({
  qrCodeUrl,
  connections,
  selectedConnection,
  onConnectionSelect,
  onRefreshConnections,
}) => {
  return (
    <div className="bg-white rounded-3xl shadow-xl border border-gray-100">
      <div className="p-8 lg:p-12">
        <div className="text-center mb-10">
          <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl">
            <svg
              className="w-10 h-10 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"
              />
            </svg>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Patient Connection & Verification
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Establish secure connection and verify patient credentials for
            prescription dispensing
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <QRCodeSection qrCodeUrl={qrCodeUrl} />
          <ConnectionManager
            connections={connections}
            selectedConnection={selectedConnection}
            onConnectionSelect={onConnectionSelect}
            onRefreshConnections={onRefreshConnections}
          />
        </div>
      </div>
    </div>
  );
};

export default PatientConnectionSection;
