import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";

function ChatWindow({ messages, isTyping }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, isTyping]);

  return (
    <div className="space-y-4 h-96 overflow-y-auto pr-2">
      {messages.map((message, index) => (
        <MessageBubble
          key={index}
          message={message}
        />
      ))}

      {isTyping && <TypingIndicator />}

      {/* Auto Scroll Target */}
      <div ref={bottomRef}></div>
    </div>
  );
}

export default ChatWindow;