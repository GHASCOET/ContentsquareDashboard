import React, { useState, useEffect, useMemo } from 'react';
import { api, CSMetricValue, CSErrorItem, CSBrowserData, CSDeviceData, CSConversion, CSCountryData, CSErrorTrendDay, CSConversionFunnel, CSLandingPage, CSExitPage, CSExitPath, CSPageErrorScatter, CSLostConversionPage, CSConversionTrendDay, CSPlatformData, CSFunnelDetail, CSPageDetailedMetric, CSUserSegment, CSInsight, CSCityData, CSScreenResolution, CSPageErrorTrend } from '../services/api';
import { format, subDays, addDays, endOfWeek, eachWeekOfInterval, differenceInDays, min } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';

const PROJECT_ID = 16096;

const COLORS = {
  visits: '#3b82f6',
  bounce: '#ef4444',
  sessionTime: '#22c55e',
  pagesPerVisit: '#f97316',
};

type MetricKey = 'visits' | 'bounceRate' | 'avgSessionTime' | 'pagesPerVisit';

const METRIC_LABELS: Record<MetricKey, string> = {
  visits: 'Visites',
  bounceRate: 'Taux de rebond',
  avgSessionTime: 'Duree session',
  pagesPerVisit: 'Pages / visite',
};

const METRIC_COLORS: Record<MetricKey, string> = {
  visits: COLORS.visits,
  bounceRate: COLORS.bounce,
  avgSessionTime: COLORS.sessionTime,
  pagesPerVisit: COLORS.pagesPerVisit,
};

interface DailyMetric {
  date: string;
  visits: number;
  bounceRate: number;
  avgSessionTime: number;
  pagesPerVisit: number;
}

interface WeeklyData {
  weekLabel: string;
  weekStart: string;
  visits: number;
  bounceRate: number;
  avgSessionTime: number;
  pagesPerVisit: number;
}

interface ErrorsAnalysis {
  errors: CSErrorItem[];
  errorRate: number;
  totalSessions: number;
  sessionsWithErrors: number;
}

interface PageGroupMetrics {
  pageGroupId: number;
  name: string;
  visits: number;
  bounceRate: number;
  exitRate: number;
  landingRate: number;
  scrollRate: number;
  activityRate: number;
  loadTime: number;
}

type VitalKey = 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb';

interface DailyVitals {
  date: string;
  lcp: number;
  inp: number;
  cls: number;
  fcp: number;
  ttfb: number;
}

const VITAL_CONFIG: Record<VitalKey, {
  label: string;
  unit: string;
  good: number;
  poor: number;
  color: string;
  format: (v: number) => string;
}> = {
  lcp: { label: 'LCP', unit: 'ms', good: 2500, poor: 4000, color: '#22c55e', format: v => `${(v / 1000).toFixed(2)}s` },
  inp: { label: 'INP', unit: 'ms', good: 200, poor: 500, color: '#3b82f6', format: v => `${Math.round(v)}ms` },
  cls: { label: 'CLS', unit: '', good: 0.1, poor: 0.25, color: '#a855f7', format: v => v.toFixed(3) },
  fcp: { label: 'FCP', unit: 'ms', good: 1800, poor: 3000, color: '#f97316', format: v => `${(v / 1000).toFixed(2)}s` },
  ttfb: { label: 'TTFB', unit: 'ms', good: 800, poor: 1800, color: '#ec4899', format: v => `${Math.round(v)}ms` },
};

function getVitalRating(key: VitalKey, value: number): 'good' | 'needs-improvement' | 'poor' {
  const config = VITAL_CONFIG[key];
  if (value <= config.good) return 'good';
  if (value <= config.poor) return 'needs-improvement';
  return 'poor';
}

const RATING_COLORS = {
  good: '#22c55e',
  'needs-improvement': '#eab308',
  poor: '#ef4444',
};

// Max days per API request to avoid 502 from CS API
const MAX_CHUNK_DAYS = 31;

async function fetchSiteMetricsChunked(start: Date, end: Date): Promise<CSMetricValue[]> {
  const totalDays = differenceInDays(end, start);
  if (totalDays <= MAX_CHUNK_DAYS) {
    const startISO = format(start, "yyyy-MM-dd'T'00:00:00.000'Z'");
    const endISO = format(end, "yyyy-MM-dd'T'23:59:59.000'Z'");
    const res = await api.getContentsquareSiteMetrics(startISO, endISO);
    return res.payload.values;
  }

  const allValues: CSMetricValue[] = [];
  let chunkStart = start;
  while (chunkStart < end) {
    const chunkEnd = min([addDays(chunkStart, MAX_CHUNK_DAYS - 1), end]);
    const startISO = format(chunkStart, "yyyy-MM-dd'T'00:00:00.000'Z'");
    const endISO = format(chunkEnd, "yyyy-MM-dd'T'23:59:59.000'Z'");
    const res = await api.getContentsquareSiteMetrics(startISO, endISO);
    allValues.push(...res.payload.values);
    chunkStart = addDays(chunkEnd, 1);
  }
  return allValues;
}

