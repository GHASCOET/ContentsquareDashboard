import { useState, useEffect, useMemo } from 'react';
import { api, CSMetricValue, CSErrorItem, CSDeviceData, CSGoal } from '../services/api';
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
  PieChart,
  Pie,
  Cell,
  Legend,
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

interface DeviceBreakdown {
  desktop: CSDeviceData;
  mobile: CSDeviceData;
  tablet: CSDeviceData;
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

  // Chunk into MAX_CHUNK_DAYS segments
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
  const [deviceBreakdown, setDeviceBreakdown] = useState<DeviceBreakdown | null>(null);
  const [vitalsData, setVitalsData] = useState<DailyVitals[]>([]);
  const [selectedVital, setSelectedVital] = useState<VitalKey>('lcp');
  const [goals, setGoals] = useState<CSGoal[]>([]);
  const [pageMetrics, setPageMetrics] = useState<PageGroupMetrics[]>([]);

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

      // Fetch device breakdown
      try {
        const startISO = format(start, "yyyy-MM-dd'T'00:00:00.000'Z'");
        const endISO = format(end, "yyyy-MM-dd'T'23:59:59.000'Z'");
        const devRes = await api.getDeviceBreakdown(startISO, endISO);
        setDeviceBreakdown({ desktop: devRes.desktop, mobile: devRes.mobile, tablet: devRes.tablet });
      } catch {
        setDeviceBreakdown(null);
      }

      // Fetch goals
      try {
        const goalsRes = await api.getGoals();
        setGoals(goalsRes.payload || []);
      } catch {
        setGoals([]);
      }

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

  const devicePieData = useMemo(() => {
    if (!deviceBreakdown) return [];
    return [
      { name: 'Desktop', value: deviceBreakdown.desktop.visits, color: '#3b82f6' },
      { name: 'Mobile', value: deviceBreakdown.mobile.visits, color: '#a855f7' },
      { name: 'Tablet', value: deviceBreakdown.tablet.visits, color: '#22c55e' },
    ].filter(d => d.value > 0);
  }, [deviceBreakdown]);

  const sortedPageMetrics = useMemo(() => {
    return [...pageMetrics].sort((a, b) => b.visits - a.visits);
  }, [pageMetrics]);

  const setPreset = (days: number) => {
    setEndDate(format(new Date(), 'yyyy-MM-dd'));
    setStartDate(format(subDays(new Date(), days), 'yyyy-MM-dd'));
  };

  if (loading) {
    return <div className="loading">Chargement Contentsquare...</div>;
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

      {/* KPI Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value" style={{ color: COLORS.visits }}>
            {kpis ? kpis.totalVisits.toLocaleString('fr-FR') : '-'}
          </div>
          <div className="stat-label">Visites</div>
          {compareEnabled && prevKpis && kpis && (
            <DeltaBadge {...formatDelta(kpis.totalVisits, prevKpis.totalVisits)} />
          )}
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: COLORS.bounce }}>
            {kpis ? `${kpis.avgBounce.toFixed(1)}%` : '-'}
          </div>
          <div className="stat-label">Taux de rebond</div>
          {compareEnabled && prevKpis && kpis && (
            <DeltaBadge {...formatDelta(kpis.avgBounce, prevKpis.avgBounce)} invertColor />
          )}
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: COLORS.sessionTime }}>
            {kpis ? formatDuration(kpis.avgSession) : '-'}
          </div>
          <div className="stat-label">Duree moy. session</div>
          {compareEnabled && prevKpis && kpis && (
            <DeltaBadge {...formatDelta(kpis.avgSession, prevKpis.avgSession)} />
          )}
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: COLORS.pagesPerVisit }}>
            {kpis ? kpis.avgPages.toFixed(1) : '-'}
          </div>
          <div className="stat-label">Pages / visite</div>
          {compareEnabled && prevKpis && kpis && (
            <DeltaBadge {...formatDelta(kpis.avgPages, prevKpis.avgPages)} />
          )}
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

      {/* Goals / Conversions */}
      {goals.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
          {goals.map(goal => (
            <div key={goal.id} className="stat-card">
              <div className="stat-value" style={{ color: '#8b5cf6', fontSize: '1.2rem' }}>
                {goal.name}
              </div>
              <div className="stat-label">
                {goal.type === 'click' ? 'Objectif clic' : goal.type === 'pageview' ? 'Objectif page vue' : goal.type}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
                ID: {goal.id}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Line Chart */}
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

      {/* Web Core Vitals */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Web Core Vitals</h3>

        {/* Vitals KPI cards */}
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
                  display: 'inline-block',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  backgroundColor: `${RATING_COLORS[rating]}20`,
                  color: RATING_COLORS[rating],
                }}>
                  {rating === 'good' ? 'Bon' : rating === 'needs-improvement' ? 'A ameliorer' : 'Mauvais'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Vitals evolution chart */}
        {vitalsData.length > 0 ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
                Evolution {VITAL_CONFIG[selectedVital].label}
              </span>
              {/* Threshold lines legend */}
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
                  formatter={(value: number) => [VITAL_CONFIG[selectedVital].format(value), VITAL_CONFIG[selectedVital].label]}
                />
                {/* Good threshold */}
                <Line
                  type="monotone"
                  dataKey={() => VITAL_CONFIG[selectedVital].good}
                  name="Seuil bon"
                  stroke="#22c55e"
                  strokeWidth={1}
                  strokeDasharray="8 4"
                  dot={false}
                  activeDot={false}
                />
                {/* Poor threshold */}
                <Line
                  type="monotone"
                  dataKey={() => VITAL_CONFIG[selectedVital].poor}
                  name="Seuil mauvais"
                  stroke="#ef4444"
                  strokeWidth={1}
                  strokeDasharray="8 4"
                  dot={false}
                  activeDot={false}
                />
                <Line
                  type="monotone"
                  dataKey={selectedVital}
                  name={VITAL_CONFIG[selectedVital].label}
                  stroke={VITAL_CONFIG[selectedVital].color}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '2rem' }}>
            <p>Pas de donnees Web Vitals</p>
          </div>
        )}
      </div>

