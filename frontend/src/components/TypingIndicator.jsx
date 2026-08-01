function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-gray-100 rounded-2xl px-4 py-3 shadow-md">
        <div className="flex items-center gap-2">
          <span className="text-gray-600">
            GCE AI is typing
          </span>

          <span className="animate-bounce">•</span>
          <span
            className="animate-bounce"
            style={{ animationDelay: "0.2s" }}
          >
            •
          </span>
          <span
            className="animate-bounce"
            style={{ animationDelay: "0.4s" }}
          >
            •
          </span>
        </div>
      </div>
    </div>
  );
}

export default TypingIndicator;