// Parse CS flat metric values into daily data
function parseCSMetrics(values: CSMetricValue[]): DailyMetric[] {
  const byDate: Record<string, DailyMetric> = {};
  for (const v of values) {
    const date = v.startDate.split('T')[0];
    if (!byDate[date]) {
      byDate[date] = { date, visits: 0, bounceRate: 0, avgSessionTime: 0, pagesPerVisit: 0 };
    }
    if (v.name === 'visits') byDate[date].visits = v.value;
    if (v.name === 'bounceRate') byDate[date].bounceRate = v.value;
    if (v.name === 'sessionTimeAverage') byDate[date].avgSessionTime = v.value;
    if (v.name === 'pageviewAverage') byDate[date].pagesPerVisit = v.value;
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatDelta(current: number, previous: number): { value: string; positive: boolean } {
  if (previous === 0) return { value: '+0%', positive: true };
  const delta = ((current - previous) / previous) * 100;
  return {
    value: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
    positive: delta >= 0,
  };
}

export default function Contentsquare() {
  const [startDate, setStartDate] = useState(() => format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('visits');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [dailyData, setDailyData] = useState<DailyMetric[]>([]);
  const [prevDailyData, setPrevDailyData] = useState<DailyMetric[]>([]);
  const [errorsAnalysis, setErrorsAnalysis] = useState<ErrorsAnalysis | null>(null);
  const [vitalsData, setVitalsData] = useState<DailyVitals[]>([]);
  const [selectedVital, setSelectedVital] = useState<VitalKey>('lcp');
  const [pageMetrics, setPageMetrics] = useState<PageGroupMetrics[]>([]);
  const [expandedPageId, setExpandedPageId] = useState<number | null>(null);
  const [expandedPageVitals, setExpandedPageVitals] = useState<Record<string, number> | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'performance' | 'errors' | 'behavior'>('overview');
  const [browserData, setBrowserData] = useState<CSBrowserData[]>([]);
  const [deviceData, setDeviceData] = useState<CSDeviceData[]>([]);
  const [conversions, setConversions] = useState<CSConversion[]>([]);
  const [countryData, setCountryData] = useState<CSCountryData[]>([]);
  const [errorTrends, setErrorTrends] = useState<CSErrorTrendDay[]>([]);
  const [conversionFunnels, setConversionFunnels] = useState<CSConversionFunnel[]>([]);
  const [landingPages, setLandingPages] = useState<CSLandingPage[]>([]);
  const [exitPages, setExitPages] = useState<CSExitPage[]>([]);
  const [exitPaths, setExitPaths] = useState<CSExitPath[]>([]);
  const [pagesErrorsScatter, setPagesErrorsScatter] = useState<CSPageErrorScatter[]>([]);
  const [lostConversions, setLostConversions] = useState<CSLostConversionPage[]>([]);
  const [totalLostConversions, setTotalLostConversions] = useState(0);
  const [conversionTrends, setConversionTrends] = useState<CSConversionTrendDay[]>([]);
  const [conversionTrendsPJ, setConversionTrendsPJ] = useState<CSConversionTrendDay[]>([]);
  const [platformData, setPlatformData] = useState<CSPlatformData[]>([]);
  const [funnelData, setFunnelData] = useState<CSFunnelDetail[]>([]);
  const [pageDetailedMetrics, setPageDetailedMetrics] = useState<CSPageDetailedMetric[]>([]);
  const [userSegments, setUserSegments] = useState<CSUserSegment[]>([]);
  const [userInsights, setUserInsights] = useState<CSInsight[]>([]);
  const [cityData, setCityData] = useState<CSCityData[]>([]);
  const [screenResolutions, setScreenResolutions] = useState<CSScreenResolution[]>([]);
  const [pageErrorTrends, setPageErrorTrends] = useState<CSPageErrorTrend[]>([]);

  const periodDays = useMemo(() => {
    return differenceInDays(new Date(endDate), new Date(startDate));
  }, [startDate, endDate]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const start = new Date(startDate);
      const end = new Date(endDate);

      // Fetch site metrics (chunked for large ranges)
      const values = await fetchSiteMetricsChunked(start, end);
      setDailyData(parseCSMetrics(values));

      // Fetch errors analysis
      try {
        const startISO = format(start, "yyyy-MM-dd'T'00:00:00.000'Z'");
        const endISO = format(end, "yyyy-MM-dd'T'23:59:59.000'Z'");
        const errRes = await api.getErrorsAnalysis(startISO, endISO);
        setErrorsAnalysis(errRes);
      } catch {
        setErrorsAnalysis(null);
      }

      // Fetch MCP-sourced data in parallel
      const [browserRes, deviceRes, convRes, countryRes, errorTrendsRes, journeyRes, reverseJourneyRes, scatterRes, lostConvRes, convTrendsRes, platformRes, funnelRes, pageDetailRes, convTrendsPJRes, segmentsRes, cityRes, screenRes, pageErrTrendsRes] = await Promise.allSettled([
        api.getBrowserBreakdown(),
        api.getDeviceBreakdown(),
        api.getConversions(),
        api.getCountryBreakdown(),
        api.getErrorTrends(),
        api.getJourney(),
        api.getReverseJourney(),
        api.getPagesErrorsScatter(),
        api.getLostConversions(),
        api.getConversionTrends(),
        api.getPlatformBreakdown(),
        api.getFunnelAnalysis(),
        api.getPageDetailedMetrics(),
        api.getConversionTrendsPJ(),
        api.getUserSegmentsComparison(),
        api.getCityBreakdown(),
        api.getScreenResolution(),
        api.getPageErrorTrends(),
      ]);
      if (browserRes.status === 'fulfilled') setBrowserData(browserRes.value.browsers || []);
      if (deviceRes.status === 'fulfilled') setDeviceData(deviceRes.value.devices || []);
      if (convRes.status === 'fulfilled') setConversions(convRes.value.conversions || []);
      if (countryRes.status === 'fulfilled') setCountryData(countryRes.value.countries || []);
      if (errorTrendsRes.status === 'fulfilled') setErrorTrends(errorTrendsRes.value.dailyTrends || []);
      if (journeyRes.status === 'fulfilled') {
        setConversionFunnels(journeyRes.value.conversionFunnels || []);
        setLandingPages(journeyRes.value.landingPages || []);
      }
      if (reverseJourneyRes.status === 'fulfilled') {
        setExitPages(reverseJourneyRes.value.exitPages || []);
        setExitPaths(reverseJourneyRes.value.topExitPaths || []);
      }
      if (scatterRes.status === 'fulfilled') setPagesErrorsScatter(scatterRes.value.pages || []);
      if (lostConvRes.status === 'fulfilled') {
        setLostConversions(lostConvRes.value.pages || []);
        setTotalLostConversions(lostConvRes.value.totalLostConversions || 0);
      }
      if (convTrendsRes.status === 'fulfilled') setConversionTrends(convTrendsRes.value.dailyConversions || []);
      if (platformRes.status === 'fulfilled') setPlatformData(platformRes.value.platforms || []);
      if (funnelRes.status === 'fulfilled') setFunnelData(funnelRes.value.funnels || []);
      if (pageDetailRes.status === 'fulfilled') setPageDetailedMetrics(pageDetailRes.value.pages || []);
      if (convTrendsPJRes.status === 'fulfilled') setConversionTrendsPJ(convTrendsPJRes.value.dailyConversions || []);
      if (segmentsRes.status === 'fulfilled') {
        setUserSegments(segmentsRes.value.segments || []);
        setUserInsights(segmentsRes.value.insights || []);
      }
      if (cityRes.status === 'fulfilled') setCityData(cityRes.value.cities || []);
      if (screenRes.status === 'fulfilled') setScreenResolutions(screenRes.value.resolutions || []);
      if (pageErrTrendsRes.status === 'fulfilled') setPageErrorTrends(pageErrTrendsRes.value.pages || []);

      // Fetch page group metrics
      try {
        const mappingsRes = await api.getContentsquareMappings();
        const mappings = mappingsRes.payload || [];
        if (mappings.length > 0) {
          const mappingId = mappings[mappings.length - 1].id;
          const pgRes = await api.getContentsquarePageGroups(mappingId);
          const pageGroups = pgRes.payload || [];
          const startISO = format(start, "yyyy-MM-dd'T'00:00:00.000'Z'");
          const endISO = format(end, "yyyy-MM-dd'T'23:59:59.000'Z'");

          const pgMetrics = await Promise.all(
            pageGroups.map(async (pg) => {
              try {
                const res = await api.getPageGroupMetrics(pg.id, startISO, endISO);
                const vals = res.payload?.values || [];
                const get = (name: string) => {
                  const v = vals.find(val => val.name === name);
                  return v ? v.value : 0;
                };
                return {
                  pageGroupId: pg.id,
                  name: pg.name,
                  visits: get('visits'),
                  bounceRate: get('bounceRate'),
                  exitRate: get('exitRate'),
                  landingRate: get('landingRate'),
                  scrollRate: get('scrollRate'),
                  activityRate: get('activityRate'),
                  loadTime: get('loadTime'),
                };
              } catch {
                return null;
              }
            })
          );
          setPageMetrics(pgMetrics.filter(Boolean) as PageGroupMetrics[]);
        }
      } catch {
        setPageMetrics([]);
      }

      // Web Vitals: fetch mappings → page groups → web vitals (weekly chunks for time series)
      try {
        const mappingsRes = await api.getContentsquareMappings();
        const mappings = mappingsRes.payload || [];
        if (mappings.length > 0) {
          const mappingId = mappings[mappings.length - 1].id;
          const pgRes = await api.getContentsquarePageGroups(mappingId);
          const pageGroups = pgRes.payload || [];
          if (pageGroups.length > 0) {
            const pgId = String(pageGroups[0].id);
            // CS web-vitals returns aggregated data (not daily), so we chunk by week
            const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
            const vitalsPoints: DailyVitals[] = [];

            const median = (arr: number[]) => {
              if (arr.length === 0) return 0;
              const sorted = [...arr].sort((a, b) => a - b);
              const mid = Math.floor(sorted.length / 2);
              return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
            };

            await Promise.all(weeks.map(async (weekStart) => {
              const wEnd = min([endOfWeek(weekStart, { weekStartsOn: 1 }), end]);
              if (weekStart > end) return;
              const wStartISO = format(weekStart, "yyyy-MM-dd'T'00:00:00.000'Z'");
              const wEndISO = format(wEnd, "yyyy-MM-dd'T'23:59:59.000'Z'");
              try {
                const res = await api.getContentsquareWebVitals(pgId, wStartISO, wEndISO);
                const vals = res.payload?.values || [];
                // Collect all values per metric name, take median
                const byMetric: Record<string, number[]> = {};
                for (const v of vals) {
                  if (!byMetric[v.name]) byMetric[v.name] = [];
                  byMetric[v.name].push(v.value);
                }
                vitalsPoints.push({
                  date: format(weekStart, 'yyyy-MM-dd'),
                  lcp: median(byMetric['largestContentfulPaint'] || []) * 1000,
                  inp: median(byMetric['interactionToNextPaint'] || []) * 1000,
                  cls: median(byMetric['cumulativeLayoutShift'] || []),
                  fcp: median(byMetric['firstContentfulPaint'] || []) * 1000,
                  ttfb: median(byMetric['timeToFirstByte'] || []) * 1000,
                });
              } catch { /* skip failed weeks */ }
            }));

            setVitalsData(vitalsPoints.sort((a, b) => a.date.localeCompare(b.date)));
          } else {
            setVitalsData([]);
          }
        } else {
          setVitalsData([]);
        }
      } catch {
        setVitalsData([]);
      }

      // Comparison period
      if (compareEnabled) {
        const prevStart = subDays(start, periodDays);
        const prevEnd = subDays(end, periodDays);
        const prevValues = await fetchSiteMetricsChunked(prevStart, prevEnd);
        setPrevDailyData(parseCSMetrics(prevValues));
      } else {
        setPrevDailyData([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [startDate, endDate, compareEnabled]);

  const kpis = useMemo(() => {
    if (dailyData.length === 0) return null;
    const totalVisits = dailyData.reduce((s, d) => s + d.visits, 0);
    const avgBounce = dailyData.reduce((s, d) => s + d.bounceRate, 0) / dailyData.length;
    const avgSession = dailyData.reduce((s, d) => s + d.avgSessionTime, 0) / dailyData.length;
    const avgPages = dailyData.reduce((s, d) => s + d.pagesPerVisit, 0) / dailyData.length;
    return { totalVisits, avgBounce, avgSession, avgPages };
  }, [dailyData]);

  const prevKpis = useMemo(() => {
    if (prevDailyData.length === 0) return null;
    const totalVisits = prevDailyData.reduce((s, d) => s + d.visits, 0);
    const avgBounce = prevDailyData.reduce((s, d) => s + d.bounceRate, 0) / prevDailyData.length;
    const avgSession = prevDailyData.reduce((s, d) => s + d.avgSessionTime, 0) / prevDailyData.length;
    const avgPages = prevDailyData.reduce((s, d) => s + d.pagesPerVisit, 0) / prevDailyData.length;
    return { totalVisits, avgBounce, avgSession, avgPages };
  }, [prevDailyData]);

  const vitalsAvg = useMemo(() => {
    if (vitalsData.length === 0) return null;
    const keys: VitalKey[] = ['lcp', 'inp', 'cls', 'fcp', 'ttfb'];
    const avgs: Record<string, number> = {};
    for (const k of keys) {
      avgs[k] = vitalsData.reduce((s, d) => s + d[k], 0) / vitalsData.length;
    }
    return avgs as Record<VitalKey, number>;
  }, [vitalsData]);

  const chartData = useMemo(() => {
    return dailyData.map((d, i) => ({
      date: d.date,
      [selectedMetric]: d[selectedMetric],
      ...(compareEnabled && prevDailyData[i] ? { prev: prevDailyData[i][selectedMetric] } : {}),
    }));
  }, [dailyData, prevDailyData, selectedMetric, compareEnabled]);

  const weeklyData = useMemo((): WeeklyData[] => {
    if (dailyData.length === 0) return [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });

    return weeks.map(weekStart => {
      const wEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
      const weekDays = dailyData.filter(d => {
        const date = new Date(d.date);
        return date >= weekStart && date <= wEnd;
      });
      if (weekDays.length === 0) return null;

      return {
        weekLabel: `${format(weekStart, 'dd MMM', { locale: fr })}`,
        weekStart: format(weekStart, 'yyyy-MM-dd'),
        visits: weekDays.reduce((s, d) => s + d.visits, 0),
        bounceRate: Math.round(weekDays.reduce((s, d) => s + d.bounceRate, 0) / weekDays.length * 10) / 10,
        avgSessionTime: Math.round(weekDays.reduce((s, d) => s + d.avgSessionTime, 0) / weekDays.length * 10) / 10,
        pagesPerVisit: Math.round(weekDays.reduce((s, d) => s + d.pagesPerVisit, 0) / weekDays.length * 10) / 10,
      };
    }).filter(Boolean) as WeeklyData[];
  }, [dailyData, startDate, endDate]);

  const weeklyWithDelta = useMemo(() => {
    return weeklyData.map((week, i) => {
      const prev = i > 0 ? weeklyData[i - 1] : null;
      return {
        ...week,
        visitsDelta: prev ? formatDelta(week.visits, prev.visits) : null,
        bounceDelta: prev ? formatDelta(week.bounceRate, prev.bounceRate) : null,
        sessionDelta: prev ? formatDelta(week.avgSessionTime, prev.avgSessionTime) : null,
        pagesDelta: prev ? formatDelta(week.pagesPerVisit, prev.pagesPerVisit) : null,
      };
    });
  }, [weeklyData]);

  const sortedPageMetrics = useMemo(() => {
    return [...pageMetrics].sort((a, b) => b.visits - a.visits);
  }, [pageMetrics]);

  const sparklineData = useMemo(() => ({
    visits: dailyData.map(d => d.visits),
    bounce: dailyData.map(d => d.bounceRate),
    session: dailyData.map(d => d.avgSessionTime),
    pages: dailyData.map(d => d.pagesPerVisit),
  }), [dailyData]);

  const browserPieData = useMemo(() => {
    const total = browserData.reduce((s, b) => s + b.visits, 0);
    return browserData.filter(b => b.visits > 0).map(b => ({
      name: b.name,
      value: b.visits,
      percent: total > 0 ? Math.round((b.visits / total) * 1000) / 10 : 0,
    }));
  }, [browserData]);

  const errorTrendChartData = useMemo(() => {
    return errorTrends.map(d => ({
      date: d.date,
      visits: d.visits,
      errors: d.visitWithErrors,
      errorRate: d.visits > 0 ? Math.round((d.visitWithErrors / d.visits) * 1000) / 10 : 0,
    }));
  }, [errorTrends]);

  const setPreset = (days: number) => {
    setEndDate(format(new Date(), 'yyyy-MM-dd'));
    setStartDate(format(subDays(new Date(), days), 'yyyy-MM-dd'));
  };

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Contentsquare</h1>
            <p>Bouygues Telecom - Agences (ID: {PROJECT_ID})</p>
          </div>
        </div>
        <div className="stats-grid">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="stat-card" style={{ minHeight: '100px' }}>
              <div style={{ height: '2rem', width: '60%', backgroundColor: 'var(--color-bg-tertiary)', borderRadius: '6px', marginBottom: '0.5rem', animation: 'pulse 1.5s ease-in-out infinite' }} />
              <div style={{ height: '1rem', width: '40%', backgroundColor: 'var(--color-bg-tertiary)', borderRadius: '4px', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: '0.2s' }} />
            </div>
          ))}
        </div>
        <div className="card" style={{ marginTop: '1.5rem', height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem', animation: 'pulse 1.5s ease-in-out infinite' }}>Chargement des donnees...</div>
            <div style={{ fontSize: '0.85rem' }}>Contentsquare API</div>
          </div>
        </div>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <h3>Erreur</h3>
        <p>{error}</p>
      </div>
    );
  }

  const errorRateColor = (rate: number) => {
    if (rate > 30) return '#ef4444';
    if (rate > 15) return '#eab308';
    return '#22c55e';
  };

  const statusBadgeColor = (code: number) => {
    if (code >= 500) return '#ef4444';
    if (code === 404) return '#f97316';
    return '#eab308';
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Contentsquare</h1>
          <p>Bouygues Telecom - Agences (ID: {PROJECT_ID})</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="date"
            className="input"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            style={{ width: 'auto' }}
          />
          <span style={{ color: 'var(--color-text-secondary)' }}>-</span>
          <input
            type="date"
            className="input"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            style={{ width: 'auto' }}
          />
          <button
            className={`btn ${compareEnabled ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setCompareEnabled(!compareEnabled)}
          >
            {compareEnabled ? 'Comparaison ON' : 'Comparer'}
          </button>
        </div>
      </div>

      {/* Presets */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {[7, 14, 30, 60, 90, 180, 365].map(d => (
          <button
            key={d}
            className="btn btn-secondary"
            style={{
              padding: '0.25rem 0.75rem',
              fontSize: '0.85rem',
              opacity: periodDays === d ? 1 : 0.7,
              borderColor: periodDays === d ? 'var(--color-primary)' : undefined,
            }}
            onClick={() => setPreset(d)}
          >
            {d >= 365 ? '1 an' : `${d}j`}
          </button>
        ))}
      </div>

      {/* Tab Navigation */}
      <div style={{
        display: 'flex', gap: '0', marginBottom: '1.5rem',
        borderBottom: '2px solid var(--color-border)', overflow: 'auto',
      }}>
        {([
          { key: 'overview', label: 'Vue d\'ensemble' },
          { key: 'performance', label: 'Performance' },
          { key: 'errors', label: 'Erreurs' },
          { key: 'behavior', label: 'Comportement' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '0.75rem 1.25rem', border: 'none', cursor: 'pointer',
              fontSize: '0.9rem', fontWeight: activeTab === tab.key ? 700 : 500,
              color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              backgroundColor: 'transparent',
              borderBottom: activeTab === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: '-2px', whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="stat-value" style={{ color: COLORS.visits }}>
                {kpis ? kpis.totalVisits.toLocaleString('fr-FR') : '-'}
              </div>
              <div className="stat-label">Visites</div>
              {compareEnabled && prevKpis && kpis && (
                <DeltaBadge {...formatDelta(kpis.totalVisits, prevKpis.totalVisits)} />
              )}
            </div>
            <Sparkline data={sparklineData.visits} color={COLORS.visits} />
          </div>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="stat-value" style={{ color: COLORS.bounce }}>
                {kpis ? `${kpis.avgBounce.toFixed(1)}%` : '-'}
              </div>
              <div className="stat-label">Taux de rebond</div>
              {compareEnabled && prevKpis && kpis && (
                <DeltaBadge {...formatDelta(kpis.avgBounce, prevKpis.avgBounce)} invertColor />
              )}
            </div>
            <Sparkline data={sparklineData.bounce} color={COLORS.bounce} />
          </div>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="stat-value" style={{ color: COLORS.sessionTime }}>
                {kpis ? formatDuration(kpis.avgSession) : '-'}
              </div>
              <div className="stat-label">Duree moy. session</div>
              {compareEnabled && prevKpis && kpis && (
                <DeltaBadge {...formatDelta(kpis.avgSession, prevKpis.avgSession)} />
              )}
            </div>
            <Sparkline data={sparklineData.session} color={COLORS.sessionTime} />
          </div>
        </div>
        <div className="stat-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="stat-value" style={{ color: COLORS.pagesPerVisit }}>
                {kpis ? kpis.avgPages.toFixed(1) : '-'}
              </div>
              <div className="stat-label">Pages / visite</div>
              {compareEnabled && prevKpis && kpis && (
                <DeltaBadge {...formatDelta(kpis.avgPages, prevKpis.avgPages)} />
              )}
            </div>
            <Sparkline data={sparklineData.pages} color={COLORS.pagesPerVisit} />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: errorsAnalysis ? errorRateColor(errorsAnalysis.errorRate) : 'var(--color-text-secondary)' }}>
            {errorsAnalysis ? `${errorsAnalysis.errorRate.toFixed(1)}%` : '-'}
          </div>
          <div className="stat-label">Sessions avec erreurs</div>
          {errorsAnalysis && (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
              {errorsAnalysis.sessionsWithErrors.toLocaleString('fr-FR')} / {errorsAnalysis.totalSessions.toLocaleString('fr-FR')}
            </div>
          )}
        </div>
      </div>

      {/* Conversions */}
      {conversions.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
          {conversions.map(conv => (
            <div key={conv.goalId} className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, height: '4px', width: `${conv.conversionRate}%`,
                backgroundColor: conv.type === 'click' ? '#8b5cf6' : '#06b6d4',
                maxWidth: '100%',
              }} />
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: '0.5rem' }}>
                {conv.goalName}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
                <div className="stat-value" style={{ color: conv.type === 'click' ? '#8b5cf6' : '#06b6d4', fontSize: '2rem' }}>
                  {conv.conversionRate.toFixed(1)}%
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                  {conv.conversionCount.toLocaleString('fr-FR')} conversions
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600,
                  backgroundColor: conv.type === 'click' ? '#8b5cf620' : '#06b6d420',
                  color: conv.type === 'click' ? '#8b5cf6' : '#06b6d4',
                }}>
                  {conv.type === 'click' ? 'Objectif clic' : 'Objectif page vue'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* === OVERVIEW TAB: Line Chart + Weekly === */}
      {activeTab === 'overview' && <>
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>Evolution jour par jour</h3>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {(Object.keys(METRIC_LABELS) as MetricKey[]).map(key => (
              <button
                key={key}
                className="btn btn-secondary"
                style={{
                  padding: '0.2rem 0.5rem',
                  fontSize: '0.8rem',
                  backgroundColor: selectedMetric === key ? METRIC_COLORS[key] : undefined,
                  color: selectedMetric === key ? '#fff' : undefined,
                  borderColor: selectedMetric === key ? METRIC_COLORS[key] : undefined,
                }}
                onClick={() => setSelectedMetric(key)}
              >
                {METRIC_LABELS[key]}
              </button>
            ))}
          </div>
        </div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tickFormatter={val => format(new Date(val), 'dd MMM', { locale: fr })}
                stroke="var(--color-text-secondary)"
              />
              <YAxis stroke="var(--color-text-secondary)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                }}
                labelFormatter={val => format(new Date(val as string), 'dd MMM yyyy', { locale: fr })}
              />
              <Line
                type="monotone"
                dataKey={selectedMetric}
                name={METRIC_LABELS[selectedMetric]}
                stroke={METRIC_COLORS[selectedMetric]}
                strokeWidth={2}
                dot={false}
              />
              {compareEnabled && (
                <Line
                  type="monotone"
                  dataKey="prev"
                  name="Periode precedente"
                  stroke={METRIC_COLORS[selectedMetric]}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  strokeOpacity={0.4}
                  dot={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state" style={{ padding: '2rem' }}>
            <p>Pas de donnees</p>
          </div>
        )}
      </div>

      {/* Conversion Trend Chart */}
      {conversionTrends.length > 0 && (
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>Tendance conversions "Commander"</h3>
          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            <span><span style={{ display: 'inline-block', width: 12, height: 3, backgroundColor: '#22c55e', borderRadius: 2, marginRight: 4 }} />Taux conversion</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 3, backgroundColor: '#3b82f6', borderRadius: 2, marginRight: 4 }} />Conversions</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={conversionTrends.map(d => ({
            date: d.date,
            rate: d.conversionRate,
            count: d.conversionCount,
          }))}>
            <defs>
              <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="date" tickFormatter={val => format(new Date(val), 'dd MMM', { locale: fr })} stroke="var(--color-text-secondary)" />
            <YAxis yAxisId="left" stroke="#3b82f6" tickFormatter={v => v.toLocaleString('fr-FR')} />
            <YAxis yAxisId="right" orientation="right" stroke="#22c55e" tickFormatter={v => `${v}%`} domain={[10, 25]} />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
              labelFormatter={val => format(new Date(val as string), 'dd MMM yyyy', { locale: fr })}
              formatter={(value: number, name: string) => [
                name === 'count' ? value.toLocaleString('fr-FR') : `${value}%`,
                name === 'count' ? 'Conversions' : 'Taux',
              ]}
            />
            <Area yAxisId="left" type="monotone" dataKey="count" name="count" stroke="#3b82f6" fill="url(#convGrad)" strokeWidth={2} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="rate" name="rate" stroke="#22c55e" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      )}

      {/* Conversion Trend - Pieces Justificatives */}
      {conversionTrendsPJ.length > 0 && (
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>Tendance conversions "Pieces Justificatives"</h3>
          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            <span><span style={{ display: 'inline-block', width: 12, height: 3, backgroundColor: '#a855f7', borderRadius: 2, marginRight: 4 }} />Taux conversion</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 3, backgroundColor: '#f97316', borderRadius: 2, marginRight: 4 }} />Conversions</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={conversionTrendsPJ.map(d => ({
            date: d.date,
            rate: d.conversionRate,
            count: d.conversionCount,
          }))}>
            <defs>
              <linearGradient id="convGradPJ" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="date" tickFormatter={val => format(new Date(val), 'dd MMM', { locale: fr })} stroke="var(--color-text-secondary)" />
            <YAxis yAxisId="left" stroke="#f97316" tickFormatter={v => v.toLocaleString('fr-FR')} />
            <YAxis yAxisId="right" orientation="right" stroke="#a855f7" tickFormatter={v => `${v}%`} domain={[10, 30]} />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
              labelFormatter={val => format(new Date(val as string), 'dd MMM yyyy', { locale: fr })}
              formatter={(value: number, name: string) => [
                name === 'count' ? value.toLocaleString('fr-FR') : `${value}%`,
                name === 'count' ? 'Conversions' : 'Taux',
              ]}
            />
            <Area yAxisId="left" type="monotone" dataKey="count" name="count" stroke="#f97316" fill="url(#convGradPJ)" strokeWidth={2} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="rate" name="rate" stroke="#a855f7" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      )}

      {/* Converters vs Non-converters */}
      {userSegments.length > 0 && (
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Convertis vs Non-convertis</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          {userSegments.map((seg, i) => {
            const isConverter = i === 0;
            const accentColor = isConverter ? '#22c55e' : '#94a3b8';
            return (
              <div key={seg.name} style={{
                padding: '1.25rem', borderRadius: '12px', border: `2px solid ${accentColor}40`,
                backgroundColor: 'var(--color-bg)', position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', backgroundColor: accentColor }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: accentColor }}>
                    {isConverter ? '✓' : '✗'} {seg.name}
                  </span>
                  <span style={{ fontSize: '1.2rem', fontWeight: 800 }}>{seg.visits.toLocaleString('fr-FR')}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
                  <div style={{ padding: '0.5rem', borderRadius: '8px', backgroundColor: 'var(--color-bg-tertiary)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>Duree session</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{formatDuration(seg.sessionTimeAverage)}</div>
                  </div>
                  <div style={{ padding: '0.5rem', borderRadius: '8px', backgroundColor: 'var(--color-bg-tertiary)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>Pages / visite</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{seg.pageviewAverage.toFixed(1)}</div>
                  </div>
                  <div style={{ padding: '0.5rem', borderRadius: '8px', backgroundColor: 'var(--color-bg-tertiary)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>Taux rebond</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: seg.bounceRate > 10 ? '#ef4444' : '#22c55e' }}>{seg.bounceRate.toFixed(1)}%</div>
                  </div>
                  <div style={{ padding: '0.5rem', borderRadius: '8px', backgroundColor: 'var(--color-bg-tertiary)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>Taux erreurs</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: seg.errorRate > 50 ? '#ef4444' : seg.errorRate > 25 ? '#f97316' : '#22c55e' }}>{seg.errorRate.toFixed(1)}%</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {/* Insights */}
        {userInsights.length > 0 && (
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {userInsights.map((insight, i) => (
            <div key={i} style={{
              padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'var(--color-bg-tertiary)',
              display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem',
            }}>
              <span style={{ fontSize: '1.1rem' }}>💡</span>
              <div style={{ flex: 1 }}>
                <strong>{insight.label}</strong> — {insight.description}
              </div>
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap', fontSize: '0.9rem' }}>{insight.value.toLocaleString('fr-FR')}</span>
            </div>
          ))}
        </div>
        )}
      </div>
      )}

      {/* Two columns: Device + Country */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
        {/* Browser mini-summary */}
        {browserPieData.length > 0 && (
          <div className="card">
            <h3 style={{ marginBottom: '0.75rem' }}>Repartition navigateurs</h3>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {browserData.filter(b => b.visits > 0).map((b, i) => (
                <div key={b.name} style={{
                  flex: 1, minWidth: '120px', padding: '0.5rem', borderRadius: '6px',
                  backgroundColor: 'var(--color-bg-tertiary)', textAlign: 'center',
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: ['#3b82f6', '#f97316', '#ef4444', '#22c55e'][i % 4], display: 'inline-block', marginRight: 4 }} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{b.name}</span>
                  <div style={{ fontSize: '1rem', fontWeight: 700, marginTop: '0.25rem' }}>{b.visits.toLocaleString('fr-FR')}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Country mini-summary */}
        {countryData.length > 0 && (
          <div className="card">
            <h3 style={{ marginBottom: '0.75rem' }}>Repartition geographique</h3>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {countryData.map(c => {
                const flag = { FR: '\ud83c\uddeb\ud83c\uddf7', ES: '\ud83c\uddea\ud83c\uddf8', FI: '\ud83c\uddeb\ud83c\uddee', CH: '\ud83c\udde8\ud83c\udded' }[c.code] || '\ud83c\udf0d';
                return (
                  <div key={c.code} style={{
                    flex: 1, minWidth: '100px', padding: '0.5rem', borderRadius: '6px',
                    backgroundColor: 'var(--color-bg-tertiary)', textAlign: 'center',
                  }}>
                    <span style={{ fontSize: '1.2rem' }}>{flag}</span>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{c.name}</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700 }}>{c.visits.toLocaleString('fr-FR')}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      </>}

      {/* === PERFORMANCE TAB === */}
      {activeTab === 'performance' && <>
      {/* Web Core Vitals */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Web Core Vitals</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {(Object.keys(VITAL_CONFIG) as VitalKey[]).map(key => {
            const config = VITAL_CONFIG[key];
            const value = vitalsAvg ? vitalsAvg[key] : 0;
            const rating = getVitalRating(key, value);
            const isSelected = selectedVital === key;
            return (
              <div
                key={key}
                onClick={() => setSelectedVital(key)}
                style={{
                  background: isSelected ? 'var(--color-bg-tertiary)' : 'var(--color-bg)',
                  border: `2px solid ${isSelected ? config.color : 'var(--color-border)'}`,
                  borderRadius: 'var(--border-radius)',
                  padding: '1rem',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {config.label}
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: RATING_COLORS[rating], margin: '0.25rem 0' }}>
                  {vitalsAvg ? config.format(value) : '-'}
                </div>
                <div style={{
                  display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '4px',
                  fontSize: '0.7rem', fontWeight: 600,
                  backgroundColor: `${RATING_COLORS[rating]}20`, color: RATING_COLORS[rating],
                }}>
                  {rating === 'good' ? 'Bon' : rating === 'needs-improvement' ? 'A ameliorer' : 'Mauvais'}
                </div>
              </div>
            );
          })}
        </div>
        {vitalsData.length > 0 ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
                Evolution {VITAL_CONFIG[selectedVital].label}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#22c55e', marginLeft: 'auto' }}>
                Bon &le; {selectedVital === 'cls' ? VITAL_CONFIG[selectedVital].good : `${VITAL_CONFIG[selectedVital].good}ms`}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>
                Mauvais &gt; {selectedVital === 'cls' ? VITAL_CONFIG[selectedVital].poor : `${VITAL_CONFIG[selectedVital].poor}ms`}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={vitalsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tickFormatter={val => format(new Date(val), 'dd MMM', { locale: fr })} stroke="var(--color-text-secondary)" />
                <YAxis stroke="var(--color-text-secondary)" />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
                  labelFormatter={val => format(new Date(val as string), 'dd MMM yyyy', { locale: fr })}
                  formatter={(value: number) => [VITAL_CONFIG[selectedVital].format(value), VITAL_CONFIG[selectedVital].label]}
                />
                <Line type="monotone" dataKey={() => VITAL_CONFIG[selectedVital].good} name="Seuil bon" stroke="#22c55e" strokeWidth={1} strokeDasharray="8 4" dot={false} activeDot={false} />
                <Line type="monotone" dataKey={() => VITAL_CONFIG[selectedVital].poor} name="Seuil mauvais" stroke="#ef4444" strokeWidth={1} strokeDasharray="8 4" dot={false} activeDot={false} />
                <Line type="monotone" dataKey={selectedVital} name={VITAL_CONFIG[selectedVital].label} stroke={VITAL_CONFIG[selectedVital].color} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '2rem' }}><p>Pas de donnees Web Vitals</p></div>
        )}
      </div>

      {/* Page Group Metrics */}
      {sortedPageMetrics.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Metriques par page</h3>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Page</th>
                  <th style={{ textAlign: 'right' }}>Visites</th>
                  <th style={{ textAlign: 'right' }}>Rebond %</th>
                  <th style={{ textAlign: 'right' }}>Sortie %</th>
                  <th style={{ textAlign: 'right' }}>Landing %</th>
                  <th style={{ textAlign: 'right' }}>Scroll %</th>
                  <th style={{ textAlign: 'right' }}>Activite %</th>
                </tr>
              </thead>
              <tbody>
                {sortedPageMetrics.map((pg) => (
                  <React.Fragment key={pg.pageGroupId}>
                    <tr
                      onClick={async () => {
                        if (expandedPageId === pg.pageGroupId) {
                          setExpandedPageId(null);
                          setExpandedPageVitals(null);
                          return;
                        }
                        setExpandedPageId(pg.pageGroupId);
                        setExpandedPageVitals(null);
                        try {
                          const start = new Date(startDate);
                          const end = new Date(endDate);
                          const startISO = format(start, "yyyy-MM-dd'T'00:00:00.000'Z'");
                          const endISO = format(end, "yyyy-MM-dd'T'23:59:59.000'Z'");
                          const res = await api.getContentsquareWebVitals(String(pg.pageGroupId), startISO, endISO);
                          const vals = res.payload?.values || [];
                          const byMetric: Record<string, number[]> = {};
                          for (const v of vals) {
                            if (!byMetric[v.name]) byMetric[v.name] = [];
                            byMetric[v.name].push(v.value);
                          }
                          const median = (arr: number[]) => {
                            if (arr.length === 0) return 0;
                            const sorted = [...arr].sort((a, b) => a - b);
                            const mid = Math.floor(sorted.length / 2);
                            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
                          };
                          setExpandedPageVitals({
                            lcp: median(byMetric['largestContentfulPaint'] || []) * 1000,
                            inp: median(byMetric['interactionToNextPaint'] || []) * 1000,
                            cls: median(byMetric['cumulativeLayoutShift'] || []),
                            fcp: median(byMetric['firstContentfulPaint'] || []) * 1000,
                            ttfb: median(byMetric['timeToFirstByte'] || []) * 1000,
                          });
                        } catch {
                          setExpandedPageVitals({});
                        }
                      }}
                      style={{ cursor: 'pointer', backgroundColor: expandedPageId === pg.pageGroupId ? 'var(--color-bg-tertiary)' : undefined }}
                    >
                      <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                        <span style={{ marginRight: 6, fontSize: '0.7rem' }}>{expandedPageId === pg.pageGroupId ? '▼' : '▶'}</span>
                        {pg.name}
                      </td>
                      <td style={{ textAlign: 'right' }}>{pg.visits.toLocaleString('fr-FR')}</td>
                      <td style={{ textAlign: 'right' }}>{pg.bounceRate.toFixed(1)}%</td>
                      <td style={{ textAlign: 'right' }}>{pg.exitRate.toFixed(1)}%</td>
                      <td style={{ textAlign: 'right' }}>{pg.landingRate.toFixed(1)}%</td>
                      <td style={{ textAlign: 'right' }}>{pg.scrollRate.toFixed(1)}%</td>
                      <td style={{ textAlign: 'right' }}>{pg.activityRate.toFixed(1)}%</td>
                    </tr>
                    {expandedPageId === pg.pageGroupId && (
                      <tr>
                        <td colSpan={7} style={{ padding: '1rem', backgroundColor: 'var(--color-bg-tertiary)' }}>
                          {expandedPageVitals === null ? (
                            <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>Chargement Web Vitals...</div>
                          ) : Object.keys(expandedPageVitals).length === 0 ? (
                            <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>Pas de donnees Web Vitals</div>
                          ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
                              {(Object.keys(VITAL_CONFIG) as VitalKey[]).map(key => {
                                const config = VITAL_CONFIG[key];
                                const value = expandedPageVitals[key] || 0;
                                const rating = getVitalRating(key, value);
                                return (
                                  <div key={key} style={{ textAlign: 'center', padding: '0.5rem', borderRadius: '8px', backgroundColor: 'var(--color-bg-secondary)' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>{config.label}</div>
                                    <div style={{ fontSize: '1.2rem', fontWeight: 700, color: RATING_COLORS[rating], margin: '0.25rem 0' }}>
                                      {value > 0 ? config.format(value) : '-'}
                                    </div>
                                    <div style={{
                                      display: 'inline-block', padding: '0.1rem 0.4rem', borderRadius: '4px',
                                      fontSize: '0.65rem', fontWeight: 600,
                                      backgroundColor: `${RATING_COLORS[rating]}20`, color: RATING_COLORS[rating],
                                    }}>
                                      {rating === 'good' ? 'Bon' : rating === 'needs-improvement' ? 'A ameliorer' : 'Mauvais'}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Page Detailed Metrics (MCP) */}
      {pageDetailedMetrics.length > 0 && (
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Analyse detaillee des pages cles</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
          {pageDetailedMetrics.map(page => (
            <div key={page.pageId} style={{
              padding: '1rem', borderRadius: '10px', border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-bg)', position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
                background: page.errorRate > 30 ? 'linear-gradient(90deg, #ef4444, #f97316)' : page.errorRate > 10 ? 'linear-gradient(90deg, #f97316, #eab308)' : 'linear-gradient(90deg, #22c55e, #3b82f6)',
              }} />
              <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem' }}>{page.name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', fontSize: '0.75rem' }}>
                <div>
                  <div style={{ color: 'var(--color-text-secondary)' }}>Visites</div>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{page.visits.toLocaleString('fr-FR')}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--color-text-secondary)' }}>Erreurs</div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: page.errorRate > 30 ? '#ef4444' : page.errorRate > 10 ? '#f97316' : '#22c55e' }}>
                    {page.errorRate}%
                  </div>
                </div>
                {page.conversionRate !== undefined && (
                <div>
                  <div style={{ color: 'var(--color-text-secondary)' }}>Conversion</div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: '#22c55e' }}>{page.conversionRate}%</div>
                </div>
                )}
              </div>
              <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {/* Scroll Rate bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem' }}>
                  <span style={{ width: '70px', color: 'var(--color-text-secondary)' }}>Scroll</span>
                  <div style={{ flex: 1, height: '6px', backgroundColor: 'var(--color-bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${page.scrollRate}%`, backgroundColor: '#3b82f6', borderRadius: '3px' }} />
                  </div>
                  <span style={{ width: '35px', textAlign: 'right', fontWeight: 600 }}>{page.scrollRate.toFixed(0)}%</span>
                </div>
                {/* Activity Rate bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem' }}>
                  <span style={{ width: '70px', color: 'var(--color-text-secondary)' }}>Activite</span>
                  <div style={{ flex: 1, height: '6px', backgroundColor: 'var(--color-bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${page.activityRate}%`, backgroundColor: '#a855f7', borderRadius: '3px' }} />
                  </div>
                  <span style={{ width: '35px', textAlign: 'right', fontWeight: 600 }}>{page.activityRate.toFixed(0)}%</span>
                </div>
                {/* Bounce vs Exit */}
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem', fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
                  <span>Rebond <strong style={{ color: page.bounceRate > 30 ? '#ef4444' : 'var(--color-text)' }}>{page.bounceRate.toFixed(1)}%</strong></span>
                  <span>Exit <strong style={{ color: page.exitRate > 30 ? '#ef4444' : 'var(--color-text)' }}>{page.exitRate.toFixed(1)}%</strong></span>
                  {page.elapsedTime > 0 && <span>Temps <strong>{page.elapsedTime.toFixed(0)}s</strong></span>}
                  <span>Charg. <strong>{(page.loadingTime * 1000).toFixed(0)}ms</strong></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
      </>}

      {/* === ERRORS TAB === */}
      {activeTab === 'errors' && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
        {/* Errors Table */}
        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Top 10 erreurs API</h3>
          {errorsAnalysis && errorsAnalysis.errors.length > 0 ? (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Methode</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Sessions</th>
                    <th style={{ textAlign: 'right' }}>Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {errorsAnalysis.errors
                    .sort((a, b) => b.sessionsImpacted - a.sessionsImpacted)
                    .map((err, i) => (
                    <tr key={i}>
                      <td style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <code style={{ backgroundColor: 'var(--color-bg-tertiary)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem' }}>
                          {err.errorUrl}
                        </code>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                          backgroundColor: err.errorMethod === 'GET' ? '#3b82f620' : '#f9731620',
                          color: err.errorMethod === 'GET' ? '#3b82f6' : '#f97316',
                        }}>
                          {err.errorMethod}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                          backgroundColor: `${statusBadgeColor(err.errorStatusCode)}20`,
                          color: statusBadgeColor(err.errorStatusCode),
                        }}>
                          {err.errorStatusCode}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {err.sessionsImpacted.toLocaleString('fr-FR')}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                        {err.totalSessions > 0 ? `${((err.sessionsImpacted / err.totalSessions) * 100).toFixed(1)}%` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '2rem' }}><p>Aucune erreur</p></div>
          )}
        </div>

        {/* Browser Breakdown */}
        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Navigateurs</h3>
          {browserPieData.length > 0 ? (
            <div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={browserPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${percent}%`}
                  >
                    {browserPieData.map((_, index) => (
                      <Cell key={index} fill={['#3b82f6', '#f97316', '#ef4444', '#22c55e'][index % 4]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
                    formatter={(value: number) => [value.toLocaleString('fr-FR'), 'Visites']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginTop: '0.75rem' }}>
                {browserData.filter(b => b.visits > 0).map((b, i) => (
                  <div key={b.name} style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem',
                    backgroundColor: 'var(--color-bg-tertiary)', borderRadius: '6px',
                  }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: ['#3b82f6', '#f97316', '#ef4444', '#22c55e'][i % 4] }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{b.name}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
                        Rebond {b.bounceRate}% | {formatDuration(b.sessionTimeAverage)}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{b.visits.toLocaleString('fr-FR')}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '2rem' }}><p>Pas de donnees</p></div>
          )}
        </div>
      </div>

      {/* Error Trends Chart */}
      {errorTrendChartData.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Tendance des erreurs (30 jours)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={errorTrendChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tickFormatter={val => format(new Date(val), 'dd MMM', { locale: fr })} stroke="var(--color-text-secondary)" />
              <YAxis stroke="var(--color-text-secondary)" />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
                labelFormatter={val => format(new Date(val as string), 'dd MMM yyyy', { locale: fr })}
                formatter={(value: number, name: string) => [
                  value.toLocaleString('fr-FR'),
                  name === 'visits' ? 'Visites' : name === 'errors' ? 'Avec erreurs' : 'Taux erreur',
                ]}
              />
              <Legend formatter={(value) => value === 'visits' ? 'Visites totales' : 'Sessions avec erreurs'} />
              <Area type="monotone" dataKey="visits" name="visits" fill="#3b82f620" stroke="#3b82f6" strokeWidth={2} />
              <Area type="monotone" dataKey="errors" name="errors" fill="#ef444420" stroke="#ef4444" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Page-level Error Trends */}
      {pageErrorTrends.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Tendance erreurs par page cle</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '1.5rem' }}>
            {pageErrorTrends.map(page => {
              const avgErrorRate = page.dailyData.length > 0
                ? page.dailyData.reduce((s, d) => s + (d.visits > 0 ? (d.visitWithErrors / d.visits) * 100 : 0), 0) / page.dailyData.length
                : 0;
              return (
                <div key={page.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{page.name}</span>
                    <span style={{
                      padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                      backgroundColor: avgErrorRate > 30 ? '#ef444420' : avgErrorRate > 15 ? '#f9731620' : '#22c55e20',
                      color: avgErrorRate > 30 ? '#ef4444' : avgErrorRate > 15 ? '#f97316' : '#22c55e',
                    }}>
                      Moy. {avgErrorRate.toFixed(1)}% erreurs
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={page.dailyData.map(d => ({
                      date: d.date,
                      visits: d.visits,
                      errors: d.visitWithErrors,
                      errorRate: d.visits > 0 ? Math.round((d.visitWithErrors / d.visits) * 1000) / 10 : 0,
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="date" tickFormatter={val => format(new Date(val), 'dd/MM', { locale: fr })} stroke="var(--color-text-secondary)" fontSize={10} />
                      <YAxis stroke="var(--color-text-secondary)" fontSize={10} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
                        labelFormatter={val => format(new Date(val as string), 'dd MMM yyyy', { locale: fr })}
                        formatter={(value: number, name: string) => [
                          value.toLocaleString('fr-FR'),
                          name === 'visits' ? 'Visites' : 'Avec erreurs',
                        ]}
                      />
                      <Area type="monotone" dataKey="visits" name="visits" fill="#3b82f615" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                      <Area type="monotone" dataKey="errors" name="errors" fill="#ef444420" stroke="#ef4444" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pages vs Errors Scatter */}
      {pagesErrorsScatter.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Pages vs Erreurs</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {pagesErrorsScatter
              .sort((a, b) => b.errorRate - a.errorRate)
              .map(page => {
              const maxVisits = Math.max(...pagesErrorsScatter.map(p => p.visits));
              const barWidth = (page.visits / maxVisits) * 100;
              return (
                <div key={page.pageId} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ width: '180px', fontSize: '0.8rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {page.name}
                  </div>
                  <div style={{ flex: 1, position: 'relative', height: '28px', backgroundColor: 'var(--color-bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: '4px',
                      backgroundColor: '#3b82f630', width: `${barWidth}%`,
                    }} />
                    <div style={{
                      position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: '4px',
                      backgroundColor: page.errorRate > 30 ? '#ef444480' : page.errorRate > 15 ? '#f9731680' : '#22c55e80',
                      width: `${(page.visitWithErrors / maxVisits) * 100}%`,
                    }} />
                  </div>
                  <div style={{ width: '60px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 700,
                    color: page.errorRate > 30 ? '#ef4444' : page.errorRate > 15 ? '#f97316' : '#22c55e',
                  }}>
                    {page.errorRate.toFixed(1)}%
                  </div>
                  <div style={{ width: '70px', textAlign: 'right', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                    {page.visitWithErrors.toLocaleString('fr-FR')}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, backgroundColor: '#3b82f630', marginRight: 4 }} />Visites totales</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, backgroundColor: '#ef444480', marginRight: 4 }} />Sessions avec erreurs</span>
          </div>
        </div>
      )}

      {/* Lost Conversions */}
      {lostConversions.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Conversions perdues (erreurs)</h3>
            <span style={{
              padding: '4px 12px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 700,
              backgroundColor: '#ef444420', color: '#ef4444',
            }}>
              {totalLostConversions.toLocaleString('fr-FR')} perdues
            </span>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Page</th>
                  <th style={{ textAlign: 'right' }}>Conversions perdues</th>
                  <th style={{ textAlign: 'right' }}>Sessions erreurs</th>
                  <th style={{ textAlign: 'right' }}>Nb erreurs</th>
                  <th style={{ textAlign: 'right' }}>Impact</th>
                </tr>
              </thead>
              <tbody>
                {lostConversions.map(page => {
                  const pctOfTotal = totalLostConversions > 0 ? (page.lostConversions / totalLostConversions) * 100 : 0;
                  return (
                    <tr key={page.pageId}>
                      <td style={{ fontWeight: 500, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {page.name}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: '#ef4444' }}>
                          {page.lostConversions.toLocaleString('fr-FR')}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{page.visitWithErrors.toLocaleString('fr-FR')}</td>
                      <td style={{ textAlign: 'right' }}>{page.errorsCount}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        }}>
                          <div style={{
                            width: '40px', height: '6px', borderRadius: '3px',
                            backgroundColor: 'var(--color-bg-tertiary)', overflow: 'hidden',
                          }}>
                            <div style={{
                              height: '100%', borderRadius: '3px', backgroundColor: '#ef4444',
                              width: `${Math.min(pctOfTotal, 100)}%`,
                            }} />
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                            {pctOfTotal.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>}

      {/* === BEHAVIOR TAB === */}
      {activeTab === 'behavior' && <>
      {/* Conversion Funnels */}
      {conversionFunnels.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Parcours de conversion</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
            {conversionFunnels.map(funnel => {
              const maxSessions = funnel.steps[0]?.sessions || 1;
              const convRate = funnel.steps.length >= 2
                ? ((funnel.steps[funnel.steps.length - 1].sessions / funnel.steps[0].sessions) * 100).toFixed(1)
                : '0';
              return (
                <div key={funnel.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{funnel.name}</span>
                    <span style={{
                      padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700,
                      backgroundColor: '#22c55e20', color: '#22c55e',
                    }}>
                      {convRate}% conversion
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {funnel.steps.map((step, i) => {
                      const pct = (step.sessions / maxSessions) * 100;
                      const dropoff = i > 0 ? ((1 - step.sessions / funnel.steps[i - 1].sessions) * 100).toFixed(0) : null;
                      const colors = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#c084fc', '#d8b4fe', '#22c55e', '#10b981'];
                      return (
                        <div key={i}>
                          {dropoff && Number(dropoff) > 10 && (
                            <div style={{ textAlign: 'right', fontSize: '0.65rem', color: '#ef4444', padding: '0 4px', lineHeight: 1.2 }}>
                              -{dropoff}%
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{
                              height: '28px', borderRadius: '4px', backgroundColor: colors[i % colors.length],
                              width: `${Math.max(pct, 8)}%`, display: 'flex', alignItems: 'center', paddingLeft: '8px',
                              transition: 'width 0.5s ease', minWidth: '80px',
                            }}>
                              <span style={{ fontSize: '0.7rem', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {step.name}
                              </span>
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              {step.sessions.toLocaleString('fr-FR')}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Landing Pages */}
      {landingPages.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Pages d'entree (Landing)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {landingPages.map(page => {
              const maxSessions = landingPages[0]?.sessions || 1;
              const pct = (page.sessions / maxSessions) * 100;
              return (
                <div key={page.name} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ width: '180px', fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {page.name}
                  </div>
                  <div style={{ flex: 1, height: '24px', backgroundColor: 'var(--color-bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: '4px',
                      backgroundColor: page.exitRate > 50 ? '#ef4444' : page.exitRate > 20 ? '#f97316' : '#3b82f6',
                      width: `${pct}%`, transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <div style={{ width: '70px', textAlign: 'right', fontSize: '0.85rem', fontWeight: 700 }}>
                    {page.sessions.toLocaleString('fr-FR')}
                  </div>
                  <div style={{
                    width: '55px', textAlign: 'right', fontSize: '0.75rem',
                    color: page.exitRate > 50 ? '#ef4444' : page.exitRate > 20 ? '#f97316' : 'var(--color-text-secondary)',
                  }}>
                    {page.exitRate}% exit
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Funnel Analysis (MCP) */}
      {funnelData.length > 0 && funnelData.map(funnel => {
        const maxSessions = funnel.steps[0]?.sessions || 1;
        const overallConv = ((funnel.steps[funnel.steps.length - 1].sessions / maxSessions) * 100).toFixed(1);
        return (
        <div key={funnel.name} className="card" style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Analyse funnel : {funnel.name}</h3>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>Conversion globale</span>
              <span style={{
                padding: '4px 12px', borderRadius: '6px', fontWeight: 700, fontSize: '1rem',
                backgroundColor: Number(overallConv) > 5 ? '#22c55e20' : '#ef444420',
                color: Number(overallConv) > 5 ? '#22c55e' : '#ef4444',
              }}>{overallConv}%</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {funnel.steps.map((step, i) => {
              const pct = (step.sessions / maxSessions) * 100;
              const isLargeDropOff = step.stepDropOff > 50;
              return (
                <div key={i}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0' }}>
                    <div style={{
                      width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                      backgroundColor: i === funnel.steps.length - 1 ? '#22c55e' : '#3b82f6',
                    }}>{i + 1}</div>
                    <div style={{ width: '200px' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{step.name}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
                        {step.sessions.toLocaleString('fr-FR')} sessions
                      </div>
                    </div>
                    <div style={{ flex: 1, position: 'relative', height: '32px' }}>
                      <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'var(--color-bg-tertiary)', borderRadius: '6px',
                      }} />
                      <div style={{
                        position: 'absolute', top: 0, left: 0, bottom: 0,
                        width: `${pct}%`, borderRadius: '6px', transition: 'width 0.5s ease',
                        background: i === funnel.steps.length - 1
                          ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                          : `linear-gradient(90deg, #3b82f6, #6366f1)`,
                        opacity: 0.8 + (pct / 500),
                      }} />
                      <div style={{
                        position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: '8px',
                        fontSize: '0.75rem', fontWeight: 700, color: pct > 15 ? '#fff' : 'var(--color-text)',
                      }}>
                        {pct.toFixed(1)}%
                      </div>
                    </div>
                    {step.timeToCompletion > 0 && (
                      <div style={{ width: '65px', textAlign: 'right', fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
                        {step.timeToCompletion >= 60 ? `${Math.floor(step.timeToCompletion / 60)}m ${step.timeToCompletion % 60}s` : `${step.timeToCompletion}s`}
                      </div>
                    )}
                  </div>
                  {i < funnel.steps.length - 1 && step.stepDropOff > 0 && (
                    <div style={{
                      marginLeft: '14px', borderLeft: `2px ${isLargeDropOff ? 'solid' : 'dashed'} ${isLargeDropOff ? '#ef4444' : '#94a3b8'}`,
                      paddingLeft: '28px', paddingTop: '2px', paddingBottom: '2px',
                      fontSize: '0.7rem', color: isLargeDropOff ? '#ef4444' : 'var(--color-text-secondary)',
                      fontWeight: isLargeDropOff ? 600 : 400,
                    }}>
                      ↓ {step.stepDropOff.toFixed(1)}% abandon ({(funnel.steps[i].sessions - funnel.steps[i + 1].sessions).toLocaleString('fr-FR')} sessions)
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        );
      })}

      {/* Exit Pages (Reverse Journey) */}
      {exitPages.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Pages de sortie (Exit)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {exitPages.map(page => {
              const maxSessions = exitPages[0]?.sessions || 1;
              const pct = (page.sessions / maxSessions) * 100;
              return (
                <div key={page.name} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ width: '200px', fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {page.name}
                  </div>
                  <div style={{ flex: 1, height: '24px', backgroundColor: 'var(--color-bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: '4px',
                      backgroundColor: page.percentage > 30 ? '#ef4444' : page.percentage > 10 ? '#f97316' : '#3b82f6',
                      width: `${pct}%`, transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <div style={{ width: '70px', textAlign: 'right', fontSize: '0.85rem', fontWeight: 700 }}>
                    {page.sessions.toLocaleString('fr-FR')}
                  </div>
                  <div style={{
                    width: '55px', textAlign: 'right', fontSize: '0.75rem',
                    color: page.percentage > 30 ? '#ef4444' : page.percentage > 10 ? '#f97316' : 'var(--color-text-secondary)',
                  }}>
                    {page.percentage.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Exit Paths */}
      {exitPaths.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Principaux chemins de sortie</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {exitPaths.map((path, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--color-bg-tertiary)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1, fontSize: '0.85rem', overflow: 'hidden' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                    backgroundColor: '#3b82f620', color: '#3b82f6', whiteSpace: 'nowrap',
                  }}>{path.to2}</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>→</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                    backgroundColor: '#f9731620', color: '#f97316', whiteSpace: 'nowrap',
                  }}>{path.to}</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>→</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                    backgroundColor: '#ef444420', color: '#ef4444', whiteSpace: 'nowrap',
                  }}>{path.from}</span>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.7rem' }}>→ EXIT</span>
                </div>
                <span style={{ fontWeight: 700, fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                  {path.sessions.toLocaleString('fr-FR')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two columns: Device + Country */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
        {/* Device Breakdown */}
        {deviceData.length > 0 && (
          <div className="card">
            <h3 style={{ marginBottom: '1rem' }}>Appareils</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {deviceData.filter(d => d.visits > 0).map(device => {
                const totalVisits = deviceData.reduce((s, d) => s + d.visits, 0);
                const pct = totalVisits > 0 ? (device.visits / totalVisits) * 100 : 0;
                const color = device.name === 'Desktop' ? '#3b82f6' : device.name === 'Mobile' ? '#a855f7' : '#22c55e';
                return (
                  <div key={device.name} style={{
                    padding: '1rem', borderRadius: '8px', border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '1.2rem' }}>
                          {device.name === 'Desktop' ? '🖥' : device.name === 'Mobile' ? '📱' : '📟'}
                        </span>
                        <span style={{ fontWeight: 600 }}>{device.name}</span>
                      </div>
                      <span style={{ fontWeight: 700, color }}>{pct.toFixed(1)}%</span>
                    </div>
                    <div style={{
                      height: '6px', borderRadius: '3px', backgroundColor: 'var(--color-bg-tertiary)',
                      overflow: 'hidden', marginBottom: '0.75rem',
                    }}>
                      <div style={{ height: '100%', borderRadius: '3px', backgroundColor: color, width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', fontSize: '0.75rem' }}>
                      <div>
                        <div style={{ color: 'var(--color-text-secondary)' }}>Visites</div>
                        <div style={{ fontWeight: 600 }}>{device.visits.toLocaleString('fr-FR')}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--color-text-secondary)' }}>Rebond</div>
                        <div style={{ fontWeight: 600 }}>{device.bounceRate}%</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--color-text-secondary)' }}>Duree</div>
                        <div style={{ fontWeight: 600 }}>{formatDuration(device.sessionTimeAverage)}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--color-text-secondary)' }}>Pages</div>
                        <div style={{ fontWeight: 600 }}>{device.pageviewAverage.toFixed(1)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Country Breakdown */}
        {countryData.length > 0 && (
          <div className="card">
            <h3 style={{ marginBottom: '1rem' }}>Pays</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {countryData.map(country => {
                const totalVisits = countryData.reduce((s, c) => s + c.visits, 0);
                const pct = totalVisits > 0 ? (country.visits / totalVisits) * 100 : 0;
                const errPct = country.visits > 0 ? (country.visitWithErrors / country.visits) * 100 : 0;
                const flag = { FR: '🇫🇷', ES: '🇪🇸', FI: '🇫🇮', CH: '🇨🇭' }[country.code] || '🌍';
                return (
                  <div key={country.code} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem',
                    borderRadius: '8px', backgroundColor: 'var(--color-bg-tertiary)',
                  }}>
                    <span style={{ fontSize: '1.5rem' }}>{flag}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{country.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                        Rebond {country.bounceRate}% | Erreurs {errPct.toFixed(1)}%
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: '1rem' }}>{country.visits.toLocaleString('fr-FR')}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>{pct.toFixed(1)}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* City Breakdown */}
      {cityData.length > 0 && (
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Repartition par ville</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {cityData.filter(c => c.visits > 100).map(city => {
            const maxVisits = Math.max(...cityData.map(c => c.visits));
            const barWidth = (city.visits / maxVisits) * 100;
            return (
              <div key={city.name} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: '140px', fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {city.name}
                </div>
                <div style={{ flex: 1, height: '28px', backgroundColor: 'var(--color-bg-tertiary)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                  <div style={{
                    height: '100%', borderRadius: '4px',
                    background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                    width: `${barWidth}%`, transition: 'width 0.5s ease',
                  }} />
                  <span style={{
                    position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: '8px',
                    fontSize: '0.75rem', fontWeight: 600, color: barWidth > 20 ? '#fff' : 'var(--color-text)',
                  }}>
                    {city.percentage >= 1 ? `${city.percentage.toFixed(1)}%` : `${city.percentage.toFixed(2)}%`}
                  </span>
                </div>
                <div style={{ width: '80px', textAlign: 'right', fontSize: '0.85rem', fontWeight: 700 }}>
                  {city.visits.toLocaleString('fr-FR')}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
          Note : "(non defini)" correspond aux sessions sans geolocalisation precise (proxies, VPN)
        </div>
      </div>
      )}

      {/* Screen Resolution Breakdown */}
      {screenResolutions.length > 0 && (
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Resolutions d'ecran</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={screenResolutions.slice(0, 8).map(r => ({
            label: `${r.width}px`,
            visits: r.visits,
            percentage: r.percentage,
          }))} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis type="number" stroke="var(--color-text-secondary)" tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
            <YAxis type="category" dataKey="label" stroke="var(--color-text-secondary)" width={70} />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
              formatter={(value: number) => [value.toLocaleString('fr-FR'), 'Visites']}
            />
            <Bar dataKey="visits" fill="#06b6d4" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '0.5rem', marginTop: '0.75rem' }}>
          {screenResolutions.slice(0, 4).map(r => (
            <div key={r.width} style={{
              padding: '0.5rem', borderRadius: '8px', backgroundColor: 'var(--color-bg-tertiary)', textAlign: 'center',
            }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#06b6d4' }}>{r.percentage.toFixed(1)}%</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{r.width}px</div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Platform/OS Breakdown */}
      {platformData.length > 0 && (
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Systeme d'exploitation</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
          {platformData.map(p => {
            const icon = p.name === 'Windows' ? '🪟' : p.name === 'Mac OS' ? '🍎' : p.name === 'Android' ? '🤖' : p.name === 'iOS' ? '📱' : '💻';
            const color = p.name === 'Windows' ? '#0078d4' : p.name === 'Mac OS' ? '#555' : p.name === 'Android' ? '#3ddc84' : '#999';
            return (
              <div key={p.name} style={{
                padding: '1rem', borderRadius: '10px', border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-bg)', textAlign: 'center', position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', backgroundColor: color }} />
                <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>{icon}</div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>{p.name}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color, margin: '0.5rem 0' }}>
                  {p.percentage >= 1 ? `${p.percentage.toFixed(1)}%` : p.visits.toLocaleString('fr-FR')}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                  {p.visits.toLocaleString('fr-FR')} visites
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                  Rebond {p.bounceRate}% | {formatDuration(p.sessionTimeAverage)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}
      </>}

      {/* === OVERVIEW TAB continued: Weekly charts === */}
      {activeTab === 'overview' && <>
      {/* Weekly Bar Chart */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Comparaison semaine par semaine</h3>
        {weeklyData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="weekLabel" stroke="var(--color-text-secondary)" />
              <YAxis stroke="var(--color-text-secondary)" />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
              />
              <Legend />
              <Bar dataKey="visits" name="Visites" fill={COLORS.visits} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state" style={{ padding: '2rem' }}><p>Pas de donnees hebdomadaires</p></div>
        )}
      </div>

      {/* Weekly recap table */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Recapitulatif hebdomadaire</h3>
        {weeklyWithDelta.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Semaine</th>
                  <th style={{ textAlign: 'right' }}>Visites</th>
                  <th style={{ textAlign: 'right' }}>Delta</th>
                  <th style={{ textAlign: 'right' }}>Rebond</th>
                  <th style={{ textAlign: 'right' }}>Delta</th>
                  <th style={{ textAlign: 'right' }}>Duree moy.</th>
                  <th style={{ textAlign: 'right' }}>Delta</th>
                  <th style={{ textAlign: 'right' }}>Pages/vis.</th>
                  <th style={{ textAlign: 'right' }}>Delta</th>
                </tr>
              </thead>
              <tbody>
                {weeklyWithDelta.map((week, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{week.weekLabel}</td>
                    <td style={{ textAlign: 'right' }}>{week.visits.toLocaleString('fr-FR')}</td>
                    <td style={{ textAlign: 'right' }}>
                      {week.visitsDelta && (
                        <span style={{ color: week.visitsDelta.positive ? '#22c55e' : '#ef4444', fontSize: '0.85rem' }}>
                          {week.visitsDelta.value}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{week.bounceRate}%</td>
                    <td style={{ textAlign: 'right' }}>
                      {week.bounceDelta && (
                        <span style={{ color: !week.bounceDelta.positive ? '#22c55e' : '#ef4444', fontSize: '0.85rem' }}>
                          {week.bounceDelta.value}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{formatDuration(week.avgSessionTime)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {week.sessionDelta && (
                        <span style={{ color: week.sessionDelta.positive ? '#22c55e' : '#ef4444', fontSize: '0.85rem' }}>
                          {week.sessionDelta.value}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{week.pagesPerVisit}</td>
                    <td style={{ textAlign: 'right' }}>
                      {week.pagesDelta && (
                        <span style={{ color: week.pagesDelta.positive ? '#22c55e' : '#ef4444', fontSize: '0.85rem' }}>
                          {week.pagesDelta.value}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '2rem' }}><p>Pas de donnees</p></div>
        )}
      </div>
      </>}
    </div>
  );
}

function Sparkline({ data, color, width = 80, height = 24 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block', marginTop: '0.25rem' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DeltaBadge({ value, positive, invertColor }: { value: string; positive: boolean; invertColor?: boolean }) {
  const isGood = invertColor ? !positive : positive;
  return (
    <div style={{
      marginTop: '0.25rem',
      fontSize: '0.8rem',
      fontWeight: 600,
      color: isGood ? '#22c55e' : '#ef4444',
    }}>
      {value}
    </div>
  );
}
