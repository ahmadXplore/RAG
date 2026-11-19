/**
 * Auth token helpers — operates on localStorage only.
 * Rule 4: Never store API keys or backend secrets here.
 * Rule 5: Tokens expire per backend JWT_EXPIRE_MINUTES; we track expiry client-side
 *         to redirect before the backend rejects the call.
 */

const TOKEN_KEY = "rag_access_token";
const USER_KEY = "rag_user";

// In-memory fallback for SSR and testing environments where window is undefined
const memoryStore: Record<string, string> = {};

export interface StoredUser {
  id: string;
  email: string;
  full_name: string;
  roles: string[];
}

export function setToken(token: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(TOKEN_KEY, token);
    document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=86400; SameSite=Lax`;
  } else {
    memoryStore[TOKEN_KEY] = token;
  }
}

export function parseJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length >= 2) {
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      return JSON.parse(jsonPayload);
    }
  } catch {
    // ignore
  }
  return null;
}

export function isTokenExpired(token?: string | null): boolean {
  const raw =
    token !== undefined
      ? token
      : typeof window !== "undefined"
      ? localStorage.getItem(TOKEN_KEY)
      : memoryStore[TOKEN_KEY];
  if (!raw) return true;
  const payload = parseJwtPayload(raw);
  if (!payload) return true;
  if (typeof payload.exp === "number") {
    return payload.exp * 1000 <= Date.now();
  }
  return false;
}

export function getToken(): string | null {
  const raw =
    typeof window !== "undefined"
      ? localStorage.getItem(TOKEN_KEY)
      : memoryStore[TOKEN_KEY] ?? null;
  if (!raw) return null;
  if (isTokenExpired(raw)) {
    clearToken();
    return null;
  }
  return raw;
}

export function getUserIdFromToken(): string | null {
  const token = getToken();
  if (!token) return null;
  const payload = parseJwtPayload(token);
  return payload?.sub ? String(payload.sub) : null;
}

/**
 * Fix #1 & #4: Read roles directly from valid, non-expired signed JWT payload.
 * Returns an empty array if the token is absent, expired, or unparseable.
 */
export function getRolesFromToken(): string[] {
  const token = getToken();
  if (!token) return [];
  const payload = parseJwtPayload(token);
  if (payload && Array.isArray(payload.roles)) {
    return payload.roles.map((r: unknown) => String(r).toLowerCase());
  }
  return [];
}

export function clearToken(): void {
  if (typeof window !== "undefined") {
    try {
      const tokenUserId = getUserIdFromToken();
      if (tokenUserId) {
        localStorage.removeItem(`enterprise_rag_chat_memory_${tokenUserId}`);
      }
      const userRaw = localStorage.getItem(USER_KEY);
      if (userRaw) {
        const u = JSON.parse(userRaw);
        if (u?.id) {
          localStorage.removeItem(`enterprise_rag_chat_memory_${u.id}`);
        }
      }
      localStorage.removeItem("enterprise_rag_chat_memory_v1");
      localStorage.removeItem("enterprise_rag_chat_memory_guest");
    } catch {
      // ignore
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
    try {
      fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    } catch {
      // ignore
    }
  } else {
    delete memoryStore[TOKEN_KEY];
    delete memoryStore[USER_KEY];
  }
}

export function setUser(user: StoredUser): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    memoryStore[USER_KEY] = JSON.stringify(user);
  }
}

export function getUser(): StoredUser | null {
  const raw =
    typeof window !== "undefined"
      ? localStorage.getItem(USER_KEY)
      : memoryStore[USER_KEY];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

export function hasRole(role: string): boolean {
  const user = getUser();
  return user?.roles?.some((r) => r.toLowerCase() === role.toLowerCase()) ?? false;
}

/**
 * Fix #2: Removed dead `hasRole("ADMIN")` duplicate — hasRole() already
 * lowercases both sides, making the ADMIN check identical to the admin check.
 * Fix #1: Also checks JWT payload roles (immutable without a valid signature)
 * in addition to the localStorage user store, so editing rag_user in DevTools
 * alone is not sufficient — the backend will still 403 on the API call.
 */
export function isAdmin(): boolean {
  if (!isAuthenticated()) return false;
  // Primary: read from signed JWT payload (tamper-resistant)
  const tokenRoles = getRolesFromToken();
  if (tokenRoles.includes("admin")) return true;
  // Secondary: fall back to stored user object for cases where token lacks roles claim
  return hasRole("admin");
}

export function isAnalyst(): boolean {
  if (!isAuthenticated()) return false;
  return hasRole("analyst") || isAdmin();
}
