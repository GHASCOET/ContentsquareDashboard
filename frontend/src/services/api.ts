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

  async getGoals(): Promise<CSGoalsResponse> {
    return this.request('/api/contentsquare/goals');
  }

  async getErrorsAnalysis(startDate: string, endDate: string): Promise<CSErrorsAnalysisResponse> {
    return this.request(`/api/contentsquare/errors-analysis?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
  }

  async getPageGroupMetrics(pageGroupId: number, startDate: string, endDate: string): Promise<CSSiteMetricsResponse> {
    return this.request(`/api/contentsquare/page-metrics/${pageGroupId}?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
  }

  async getBrowserBreakdown(): Promise<CSBrowserBreakdownResponse> {
    return this.request('/api/contentsquare/browser-breakdown');
  }

  async getDeviceBreakdown(): Promise<CSDeviceBreakdownResponse> {
    return this.request('/api/contentsquare/device-breakdown');
  }

  async getConversions(): Promise<CSConversionsResponse> {
    return this.request('/api/contentsquare/conversions');
  }

  async getCountryBreakdown(): Promise<CSCountryBreakdownResponse> {
    return this.request('/api/contentsquare/country-breakdown');
  }

  async getErrorTrends(): Promise<CSErrorTrendsResponse> {
    return this.request('/api/contentsquare/error-trends');
  }

  async getJourney(): Promise<CSJourneyResponse> {
    return this.request('/api/contentsquare/journey');
  }

  async getReverseJourney(): Promise<CSReverseJourneyResponse> {
    return this.request('/api/contentsquare/reverse-journey');
  }

  async getPagesErrorsScatter(): Promise<CSPagesErrorsScatterResponse> {
    return this.request('/api/contentsquare/pages-errors-scatter');
  }

  async getLostConversions(): Promise<CSLostConversionsResponse> {
    return this.request('/api/contentsquare/lost-conversions');
  }

  async getConversionTrends(): Promise<CSConversionTrendsResponse> {
    return this.request('/api/contentsquare/conversion-trends');
  }

  async getPlatformBreakdown(): Promise<CSPlatformBreakdownResponse> {
    return this.request('/api/contentsquare/platform-breakdown');
  }

  async getUserSegmentsComparison(): Promise<CSUserSegmentsResponse> {
    return this.request('/api/contentsquare/user-segments-comparison');
  }

  async getFunnelAnalysis(): Promise<CSFunnelAnalysisResponse> {
    return this.request('/api/contentsquare/funnel-analysis');
  }

  async getPageDetailedMetrics(): Promise<CSPageDetailedMetricsResponse> {
    return this.request('/api/contentsquare/page-detailed-metrics');
  }

  async getConversionTrendsPJ(): Promise<CSConversionTrendsResponse> {
    return this.request('/api/contentsquare/conversion-trends-pj');
  }

  async getCityBreakdown(): Promise<CSCityBreakdownResponse> {
    return this.request('/api/contentsquare/city-breakdown');
  }

  async getScreenResolution(): Promise<CSScreenResolutionResponse> {
    return this.request('/api/contentsquare/screen-resolution');
  }

  async getPageErrorTrends(): Promise<CSPageErrorTrendsResponse> {
    return this.request('/api/contentsquare/page-error-trends');
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

export interface CSBrowserData {
  name: string;
  visits: number;
  bounceRate: number;
  sessionTimeAverage: number;
  pageviewAverage: number;
  visitWithErrors: number;
}

export interface CSBrowserBreakdownResponse {
  browsers: CSBrowserData[];
  success: boolean;
}

export interface CSDeviceData {
  name: string;
  visits: number;
  bounceRate: number;
  sessionTimeAverage: number;
  pageviewAverage: number;
}

export interface CSDeviceBreakdownResponse {
  devices: CSDeviceData[];
  success: boolean;
}

export interface CSConversion {
  goalId: number;
  goalName: string;
  conversionRate: number;
  conversionCount: number;
  type: string;
}

export interface CSConversionsResponse {
  conversions: CSConversion[];
  success: boolean;
}

export interface CSCountryData {
  code: string;
  name: string;
  visits: number;
  bounceRate: number;
  visitWithErrors: number;
}

export interface CSCountryBreakdownResponse {
  countries: CSCountryData[];
  success: boolean;
}

export interface CSErrorTrendDay {
  date: string;
  visits: number;
  visitWithErrors: number;
}

export interface CSErrorTrendsResponse {
  dailyTrends: CSErrorTrendDay[];
  success: boolean;
}

export interface CSFunnelStep {
  name: string;
  sessions: number;
}

export interface CSConversionFunnel {
  name: string;
  steps: CSFunnelStep[];
}

export interface CSLandingPage {
  name: string;
  sessions: number;
  exitRate: number;
}

export interface CSJourneyResponse {
  landingPages: CSLandingPage[];
  conversionFunnels: CSConversionFunnel[];
  totalSessions: number;
  success: boolean;
}

export interface CSExitPage {
  name: string;
  sessions: number;
  percentage: number;
}

export interface CSExitPath {
  from: string;
  to: string;
  to2: string;
  sessions: number;
}

export interface CSReverseJourneyResponse {
  exitPages: CSExitPage[];
  topExitPaths: CSExitPath[];
  totalSessions: number;
  success: boolean;
}

export interface CSPageErrorScatter {
  pageId: number;
  name: string;
  visits: number;
  visitWithErrors: number;
  errorRate: number;
}

export interface CSPagesErrorsScatterResponse {
  pages: CSPageErrorScatter[];
  success: boolean;
}

export interface CSLostConversionPage {
  pageId: number;
  name: string;
  visits: number;
  visitWithErrors: number;
  errorsCount: number;
  lostConversions: number;
}

export interface CSLostConversionsResponse {
  pages: CSLostConversionPage[];
  goalName: string;
  totalLostConversions: number;
  success: boolean;
}

export interface CSUserSegment {
  name: string;
  visits: number;
  bounceRate: number;
  sessionTimeAverage: number;
  pageviewAverage: number;
  visitWithErrors: number;
  errorRate: number;
}

export interface CSInsight {
  label: string;
  value: number;
  description: string;
}

export interface CSUserSegmentsResponse {
  segments: CSUserSegment[];
  insights: CSInsight[];
  success: boolean;
}

export interface CSFunnelStepDetail {
  name: string;
  sessions: number;
  stepConversion: number;
  stepDropOff: number;
  timeToCompletion: number;
}

export interface CSFunnelDetail {
  name: string;
  steps: CSFunnelStepDetail[];
}

export interface CSFunnelAnalysisResponse {
  funnels: CSFunnelDetail[];
  success: boolean;
}

export interface CSPageDetailedMetric {
  pageId: number;
  name: string;
  visits: number;
  bounceRate: number;
  exitRate: number;
  scrollRate: number;
  activityRate: number;
  visitWithErrors: number;
  errorRate: number;
  elapsedTime: number;
  interactionTime: number;
  loadingTime: number;
  conversionRate?: number;
}

export interface CSPageDetailedMetricsResponse {
  pages: CSPageDetailedMetric[];
  success: boolean;
}

export interface CSConversionTrendDay {
  date: string;
  visits: number;
  conversionRate: number;
  conversionCount: number;
}

export interface CSConversionTrendsResponse {
  dailyConversions: CSConversionTrendDay[];
  goalName: string;
  success: boolean;
}

export interface CSPlatformData {
  name: string;
  visits: number;
  bounceRate: number;
  sessionTimeAverage: number;
  percentage: number;
}

export interface CSPlatformBreakdownResponse {
  platforms: CSPlatformData[];
  success: boolean;
}

export interface CSCityData {
  name: string;
  visits: number;
  percentage: number;
}

export interface CSCityBreakdownResponse {
  cities: CSCityData[];
  success: boolean;
}

export interface CSScreenResolution {
  width: number;
  visits: number;
  percentage: number;
}

export interface CSScreenResolutionResponse {
  resolutions: CSScreenResolution[];
  success: boolean;
}

export interface CSPageDailyError {
  date: string;
  visits: number;
  visitWithErrors: number;
}

export interface CSPageErrorTrend {
  name: string;
  dailyData: CSPageDailyError[];
}

export interface CSPageErrorTrendsResponse {
  pages: CSPageErrorTrend[];
  success: boolean;
}

export const api = new ApiClient();
