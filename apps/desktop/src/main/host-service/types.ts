export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

export type DisplayState = {
  isRunning: boolean;
  currentMessage: string | null;
  messages: ChatMessage[];
};

export type SessionState = {
  sessionId: string;
  messages: ChatMessage[];
  isRunning: boolean;
  currentPartial: string;
};
