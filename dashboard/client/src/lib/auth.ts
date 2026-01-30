// Token storage key
const TOKEN_KEY = 'vibe_auth_token';

export interface TokenPayload {
  type: 'admin' | 'participant';
  id?: string;
  email?: string;
  name?: string;
  iat: number;
  exp: number;
}

// Save token to localStorage
export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

// Get token from localStorage
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

// Remove token from localStorage
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// Decode JWT payload (without verification - just for reading)
export function decodeToken(token: string): TokenPayload | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

// Check if token is expired
export function isTokenExpired(token: string): boolean {
  const payload = decodeToken(token);
  if (!payload) return true;

  // Check if exp exists and compare with current time
  const now = Math.floor(Date.now() / 1000);
  return payload.exp < now;
}

// Check if currently authenticated
export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  return !isTokenExpired(token);
}

// Get current user from token
export function getCurrentUser(): TokenPayload | null {
  const token = getToken();
  if (!token || isTokenExpired(token)) return null;
  return decodeToken(token);
}

// Check if current user is admin
export function isAdmin(): boolean {
  const user = getCurrentUser();
  return user?.type === 'admin';
}

// Check if current user is participant
export function isParticipant(): boolean {
  const user = getCurrentUser();
  return user?.type === 'participant';
}

// Logout - clear token
export function logout(): void {
  clearToken();
}
