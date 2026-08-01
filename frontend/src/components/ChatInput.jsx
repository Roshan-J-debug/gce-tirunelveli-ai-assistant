function ChatInput() {
  return (
    <div className="border-t bg-white p-4">
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Ask anything about GCE Tirunelveli..."
          className="flex-1 border rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
        />

        <button className="bg-blue-600 text-white px-6 rounded-lg hover:bg-blue-700">
          Send
        </button>
      </div>
    </div>
  );
}

export default ChatInput;