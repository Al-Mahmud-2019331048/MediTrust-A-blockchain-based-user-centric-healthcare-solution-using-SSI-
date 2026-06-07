import React from "react";

const ConnectionManager = ({
  connections,
  selectedConnection,
  onConnectionSelect,
  onRefreshConnections,
}) => {
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-200">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
          <svg
            className="w-5 h-5 mr-2 text-blue-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          Active Connections
        </h3>

        <select
          value={selectedConnection?.id || ""}
          onChange={(e) =>
            onConnectionSelect(
              connections.find((conn) => conn.id === e.target.value) || null
            )
          }
          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-700 bg-white shadow-sm"
        >
          <option value="">Select a patient connection...</option>
          {connections.map((conn) => (
            <option key={conn.id} value={conn.id}>
              👤 {conn.theirLabel || `Patient ${conn.id.substring(0, 8)}...`} (
              {conn.state === "completed" ? "✅ Connected" : "⏳ Connecting"})
            </option>
          ))}
        </select>

        {selectedConnection && (
          <div className="mt-4 p-3 bg-white rounded-lg shadow-sm border border-blue-100">
            <div className="flex items-center text-sm text-gray-600">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-2 animate-pulse"></div>
              Connected to:{" "}
              <span className="font-medium ml-1">
                {selectedConnection.theirLabel || selectedConnection.id}
              </span>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onRefreshConnections}
        className="w-full inline-flex items-center justify-center px-6 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold rounded-xl hover:from-purple-700 hover:to-indigo-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl"
      >
        <svg
          className="w-5 h-5 mr-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        Refresh Connections
      </button>
    </div>
  );
};

export default ConnectionManager;
