/**
 * Chat memory storage helper.
 * Provides client-side persistence in localStorage, scoped strictly per user ID
 * to prevent conversation leakage across different user accounts.
 */

import { MessageItem } from "@/components/chat/chat-interface";
import { conversationsApi } from "./api";
import { getToken, getUser, getUserIdFromToken } from "./auth";
 
export interface StoredSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: MessageItem[];
}

export function getStorageKey(): string {
  const tokenUserId = getUserIdFromToken();
  const user = getUser();
  const userId = tokenUserId || user?.id;
  return userId
    ? `enterprise_rag_chat_memory_${userId}`
    : "enterprise_rag_chat_memory_guest";
}

export function clearCurrentChatStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getStorageKey());
    // Also remove the old legacy un-scoped key to prevent cross-account pollution
    localStorage.removeItem("enterprise_rag_chat_memory_v1");
  } catch (e) {
    console.error("Failed to clear chat storage:", e);
  }
}

export function getStoredSessions(): StoredSession[] {
  if (typeof window === "undefined") return [];
  try {
    // If legacy key exists, clean it up so it never leaks to other accounts
    localStorage.removeItem("enterprise_rag_chat_memory_v1");

    const key = getStorageKey();
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: StoredSession[] = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.sort((a, b) => b.updatedAt - a.updatedAt)
      : [];
  } catch (e) {
    console.error("Failed to read chat memory from localStorage:", e);
    return [];
  }
}

export function getStoredSession(id: string): StoredSession | null {
  const sessions = getStoredSessions();
  return sessions.find((s) => s.id === id) || null;
}

export function saveStoredSession(session: StoredSession): void {
  if (typeof window === "undefined") return;
  try {
    const key = getStorageKey();
    const sessions = getStoredSessions().filter((s) => s.id !== session.id);
    sessions.unshift({
      ...session,
      updatedAt: Date.now(),
    });
    localStorage.setItem(key, JSON.stringify(sessions.slice(0, 50)));
  } catch (e) {
    console.error("Failed to save chat session to localStorage:", e);
  }
}

export function deleteStoredSession(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = getStorageKey();
    const sessions = getStoredSessions().filter((s) => s.id !== id);
    localStorage.setItem(key, JSON.stringify(sessions));
    // Also trigger backend delete if user is logged in
    if (getToken()) {
      conversationsApi.delete(id).catch(() => {});
    }
  } catch (e) {
    console.error("Failed to delete chat session:", e);
  }
}

export function createNewSession(initialTitle?: string): StoredSession {
  const newId = crypto.randomUUID();
  const session: StoredSession = {
    id: newId,
    title: initialTitle || "New Conversation",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [
      {
        id: "initial",
        role: "assistant",
        content:
          "Hello. I am your Academic & Educational Research Assistant. Ask any question regarding published papers, educational datasets, global literacy trends, student performance indicators, or course syllabi.",
      },
    ],
  };
  saveStoredSession(session);
  return session;
}

export function updateSessionMessages(
  id: string,
  messages: MessageItem[],
  customTitle?: string
): StoredSession {
  const existing = getStoredSession(id);
  const firstUserMsg = messages.find((m) => m.role === "user");
  const computedTitle =
    customTitle ||
    (existing && existing.title !== "New Conversation"
      ? existing.title
      : firstUserMsg?.content
      ? firstUserMsg.content.slice(0, 42).trim() + (firstUserMsg.content.length > 42 ? "..." : "")
      : "New Conversation");

  const updated: StoredSession = {
    id,
    title: computedTitle,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    messages,
  };
  saveStoredSession(updated);
  return updated;
}
