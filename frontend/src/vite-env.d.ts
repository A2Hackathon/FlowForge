/// <reference types="vite/client" />

interface Window {
  api: {
    login: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
    checkAuth: () => Promise<{ loggedIn: boolean }>;
    logout: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
    getUser: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
    listRepos: (params?: { page?: number }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    searchRepos: (params: { query: string }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    scanRepo: (params: { projectId: number }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    onScanProgress: (callback: (data: { message: string }) => void) => () => void;
    generateGraph: (params: { scanResult: unknown }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  };
}