      {/* Two columns: Errors + Device Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
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
                  </tr>
                </thead>
                <tbody>
                  {errorsAnalysis.errors
                    .sort((a, b) => b.sessionsImpacted - a.sessionsImpacted)
                    .map((err, i) => (
                    <tr key={i}>
                      <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <code style={{ backgroundColor: 'var(--color-bg-tertiary)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem' }}>
                          {err.errorUrl}
                        </code>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          backgroundColor: err.errorMethod === 'GET' ? '#3b82f620' : '#f9731620',
                          color: err.errorMethod === 'GET' ? '#3b82f6' : '#f97316',
                        }}>
                          {err.errorMethod}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          backgroundColor: `${statusBadgeColor(err.errorStatusCode)}20`,
                          color: statusBadgeColor(err.errorStatusCode),
                        }}>
                          {err.errorStatusCode}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {err.sessionsImpacted.toLocaleString('fr-FR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <p>Aucune erreur</p>
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Appareils</h3>
          {devicePieData.length > 0 ? (
            <div>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={devicePieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                  >
                    {devicePieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number) => [value.toLocaleString('fr-FR'), 'Visites']}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Mini-stats: bounce rate per device */}
              {deviceBreakdown && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                  {([
                    { label: 'Desktop', data: deviceBreakdown.desktop, color: '#3b82f6' },
                    { label: 'Mobile', data: deviceBreakdown.mobile, color: '#a855f7' },
                    { label: 'Tablet', data: deviceBreakdown.tablet, color: '#22c55e' },
                  ] as const).map(({ label, data, color }) => (
                    <div key={label} style={{ textAlign: 'center', padding: '0.5rem', borderRadius: '8px', backgroundColor: 'var(--color-bg-tertiary)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color }}>
                        {data.bounceRate.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>rebond</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <p>Pas de donnees appareils</p>
            </div>
          )}
        </div>
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
                  <tr key={pg.pageGroupId}>
                    <td style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                      {pg.name}
                    </td>
                    <td style={{ textAlign: 'right' }}>{pg.visits.toLocaleString('fr-FR')}</td>
                    <td style={{ textAlign: 'right' }}>{pg.bounceRate.toFixed(1)}%</td>
                    <td style={{ textAlign: 'right' }}>{pg.exitRate.toFixed(1)}%</td>
                    <td style={{ textAlign: 'right' }}>{pg.landingRate.toFixed(1)}%</td>
                    <td style={{ textAlign: 'right' }}>{pg.scrollRate.toFixed(1)}%</td>
                    <td style={{ textAlign: 'right' }}>{pg.activityRate.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
                contentStyle={{
                  backgroundColor: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Bar dataKey="visits" name="Visites" fill={COLORS.visits} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state" style={{ padding: '2rem' }}>
            <p>Pas de donnees hebdomadaires</p>
          </div>
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
          <div className="empty-state" style={{ padding: '2rem' }}>
            <p>Pas de donnees</p>
          </div>
        )}
      </div>
    </div>
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
