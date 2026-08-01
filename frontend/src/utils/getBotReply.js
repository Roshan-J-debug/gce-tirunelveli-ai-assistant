const greetings = [
  // Basic greetings
  "hi",
  "hii",
  "hiii",
  "hello",
  "helloo",
  "hey",
  "heyy",
  "heyyy",
  "hola",
  "yo",
  "sup",
  "wassup",
  "what's up",
  "whats up",

  // Brother slang
  "bro",
  "broo",
  "brooo",
  "brother",
  "brothers",
  "hello brother",
  "hey brother",
  "hey bro",
  "bro da",
  "brotha",
  "broski",
  "bruh",
  "brah",
  "brahh",
  "braww",
  "brow",
  "broww",
  "browww",
  "bru",
  "bruv",

  // Friendly words
  "buddy",
  "pal",
  "friend",
  "mate",
  "dude",
  "boss",
  "chief",
  "captain",

  // Tamil / Indian style
  "machi",
  "machi bro",
  "macha",
  "macha bro",
  "anna",
  "thala",
  "nanba",
  "vanakkam",
  "namaste",

  // Informal
  "oi",
  "oii",
  "oiii",
  "oye",
  "hlo",
  "helo",
  "hy",
  "hiya",
  "hello there",

  // Time greetings
  "good morning",
  "good afternoon",
  "good evening",
  "good night",

  // Asking about AI
  "how are you",
  "how are u",
  "how r u",
  "are you there",
  "can you hear me",
  "are you online",
  "are you available",

  // Starting chat
  "start",
  "begin",
  "lets chat",
  "let's chat",
  "talk to me",
  "chat",
  "help",
  "assistant",
  "hi ai",
  "hello ai",
  "gce ai"
];

export function getBotReply(message) {
  const text = message.toLowerCase().trim();

  if (greetings.some(word => text.includes(word))) {
    return `👋 Hello! Welcome to the GCE Tirunelveli AI Assistant.

I'm your official college AI assistant.

I can help you with:

🎓 Admissions
🏫 Departments
💰 Fee Structure
🛏 Hostel Facilities
💼 Placements
📚 Academic Regulations
🎖 Scholarships
📅 Academic Calendar
📍 Campus Information
📞 Contact Details

Feel free to ask me anything about GCE Tirunelveli. 😊`;
  }

  return "I'm still learning. Soon I'll answer all your college-related questions using the official GCE Tirunelveli knowledge base.";
}