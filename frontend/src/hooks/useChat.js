import { useEffect, useState } from "react";
import { getBotReply } from "../utils/getBotReply";

export default function useChat() {
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem("gce-chat");

    if (saved) {
      return JSON.parse(saved);
    }

    return [
      {
        sender: "assistant",
        text: "👋 Welcome to the GCE Tirunelveli AI Assistant!",
      },
    ];
  });

  const [isTyping, setIsTyping] = useState(false);

  // Save chat whenever it changes
  useEffect(() => {
    localStorage.setItem("gce-chat", JSON.stringify(messages));
  }, [messages]);

  const sendMessage = (text) => {
    if (!text.trim()) return;

    setMessages((prev) => [
      ...prev,
      {
        sender: "user",
        text,
      },
    ]);

    setIsTyping(true);

    setTimeout(() => {
      const reply = getBotReply(text);

      setMessages((prev) => [
        ...prev,
        {
          sender: "assistant",
          text: reply,
        },
      ]);

      setIsTyping(false);
    }, 1000);
  };

  const clearChat = () => {
    localStorage.removeItem("gce-chat");

    setMessages([
      {
        sender: "assistant",
        text: "👋 Welcome to the GCE Tirunelveli AI Assistant!",
      },
    ]);
  };

  return {
    messages,
    isTyping,
    sendMessage,
    clearChat,
  };
}