const API_BASE = import.meta.env.VITE_API_URL || '';

interface ApiError {
  error: string;
}

class ApiClient {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem('token');
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      this.setToken(null);
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error((data as ApiError).error || 'Request failed');
    }

    return data as T;
  }

  // Auth
  async login(username: string, password: string): Promise<{ token: string; user: { id: number; username: string } }> {
    const data = await this.request<{ token: string; user: { id: number; username: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.setToken(data.token);
    return data;
  }

  // Contentsquare
  async getContentsquareSiteMetrics(startDate: string, endDate: string): Promise<CSSiteMetricsResponse> {
    return this.request(`/api/contentsquare/site-metrics?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
  }

  async getContentsquareErrors(): Promise<CSErrorsResponse> {
    return this.request('/api/contentsquare/errors', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async getContentsquareMappings(): Promise<CSMappingsResponse> {
    return this.request('/api/contentsquare/mappings');
  }

  async getContentsquarePageGroups(mappingId: number): Promise<CSPageGroupsResponse> {
    return this.request(`/api/contentsquare/mappings/${mappingId}/page-groups`);
  }

  async getContentsquareWebVitals(pageGroupId: string, startDate: string, endDate: string): Promise<CSSiteMetricsResponse> {
    return this.request(`/api/contentsquare/web-vitals/${pageGroupId}?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
  }

  async getDeviceBreakdown(startDate: string, endDate: string): Promise<CSDeviceBreakdownResponse> {
    return this.request(`/api/contentsquare/site-metrics-by-device?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
  }

  async getGoals(): Promise<CSGoalsResponse> {
    return this.request('/api/contentsquare/goals');
  }

  async getErrorsAnalysis(startDate: string, endDate: string): Promise<CSErrorsAnalysisResponse> {
    return this.request(`/api/contentsquare/errors-analysis?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
  }

  async getPageGroupMetrics(pageGroupId: number, startDate: string, endDate: string): Promise<CSSiteMetricsResponse> {
    return this.request(`/api/contentsquare/page-metrics/${pageGroupId}?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
  }
}

// Contentsquare raw API response format
export interface CSMetricValue {
  startDate: string;
  endDate: string;
  value: number;
  name: string;
  currency: string;
}

export interface CSSiteMetricsResponse {
  payload: {
    values: CSMetricValue[];
  };
  success: boolean;
}

export interface CSErrorsResponse {
  errors: Array<{
    message: string;
    count: number;
    sessionsImpacted: number;
    firstSeen: string;
    lastSeen: string;
  }>;
}

export interface CSMapping {
  id: number;
  name: string;
  description: string | null;
}

export interface CSMappingsResponse {
  payload: CSMapping[];
  success: boolean;
}

export interface CSPageGroup {
  id: number;
  name: string;
  category: string;
}

export interface CSPageGroupsResponse {
  payload: CSPageGroup[];
  success: boolean;
}

export interface CSDeviceData {
  visits: number;
  bounceRate: number;
  sessionTimeAverage: number;
  pageviewAverage: number;
}

export interface CSDeviceBreakdownResponse {
  desktop: CSDeviceData;
  mobile: CSDeviceData;
  tablet: CSDeviceData;
  success: boolean;
}

export interface CSGoal {
  id: number;
  name: string;
  type: string;
}

export interface CSGoalsResponse {
  payload: CSGoal[];
  success: boolean;
}

export interface CSErrorItem {
  errorUrl: string;
  errorMethod: string;
  errorStatusCode: number;
  sessionsImpacted: number;
  totalSessions: number;
}

export interface CSErrorsAnalysisResponse {
  errors: CSErrorItem[];
  errorRate: number;
  totalSessions: number;
  sessionsWithErrors: number;
}

export const api = new ApiClient();
