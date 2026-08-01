function ChatWindow() {
  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">
      {/* AI Message */}
      <div className="self-start max-w-2xl bg-white shadow-md rounded-xl p-4">
        <p className="font-semibold text-blue-700 mb-2">
          GCE AI Assistant
        </p>

        <p className="text-gray-700">
          👋 Hello! Welcome to the GCE Tirunelveli AI Assistant.
        </p>

        <p className="text-gray-700 mt-2">
          I can help you with:
        </p>

        <ul className="list-disc list-inside mt-2 text-gray-700 space-y-1">
          <li>Admissions</li>
          <li>Departments</li>
          <li>Fee Structure</li>
          <li>Hostel Facilities</li>
          <li>Placements</li>
          <li>Academic Regulations</li>
          <li>Scholarships</li>
          <li>Official College Information</li>
        </ul>

        <p className="mt-4 text-gray-700">
          Ask me anything to get started.
        </p>
      </div>

      {/* Sample User Message */}
      <div className="self-end max-w-xl bg-blue-700 text-white rounded-xl p-4 shadow-md">
        Tell me about the ECE Department.
      </div>
    </div>
  );
}

export default ChatWindow;