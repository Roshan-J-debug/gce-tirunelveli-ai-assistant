import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";

function ChatWindow({ messages, isTyping }) {
  return (
    <div className="space-y-4 h-96 overflow-y-auto">
      {messages.map((message, index) => (
        <MessageBubble
          key={index}
          message={message}
        />
      ))}

      {isTyping && <TypingIndicator />}
    </div>
  );
}

export default ChatWindow;