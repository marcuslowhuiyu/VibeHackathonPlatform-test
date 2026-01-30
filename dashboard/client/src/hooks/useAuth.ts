import { useState, useCallback, useEffect } from 'react';
import {
  getToken,
  saveToken,
  clearToken,
  decodeToken,
  isTokenExpired,
  TokenPayload,
} from '../lib/auth';

export interface AuthState {
  isAuthenticated: boolean;
  isAdmin: boolean;
  isParticipant: boolean;
  user: TokenPayload | null;
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  checkAuth: () => boolean;
}

export function useAuth(): AuthState {
  const [token, setToken] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<TokenPayload | null>(() => {
    const t = getToken();
    if (t && !isTokenExpired(t)) {
      return decodeToken(t);
    }
    return null;
  });

  const login = useCallback((newToken: string) => {
    saveToken(newToken);
    setToken(newToken);
    setUser(decodeToken(newToken));
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setToken(null);
    setUser(null);
  }, []);

  const checkAuth = useCallback(() => {
    const currentToken = getToken();
    if (!currentToken || isTokenExpired(currentToken)) {
      logout();
      return false;
    }
    return true;
  }, [logout]);

  // Check token validity on mount and periodically
  useEffect(() => {
    checkAuth();
    const interval = setInterval(checkAuth, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [checkAuth]);

  return {
    isAuthenticated: !!token && !!user,
    isAdmin: user?.type === 'admin',
    isParticipant: user?.type === 'participant',
    user,
    token,
    login,
    logout,
    checkAuth,
  };
}
