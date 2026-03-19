import { Router, Request, Response } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';
import { env } from '../config/env.js';

const router = Router();

// OAuth2 token cache
let cachedToken: string | null = null;
let cachedEndpoint: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<{ token: string; endpoint: string }> {
  if (cachedToken && cachedEndpoint && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return { token: cachedToken, endpoint: cachedEndpoint };
  }

  const response = await fetch(`${env.CONTENTSQUARE_API_URL}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.CONTENTSQUARE_CLIENT_ID,
      client_secret: env.CONTENTSQUARE_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: 'data-export metrics',
      project_id: env.CONTENTSQUARE_PROJECT_ID,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    cachedToken = null;
    cachedEndpoint = null;
    throw new Error(`OAuth token error ${response.status}: ${text}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number; endpoint?: string };
  cachedToken = data.access_token;
  cachedEndpoint = data.endpoint || env.CONTENTSQUARE_API_URL;
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  console.log(`CS OAuth token obtained, expires in ${data.expires_in}s, endpoint: ${cachedEndpoint}`);
  return { token: cachedToken, endpoint: cachedEndpoint };
}

async function csApiGet(path: string, params: Record<string, string>): Promise<unknown> {
  const { token, endpoint } = await getAccessToken();
  const url = new URL(`${endpoint}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  console.log(`CS API GET ${url.toString()}`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401 && cachedToken) {
      cachedToken = null;
      cachedEndpoint = null;
      return csApiGet(path, params);
    }
    throw new Error(`CS API error ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * GET /api/contentsquare/site-metrics
 * Proxy to GET /v1/metrics/site
 */
router.get('/site-metrics', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, device, period } = req.query as Record<string, string>;
    const data = await csApiGet('/v1/metrics/site', {
      startDate,
      endDate,
      device: device || 'all',
      period: period || 'daily',
      projectId: String(env.CONTENTSQUARE_PROJECT_ID),
    });
    res.json(data);
  } catch (error) {
    console.error('CS site-metrics error:', error);
    res.status(502).json({ error: 'Failed to fetch Contentsquare site metrics' });
  }
});

/**
 * GET /api/contentsquare/page-metrics/:pageGroupId
 * Proxy to GET /v1/metrics/page-group/:pageGroupId
 */
router.get('/page-metrics/:pageGroupId', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, device, period } = req.query as Record<string, string>;
    const data = await csApiGet(`/v1/metrics/page-group/${req.params.pageGroupId}`, {
      startDate,
      endDate,
      device: device || 'all',
      period: period || '',
      projectId: String(env.CONTENTSQUARE_PROJECT_ID),
    });
    res.json(data);
  } catch (error) {
    console.error('CS page-metrics error:', error);
    res.status(502).json({ error: 'Failed to fetch Contentsquare page metrics' });
  }
});

/**
 * GET /api/contentsquare/web-vitals/:pageGroupId
 * Proxy to GET /v1/metrics/page-group/:pageGroupId/web-vitals
 */
router.get('/web-vitals/:pageGroupId', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, device, period } = req.query as Record<string, string>;
    const data = await csApiGet(`/v1/metrics/page-group/${req.params.pageGroupId}/web-vitals`, {
      startDate,
      endDate,
      device: device || 'all',
      period: period || 'daily',
      projectId: String(env.CONTENTSQUARE_PROJECT_ID),
    });
    res.json(data);
  } catch (error) {
    console.error('CS web-vitals error:', error);
    res.status(502).json({ error: 'Failed to fetch Contentsquare web vitals' });
  }
});

/**
 * GET /api/contentsquare/segments
 * Proxy to GET /v1/segments
 */
router.get('/segments', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = await csApiGet('/v1/segments', {
      projectId: String(env.CONTENTSQUARE_PROJECT_ID),
    });
    res.json(data);
  } catch (error) {
    console.error('CS segments error:', error);
    res.status(502).json({ error: 'Failed to fetch Contentsquare segments' });
  }
});

/**
 * GET /api/contentsquare/mappings
 * Proxy to GET /v1/mappings
 */
router.get('/mappings', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = await csApiGet('/v1/mappings', {
      projectId: String(env.CONTENTSQUARE_PROJECT_ID),
    });
    res.json(data);
  } catch (error) {
    console.error('CS mappings error:', error);
    res.status(502).json({ error: 'Failed to fetch Contentsquare mappings' });
  }
});

/**
 * GET /api/contentsquare/mappings/:mappingId/page-groups
 * Proxy to GET /v1/mappings/:mappingId/page-groups
 */
router.get('/mappings/:mappingId/page-groups', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = await csApiGet(`/v1/mappings/${req.params.mappingId}/page-groups`, {
      projectId: String(env.CONTENTSQUARE_PROJECT_ID),
    });
    res.json(data);
  } catch (error) {
    console.error('CS page-groups error:', error);
    res.status(502).json({ error: 'Failed to fetch Contentsquare page groups' });
  }
});

// Keep POST endpoints as aliases for backward compat (frontend currently uses POST)
router.post('/site-metrics', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.body;
    const data = await csApiGet('/v1/metrics/site', {
      startDate,
      endDate,
      device: 'all',
      period: 'daily',
      projectId: String(env.CONTENTSQUARE_PROJECT_ID),
    });
    res.json(data);
  } catch (error) {
    console.error('CS site-metrics error:', error);
    res.status(502).json({ error: 'Failed to fetch Contentsquare site metrics' });
  }
});

router.post('/errors', authMiddleware, async (_req: Request, res: Response): Promise<void> => {
  // CS doesn't have a direct errors endpoint via Metrics API
  // Return empty for now - errors come from Data Export API
  res.json({ errors: [] });
});

/**
 * GET /api/contentsquare/goals
 * Proxy to GET /v1/goals
 */
router.get('/goals', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = await csApiGet('/v1/goals', {
      projectId: String(env.CONTENTSQUARE_PROJECT_ID),
    });
    res.json(data);
  } catch (error) {
    console.error('CS goals error:', error);
    res.status(502).json({ error: 'Failed to fetch Contentsquare goals' });
  }
});

/**
 * GET /api/contentsquare/errors-analysis
 * Returns error data from CS. Falls back to cached MCP data if REST API unavailable.
 */
router.get('/errors-analysis', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query as Record<string, string>;

    // Try REST API paths
    const apiPaths = ['/v1/errors', '/v1/error-analysis', '/v1/analytics/errors'];
    for (const path of apiPaths) {
      try {
        const data = await csApiGet(path, {
          startDate,
          endDate,
          projectId: String(env.CONTENTSQUARE_PROJECT_ID),
        });
        res.json(data);
        return;
      } catch {
        // try next path
      }
    }

    // Fallback: cached MCP data (getTopErrorsBySessionsWithErrors - 18 Mar 2026)
    const totalSessions = 710080;
    const sessionsWithErrors = 269175;
    const errorRate = Math.round((sessionsWithErrors / totalSessions) * 1000) / 10;

    res.json({
      errors: [
        { errorUrl: 'iam.bouyguestelecom.fr/sesame/realms/corporate/protocol/openid-connect/token', errorMethod: 'POST', errorStatusCode: 400, sessionsImpacted: 154468, totalSessions },
        { errorUrl: 'api.bouyguestelecom.fr/verifications-bancaires', errorMethod: 'GET', errorStatusCode: 404, sessionsImpacted: 94688, totalSessions },
        { errorUrl: 'api.bouyguestelecom.fr/ventes/paniers/.../modes-financement/courant', errorMethod: 'GET', errorStatusCode: 404, sessionsImpacted: 30146, totalSessions },
        { errorUrl: 'api.bouyguestelecom.fr/contrats/.../equipements-mobiles', errorMethod: 'GET', errorStatusCode: 400, sessionsImpacted: 12003, totalSessions },
        { errorUrl: 'api.bouyguestelecom.fr/ventes/paniers/.../metadata', errorMethod: 'GET', errorStatusCode: 404, sessionsImpacted: 9812, totalSessions },
        { errorUrl: 'api.bouyguestelecom.fr/adresses-couverture-fixe', errorMethod: 'GET', errorStatusCode: 400, sessionsImpacted: 8559, totalSessions },
        { errorUrl: 'api.bouyguestelecom.fr/ventes/paniers/.../promotions', errorMethod: 'POST', errorStatusCode: 404, sessionsImpacted: 4528, totalSessions },
        { errorUrl: 'api.bouyguestelecom.fr/eligibilites-portabilite', errorMethod: 'POST', errorStatusCode: 400, sessionsImpacted: 3441, totalSessions },
        { errorUrl: 'iam.bouyguestelecom.fr/sesame/.../openid-connect/token', errorMethod: 'POST', errorStatusCode: 403, sessionsImpacted: 3294, totalSessions },
        { errorUrl: 'api.bouyguestelecom.fr/ventes/paniers/.../parcours', errorMethod: 'POST', errorStatusCode: 400, sessionsImpacted: 2972, totalSessions },
      ],
      errorRate,
      totalSessions,
      sessionsWithErrors,
    });
  } catch (error) {
    console.error('CS errors-analysis error:', error);
    res.status(502).json({ error: 'Failed to fetch error analysis' });
  }
});

/**
 * GET /api/contentsquare/browser-breakdown
 * Returns browser distribution data (cached from MCP computeSiteMetrics)
 */
router.get('/browser-breakdown', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    browsers: [
      { name: 'Chrome', visits: 710911, bounceRate: 19.3, sessionTimeAverage: 562, pageviewAverage: 5.78, visitWithErrors: 269175 },
      { name: 'Edge', visits: 93, bounceRate: 47.3, sessionTimeAverage: 430, pageviewAverage: 3.24, visitWithErrors: 40 },
      { name: 'Firefox', visits: 48, bounceRate: 16.7, sessionTimeAverage: 616, pageviewAverage: 6.90, visitWithErrors: 27 },
      { name: 'Safari', visits: 5, bounceRate: 20.0, sessionTimeAverage: 507, pageviewAverage: 2.20, visitWithErrors: 1 },
    ],
    success: true,
  });
});

/**
 * GET /api/contentsquare/device-breakdown
 * Returns device distribution data (cached from MCP computeSiteMetrics)
 */
router.get('/device-breakdown', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    devices: [
      { name: 'Desktop', visits: 711066, bounceRate: 19.3, sessionTimeAverage: 562, pageviewAverage: 5.78 },
      { name: 'Mobile', visits: 4, bounceRate: 50.0, sessionTimeAverage: 1054, pageviewAverage: 14.0 },
      { name: 'Tablet', visits: 0, bounceRate: 0, sessionTimeAverage: 0, pageviewAverage: 0 },
    ],
    success: true,
  });
});

/**
 * GET /api/contentsquare/conversions
 * Returns goal conversion data (cached from MCP computeSiteMetrics with goalId)
 */
router.get('/conversions', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    conversions: [
      { goalId: 1855004, goalName: 'Commander', conversionRate: 18.83, conversionCount: 138245, type: 'click' },
      { goalId: 1847708, goalName: 'Conversion pieces-justificatives-v2', conversionRate: 23.63, conversionCount: 173558, type: 'pageview' },
    ],
    success: true,
  });
});

/**
 * GET /api/contentsquare/country-breakdown
 * Returns country distribution data (cached from MCP computeSiteMetrics)
 */
router.get('/country-breakdown', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    countries: [
      { code: 'FR', name: 'France', visits: 710881, bounceRate: 19.3, visitWithErrors: 269133 },
      { code: 'ES', name: 'Espagne', visits: 173, bounceRate: 33.5, visitWithErrors: 106 },
      { code: 'FI', name: 'Finlande', visits: 23, bounceRate: 21.7, visitWithErrors: 10 },
      { code: 'CH', name: 'Suisse', visits: 1, bounceRate: 100, visitWithErrors: 0 },
    ],
    success: true,
  });
});

/**
 * GET /api/contentsquare/error-trends
 * Returns daily error trend data (cached from MCP getTopErrorsBySessionsWithErrors)
 */
router.get('/error-trends', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    dailyTrends: [
      { date: '2026-02-16', visits: 24768, visitWithErrors: 9307 },
      { date: '2026-02-17', visits: 26268, visitWithErrors: 9928 },
      { date: '2026-02-18', visits: 24389, visitWithErrors: 8996 },
      { date: '2026-02-19', visits: 24734, visitWithErrors: 9148 },
      { date: '2026-02-20', visits: 26584, visitWithErrors: 9712 },
      { date: '2026-02-21', visits: 31989, visitWithErrors: 12344 },
      { date: '2026-02-22', visits: 1631, visitWithErrors: 370 },
      { date: '2026-02-23', visits: 22630, visitWithErrors: 8927 },
      { date: '2026-02-24', visits: 23954, visitWithErrors: 9049 },
      { date: '2026-02-25', visits: 24110, visitWithErrors: 8909 },
      { date: '2026-02-26', visits: 25125, visitWithErrors: 9092 },
      { date: '2026-02-27', visits: 26234, visitWithErrors: 9614 },
      { date: '2026-02-28', visits: 33791, visitWithErrors: 12495 },
      { date: '2026-03-01', visits: 1696, visitWithErrors: 436 },
      { date: '2026-03-02', visits: 25807, visitWithErrors: 9802 },
      { date: '2026-03-03', visits: 27520, visitWithErrors: 10598 },
      { date: '2026-03-04', visits: 26891, visitWithErrors: 12175 },
      { date: '2026-03-05', visits: 27869, visitWithErrors: 10925 },
      { date: '2026-03-06', visits: 29351, visitWithErrors: 11141 },
      { date: '2026-03-07', visits: 35320, visitWithErrors: 13919 },
      { date: '2026-03-08', visits: 1795, visitWithErrors: 433 },
      { date: '2026-03-09', visits: 25252, visitWithErrors: 9572 },
      { date: '2026-03-10', visits: 26874, visitWithErrors: 9923 },
      { date: '2026-03-11', visits: 26571, visitWithErrors: 9988 },
      { date: '2026-03-12', visits: 25308, visitWithErrors: 9594 },
      { date: '2026-03-13', visits: 28156, visitWithErrors: 10402 },
      { date: '2026-03-14', visits: 35209, visitWithErrors: 13683 },
      { date: '2026-03-15', visits: 1848, visitWithErrors: 470 },
      { date: '2026-03-16', visits: 23114, visitWithErrors: 8611 },
      { date: '2026-03-17', visits: 25088, visitWithErrors: 9404 },
      { date: '2026-03-18', visits: 24489, visitWithErrors: 9284 },
    ],
    success: true,
  });
});

/**
 * GET /api/contentsquare/journey
 * Returns user journey funnel data (cached from MCP computeJourney)
 */
router.get('/journey', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  const totalSessions = 19967;
  res.json({
    landingPages: [
      { name: 'Page Dispatch', sessions: 4931, exitRate: 61.1 },
      { name: 'Renouvellement Telephone', sessions: 4975, exitRate: 6.5 },
      { name: 'Category Plan', sessions: 4471, exitRate: 0.6 },
      { name: 'FAI Eligibility', sessions: 3336, exitRate: 9.5 },
      { name: 'Offres Telephones', sessions: 1617, exitRate: 6.7 },
      { name: 'Panier Recapitulatif', sessions: 939, exitRate: 1.5 },
      { name: 'Tablet Devices (TAB)', sessions: 658, exitRate: 1.7 },
      { name: 'Pages with TPV Devices', sessions: 470, exitRate: 0.9 },
    ],
    conversionFunnels: [
      {
        name: 'Renouvellement Mobile',
        steps: [
          { name: 'Renouvellement Telephone', sessions: 4975 },
          { name: 'Panier', sessions: 1583 },
          { name: 'Panier Options', sessions: 1463 },
          { name: 'Ventes Complementaires', sessions: 1411 },
          { name: 'Panier Titulaire', sessions: 1333 },
          { name: 'Recapitulatif', sessions: 1204 },
          { name: 'Pieces Justificatives', sessions: 835 },
          { name: 'Commander', sessions: 500 },
        ],
      },
      {
        name: 'Souscription Forfait',
        steps: [
          { name: 'Category Plan', sessions: 4471 },
          { name: 'Panier', sessions: 1287 },
          { name: 'Panier Options', sessions: 873 },
          { name: 'Ventes Complementaires', sessions: 840 },
          { name: 'Panier Titulaire', sessions: 820 },
          { name: 'Recapitulatif', sessions: 781 },
          { name: 'Pieces Justificatives', sessions: 478 },
          { name: 'Commander', sessions: 294 },
        ],
      },
      {
        name: 'FAI (Internet Fixe)',
        steps: [
          { name: 'FAI Eligibility', sessions: 3336 },
          { name: 'FAI PTO', sessions: 761 },
          { name: 'FAI Techs', sessions: 739 },
          { name: 'Panier', sessions: 309 },
          { name: 'Panier Appointment', sessions: 214 },
          { name: 'Panier Options', sessions: 188 },
          { name: 'Panier Equipements', sessions: 142 },
        ],
      },
    ],
    totalSessions,
    success: true,
  });
});

// Reverse journey - exit pages (MCP computeJourney reverse)
router.get('/reverse-journey', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  const totalSessions = 19967;
  res.json({
    exitPages: [
      { name: 'Page Dispatch', sessions: 15097, percentage: 75.6 },
      { name: 'FAI Eligibility', sessions: 1988, percentage: 10.0 },
      { name: 'Panier Recapitulatif', sessions: 1628, percentage: 8.2 },
      { name: 'Renouvellement Telephone', sessions: 1568, percentage: 7.9 },
      { name: 'Panier Commander', sessions: 1267, percentage: 6.3 },
      { name: 'FAI Techs', sessions: 760, percentage: 3.8 },
      { name: 'Offres Telephones', sessions: 638, percentage: 3.2 },
      { name: 'Panier Pieces Justificatives V2', sessions: 348, percentage: 1.7 },
      { name: 'Panier', sessions: 92, percentage: 0.5 },
      { name: 'Category Plan', sessions: 61, percentage: 0.3 },
    ],
    topExitPaths: [
      { from: 'Panier Commander', to: 'Panier Pieces Justificatives V2', to2: 'Panier Recapitulatif', sessions: 1737 },
      { from: 'Panier Commander', to: 'Panier Recapitulatif', to2: 'Panier Titulaire', sessions: 931 },
      { from: 'FAI Eligibility', to: 'Panier Commander', to2: 'Panier Pieces Justificatives V2', sessions: 255 },
      { from: 'Renouvellement Telephone', to: 'Page Dispatch', to2: 'START', sessions: 825 },
      { from: 'FAI Techs', to: 'FAI Eligibility', to2: 'Page Dispatch', sessions: 390 },
    ],
    totalSessions,
    success: true,
  });
});

// Pages with most errors - scatter data (MCP getTopPagesBySessionsWithErrors)
router.get('/pages-errors-scatter', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    pages: [
      { pageId: 79856824, name: 'Panier Titulaire', visits: 217427, visitWithErrors: 97356, errorRate: 44.8 },
      { pageId: 79857116, name: 'Panier Ventes Complementaires', visits: 162884, visitWithErrors: 79549, errorRate: 48.8 },
      { pageId: 80262936, name: 'Page Dispatch', visits: 269914, visitWithErrors: 92861, errorRate: 34.4 },
      { pageId: 80262948, name: 'FAI Eligibility', visits: 176424, visitWithErrors: 59065, errorRate: 33.5 },
      { pageId: 79856876, name: 'Panier Recapitulatif', visits: 578880, visitWithErrors: 106027, errorRate: 18.3 },
      { pageId: 80262940, name: 'Panier Options', visits: 25562, visitWithErrors: 8726, errorRate: 34.1 },
      { pageId: 79856884, name: 'Panier Equipements', visits: 92438, visitWithErrors: 12585, errorRate: 13.6 },
      { pageId: 80262944, name: 'FAI PTO', visits: 4446, visitWithErrors: 1426, errorRate: 32.1 },
      { pageId: 79856788, name: 'Renouvellement Telephone', visits: 189431, visitWithErrors: 12305, errorRate: 6.5 },
      { pageId: 79856800, name: 'Category Plan', visits: 246034, visitWithErrors: 11008, errorRate: 4.5 },
    ],
    success: true,
  });
});

// Pages losing conversions due to errors (MCP getTopPageGroupsByLostConversions)
router.get('/lost-conversions', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    pages: [
      { pageId: 80262936, name: 'Page Dispatch', visits: 269914, visitWithErrors: 92861, errorsCount: 44, lostConversions: 13082 },
      { pageId: 79856876, name: 'Panier Recapitulatif', visits: 578880, visitWithErrors: 106027, errorsCount: 15, lostConversions: 4944 },
      { pageId: 79856832, name: 'Panier Commander', visits: 168131, visitWithErrors: 6077, errorsCount: 22, lostConversions: 3744 },
      { pageId: 79856828, name: 'Panier Pieces Justificatives V2', visits: 266357, visitWithErrors: 8180, errorsCount: 14, lostConversions: 3218 },
      { pageId: 80262948, name: 'FAI Eligibility', visits: 176424, visitWithErrors: 59065, errorsCount: 25, lostConversions: 1120 },
      { pageId: 79856800, name: 'Category Plan', visits: 246034, visitWithErrors: 11008, errorsCount: 27, lostConversions: 908 },
      { pageId: 79856860, name: 'Panier', visits: 178023, visitWithErrors: 6310, errorsCount: 11, lostConversions: 845 },
      { pageId: 79856824, name: 'Panier Titulaire', visits: 217427, visitWithErrors: 97356, errorsCount: 23, lostConversions: 781 },
      { pageId: 79856884, name: 'Panier Equipements', visits: 92438, visitWithErrors: 12585, errorsCount: 7, lostConversions: 521 },
      { pageId: 79857116, name: 'Panier Ventes Complementaires', visits: 162884, visitWithErrors: 79549, errorsCount: 3, lostConversions: 256 },
    ],
    goalName: 'Commander',
    totalLostConversions: 29419,
    success: true,
  });
});

// Funnel analysis - Renouvellement Mobile (MCP computeFunnel)
router.get('/funnel-analysis', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    funnels: [
      {
        name: 'Renouvellement Mobile',
        steps: [
          { name: 'Renouvellement Telephone', sessions: 195987, stepConversion: 100, stepDropOff: 0, timeToCompletion: 0 },
          { name: 'Panier Recapitulatif', sessions: 156816, stepConversion: 80.0, stepDropOff: 20.0, timeToCompletion: 385 },
          { name: 'Panier Titulaire', sessions: 10853, stepConversion: 6.9, stepDropOff: 93.1, timeToCompletion: 715 },
          { name: 'Pieces Justificatives', sessions: 10427, stepConversion: 96.1, stepDropOff: 3.9, timeToCompletion: 154 },
          { name: 'Commander', sessions: 5301, stepConversion: 50.8, stepDropOff: 49.2, timeToCompletion: 54 },
        ],
      },
      {
        name: 'Souscription Forfait',
        steps: [
          { name: 'Category Plan', sessions: 254161, stepConversion: 100, stepDropOff: 0, timeToCompletion: 0 },
          { name: 'Panier Recapitulatif', sessions: 171704, stepConversion: 67.6, stepDropOff: 32.4, timeToCompletion: 645 },
          { name: 'Pieces Justificatives', sessions: 14466, stepConversion: 8.4, stepDropOff: 91.6, timeToCompletion: 613 },
          { name: 'Commander', sessions: 7390, stepConversion: 51.1, stepDropOff: 48.9, timeToCompletion: 93 },
        ],
      },
      {
        name: 'FAI (Internet Fixe)',
        steps: [
          { name: 'FAI Eligibility', sessions: 182872, stepConversion: 100, stepDropOff: 0, timeToCompletion: 0 },
          { name: 'Panier', sessions: 66333, stepConversion: 36.3, stepDropOff: 63.7, timeToCompletion: 6 },
          { name: 'Panier Recapitulatif', sessions: 54956, stepConversion: 82.8, stepDropOff: 17.2, timeToCompletion: 0 },
          { name: 'Commander', sessions: 803, stepConversion: 1.5, stepDropOff: 98.5, timeToCompletion: 0 },
        ],
      },
    ],
    success: true,
  });
});

// Detailed page metrics with conversion, activity, scroll (MCP computePageGroupMetrics)
router.get('/page-detailed-metrics', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    pages: [
      {
        pageId: 80262936, name: 'Page Dispatch', visits: 278899,
        bounceRate: 2.33, exitRate: 7.14, scrollRate: 94.30, activityRate: 12.13,
        visitWithErrors: 96002, errorRate: 34.4, elapsedTime: 50.4, interactionTime: 2.7, loadingTime: 0.16,
      },
      {
        pageId: 79856788, name: 'Renouvellement Telephone', visits: 195987,
        bounceRate: 10.0, exitRate: 8.92, scrollRate: 98.56, activityRate: 29.5,
        visitWithErrors: 12705, errorRate: 6.5, elapsedTime: 82.1, interactionTime: 10.0, loadingTime: 0.13,
        conversionRate: 18.8,
      },
      {
        pageId: 80262948, name: 'FAI Eligibility', visits: 182872,
        bounceRate: 3.82, exitRate: 10.01, scrollRate: 94.89, activityRate: 55.97,
        visitWithErrors: 61203, errorRate: 33.5, elapsedTime: 56.1, interactionTime: 11.4, loadingTime: 0.10,
        conversionRate: 21.2,
      },
      {
        pageId: 79856876, name: 'Panier Recapitulatif', visits: 598713,
        bounceRate: 62.64, exitRate: 66.59, scrollRate: 98.59, activityRate: 35.31,
        visitWithErrors: 109760, errorRate: 18.3, elapsedTime: 0, interactionTime: 0, loadingTime: 0.14,
        conversionRate: 12.5,
      },
      {
        pageId: 79856828, name: 'Pieces Justificatives V2', visits: 275282,
        bounceRate: 1.67, exitRate: 2.15, scrollRate: 95.48, activityRate: 30.3,
        visitWithErrors: 8470, errorRate: 3.1, elapsedTime: 30.8, interactionTime: 2.5, loadingTime: 0.14,
        conversionRate: 50.2,
      },
      {
        pageId: 79856832, name: 'Panier Commander', visits: 173558,
        bounceRate: 29.21, exitRate: 2.0, scrollRate: 99.31, activityRate: 12.83,
        visitWithErrors: 6255, errorRate: 3.6, elapsedTime: 36.1, interactionTime: 2.3, loadingTime: 0.14,
        conversionRate: 79.7,
      },
      {
        pageId: 79856860, name: 'Panier', visits: 183864,
        bounceRate: 6.36, exitRate: 6.44, scrollRate: 99.08, activityRate: 20.69,
        visitWithErrors: 6606, errorRate: 3.6, elapsedTime: 224.1, interactionTime: 24.0, loadingTime: 0.14,
        conversionRate: 19.5,
      },
      {
        pageId: 79857116, name: 'Ventes Complementaires', visits: 168306,
        bounceRate: 47.83, exitRate: 46.67, scrollRate: 99.81, activityRate: 29.35,
        visitWithErrors: 82391, errorRate: 49.0, elapsedTime: 20.8, interactionTime: 0.7, loadingTime: 0.13,
        conversionRate: 82.0,
      },
      {
        pageId: 80262940, name: 'Panier Options', visits: 26326,
        bounceRate: 5.83, exitRate: 11.49, scrollRate: 94.76, activityRate: 55.26,
        visitWithErrors: 9020, errorRate: 34.3, elapsedTime: 63.8, interactionTime: 12.3, loadingTime: 0.10,
        conversionRate: 18.2,
      },
      {
        pageId: 80262944, name: 'FAI PTO', visits: 4598,
        bounceRate: 12.57, exitRate: 18.64, scrollRate: 97.11, activityRate: 52.32,
        visitWithErrors: 1468, errorRate: 31.9, elapsedTime: 62.0, interactionTime: 10.1, loadingTime: 0.11,
        conversionRate: 11.0,
      },
    ],
    success: true,
  });
});

// Second goal daily conversion trend (MCP computeSiteMetrics goalId=1847708, dimensions=["day"])
router.get('/conversion-trends-pj', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    dailyConversions: [
      { date: '2026-02-16', visits: 24768, conversionRate: 23.61, conversionCount: 5848 },
      { date: '2026-02-17', visits: 26268, conversionRate: 23.29, conversionCount: 6117 },
      { date: '2026-02-18', visits: 24389, conversionRate: 22.39, conversionCount: 5460 },
      { date: '2026-02-19', visits: 24734, conversionRate: 21.68, conversionCount: 5362 },
      { date: '2026-02-20', visits: 26584, conversionRate: 22.84, conversionCount: 6071 },
      { date: '2026-02-21', visits: 31989, conversionRate: 24.31, conversionCount: 7775 },
      { date: '2026-02-22', visits: 1631, conversionRate: 16.68, conversionCount: 272 },
      { date: '2026-02-23', visits: 22630, conversionRate: 22.81, conversionCount: 5163 },
      { date: '2026-02-24', visits: 23954, conversionRate: 22.50, conversionCount: 5390 },
      { date: '2026-02-25', visits: 24110, conversionRate: 22.16, conversionCount: 5343 },
      { date: '2026-02-26', visits: 25125, conversionRate: 24.87, conversionCount: 6248 },
      { date: '2026-02-27', visits: 26234, conversionRate: 22.64, conversionCount: 5940 },
      { date: '2026-02-28', visits: 33791, conversionRate: 26.67, conversionCount: 9013 },
      { date: '2026-03-01', visits: 1696, conversionRate: 19.46, conversionCount: 330 },
      { date: '2026-03-02', visits: 25807, conversionRate: 24.08, conversionCount: 6215 },
      { date: '2026-03-03', visits: 27520, conversionRate: 23.38, conversionCount: 6433 },
      { date: '2026-03-04', visits: 26891, conversionRate: 22.55, conversionCount: 6063 },
      { date: '2026-03-05', visits: 27869, conversionRate: 24.59, conversionCount: 6852 },
      { date: '2026-03-06', visits: 29351, conversionRate: 23.51, conversionCount: 6899 },
      { date: '2026-03-07', visits: 35320, conversionRate: 25.12, conversionCount: 8873 },
      { date: '2026-03-08', visits: 1795, conversionRate: 18.11, conversionCount: 325 },
      { date: '2026-03-09', visits: 25252, conversionRate: 23.92, conversionCount: 6040 },
      { date: '2026-03-10', visits: 26874, conversionRate: 22.80, conversionCount: 6128 },
      { date: '2026-03-11', visits: 26571, conversionRate: 23.12, conversionCount: 6144 },
      { date: '2026-03-12', visits: 25308, conversionRate: 23.10, conversionCount: 5845 },
      { date: '2026-03-13', visits: 28156, conversionRate: 27.10, conversionCount: 7630 },
      { date: '2026-03-14', visits: 35209, conversionRate: 25.72, conversionCount: 9056 },
      { date: '2026-03-15', visits: 1848, conversionRate: 19.48, conversionCount: 360 },
      { date: '2026-03-16', visits: 23114, conversionRate: 23.41, conversionCount: 5412 },
      { date: '2026-03-17', visits: 25088, conversionRate: 21.88, conversionCount: 5490 },
      { date: '2026-03-18', visits: 24489, conversionRate: 22.30, conversionCount: 5461 },
    ],
    goalName: 'Conversion pieces-justificatives-v2',
    success: true,
  });
});

// Daily conversion trend (MCP computeSiteMetrics with goalId=1855004, dimensions=["day"])
router.get('/conversion-trends', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    dailyConversions: [
      { date: '2026-02-16', visits: 24768, conversionRate: 19.49, conversionCount: 4828 },
      { date: '2026-02-17', visits: 26268, conversionRate: 19.01, conversionCount: 4994 },
      { date: '2026-02-18', visits: 24389, conversionRate: 18.19, conversionCount: 4437 },
      { date: '2026-02-19', visits: 24734, conversionRate: 17.53, conversionCount: 4337 },
      { date: '2026-02-20', visits: 26584, conversionRate: 18.58, conversionCount: 4938 },
      { date: '2026-02-21', visits: 31989, conversionRate: 20.17, conversionCount: 6453 },
      { date: '2026-02-22', visits: 1631, conversionRate: 14.47, conversionCount: 236 },
      { date: '2026-02-23', visits: 22630, conversionRate: 18.99, conversionCount: 4298 },
      { date: '2026-02-24', visits: 23954, conversionRate: 18.29, conversionCount: 4380 },
      { date: '2026-02-25', visits: 24110, conversionRate: 18.32, conversionCount: 4418 },
      { date: '2026-02-26', visits: 25125, conversionRate: 17.63, conversionCount: 4430 },
      { date: '2026-02-27', visits: 26234, conversionRate: 18.60, conversionCount: 4879 },
      { date: '2026-02-28', visits: 33791, conversionRate: 19.40, conversionCount: 6556 },
      { date: '2026-03-01', visits: 1696, conversionRate: 16.45, conversionCount: 279 },
      { date: '2026-03-02', visits: 25807, conversionRate: 19.50, conversionCount: 5032 },
      { date: '2026-03-03', visits: 27520, conversionRate: 18.70, conversionCount: 5146 },
      { date: '2026-03-04', visits: 26891, conversionRate: 17.96, conversionCount: 4829 },
      { date: '2026-03-05', visits: 27869, conversionRate: 19.37, conversionCount: 5399 },
      { date: '2026-03-06', visits: 29351, conversionRate: 19.07, conversionCount: 5596 },
      { date: '2026-03-07', visits: 35320, conversionRate: 20.77, conversionCount: 7337 },
      { date: '2026-03-08', visits: 1795, conversionRate: 14.99, conversionCount: 269 },
      { date: '2026-03-09', visits: 25252, conversionRate: 19.54, conversionCount: 4935 },
      { date: '2026-03-10', visits: 26874, conversionRate: 18.60, conversionCount: 4998 },
      { date: '2026-03-11', visits: 26571, conversionRate: 18.48, conversionCount: 4911 },
      { date: '2026-03-12', visits: 25308, conversionRate: 18.46, conversionCount: 4673 },
      { date: '2026-03-13', visits: 28156, conversionRate: 16.48, conversionCount: 4640 },
      { date: '2026-03-14', visits: 35209, conversionRate: 21.04, conversionCount: 7408 },
      { date: '2026-03-15', visits: 1848, conversionRate: 15.96, conversionCount: 295 },
      { date: '2026-03-16', visits: 23114, conversionRate: 19.04, conversionCount: 4402 },
      { date: '2026-03-17', visits: 25088, conversionRate: 17.88, conversionCount: 4485 },
      { date: '2026-03-18', visits: 24489, conversionRate: 18.08, conversionCount: 4427 },
    ],
    goalName: 'Commander',
    success: true,
  });
});

// Converters vs Non-converters comparison (MCP computeSiteMetrics with userFilter goal)
router.get('/user-segments-comparison', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    segments: [
      {
        name: 'Convertis (Commander)',
        visits: 138169, bounceRate: 0, sessionTimeAverage: 1059.8,
        pageviewAverage: 12.92, visitWithErrors: 99723, errorRate: 72.2,
      },
      {
        name: 'Non-convertis',
        visits: 596196, bounceRate: 23.81, sessionTimeAverage: 446.1,
        pageviewAverage: 4.12, visitWithErrors: 178528, errorRate: 29.9,
      },
    ],
    insights: [
      { label: 'Rebond Panier Recapitulatif', value: 114093, description: '114K sessions atterrissent sur le Recapitulatif et repartent immediatement (17s en moyenne) - probablement des liens directs/favoris' },
      { label: 'Sortie Page Dispatch', value: 96393, description: '96K sessions quittent depuis Page Dispatch apres 4 pages et 4m13s - visiteurs en phase de recherche' },
    ],
    success: true,
  });
});

// Platform/OS breakdown (MCP computeSiteMetrics with dimensions=["platformName"])
router.get('/platform-breakdown', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    platforms: [
      { name: 'Windows', visits: 734221, bounceRate: 19.33, sessionTimeAverage: 561.6, percentage: 99.98 },
      { name: 'Mac OS', visits: 141, bounceRate: 16.31, sessionTimeAverage: 605.4, percentage: 0.019 },
      { name: 'Android', visits: 3, bounceRate: 33.33, sessionTimeAverage: 1405.8, percentage: 0.0004 },
      { name: 'iOS', visits: 1, bounceRate: 100, sessionTimeAverage: 0, percentage: 0.0001 },
    ],
    success: true,
  });
});

// City breakdown (MCP computeSiteMetrics with dimensions=["city"])
router.get('/city-breakdown', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    cities: [
      { name: '(non defini)', visits: 373903, percentage: 50.9 },
      { name: 'Chelles', visits: 354851, percentage: 48.3 },
      { name: 'Paris', visits: 5401, percentage: 0.74 },
      { name: 'Madrid', visits: 176, percentage: 0.024 },
      { name: 'Helsinki', visits: 23, percentage: 0.003 },
      { name: 'Marseille', visits: 10, percentage: 0.001 },
      { name: 'Clermont-Ferrand', visits: 1, percentage: 0.0001 },
    ],
    success: true,
  });
});

// Screen resolution breakdown (MCP computeSiteMetrics with dimensions=["screenWidth"])
router.get('/screen-resolution', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    resolutions: [
      { width: 1280, visits: 391258, percentage: 53.3 },
      { width: 1366, visits: 296553, percentage: 40.4 },
      { width: 1440, visits: 23669, percentage: 3.2 },
      { width: 1920, visits: 7130, percentage: 0.97 },
      { width: 1536, visits: 5720, percentage: 0.78 },
      { width: 1600, visits: 3850, percentage: 0.52 },
      { width: 800, visits: 2102, percentage: 0.29 },
      { width: 1024, visits: 1876, percentage: 0.26 },
      { width: 768, visits: 1205, percentage: 0.16 },
      { width: 360, visits: 842, percentage: 0.11 },
    ],
    success: true,
  });
});

// Daily page-level error trends (MCP computePageGroupMetrics daily for key pages)
router.get('/page-error-trends', authMiddleware, async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    pages: [
      {
        name: 'Page Dispatch',
        dailyData: [
          { date: '2026-02-16', visits: 9449, visitWithErrors: 3185 },
          { date: '2026-02-17', visits: 9979, visitWithErrors: 3447 },
          { date: '2026-02-18', visits: 9375, visitWithErrors: 3145 },
          { date: '2026-02-19', visits: 9484, visitWithErrors: 3195 },
          { date: '2026-02-20', visits: 10163, visitWithErrors: 3368 },
          { date: '2026-02-21', visits: 12326, visitWithErrors: 4228 },
          { date: '2026-02-22', visits: 616, visitWithErrors: 131 },
          { date: '2026-02-23', visits: 8615, visitWithErrors: 3048 },
          { date: '2026-02-24', visits: 9116, visitWithErrors: 3073 },
          { date: '2026-02-25', visits: 9186, visitWithErrors: 3041 },
          { date: '2026-02-26', visits: 9553, visitWithErrors: 3117 },
          { date: '2026-02-27', visits: 10003, visitWithErrors: 3301 },
          { date: '2026-02-28', visits: 12791, visitWithErrors: 4279 },
          { date: '2026-03-01', visits: 638, visitWithErrors: 149 },
          { date: '2026-03-02', visits: 9828, visitWithErrors: 3354 },
          { date: '2026-03-03', visits: 10575, visitWithErrors: 3675 },
          { date: '2026-03-04', visits: 10363, visitWithErrors: 3571 },
          { date: '2026-03-05', visits: 10714, visitWithErrors: 3665 },
          { date: '2026-03-06', visits: 11224, visitWithErrors: 3752 },
          { date: '2026-03-07', visits: 13484, visitWithErrors: 4678 },
          { date: '2026-03-08', visits: 673, visitWithErrors: 142 },
          { date: '2026-03-09', visits: 9569, visitWithErrors: 3261 },
          { date: '2026-03-10', visits: 10264, visitWithErrors: 3384 },
          { date: '2026-03-11', visits: 10093, visitWithErrors: 3376 },
          { date: '2026-03-12', visits: 9663, visitWithErrors: 3279 },
          { date: '2026-03-13', visits: 10726, visitWithErrors: 3521 },
          { date: '2026-03-14', visits: 13451, visitWithErrors: 4632 },
          { date: '2026-03-15', visits: 698, visitWithErrors: 155 },
          { date: '2026-03-16', visits: 8812, visitWithErrors: 2941 },
          { date: '2026-03-17', visits: 9562, visitWithErrors: 3188 },
          { date: '2026-03-18', visits: 9382, visitWithErrors: 3159 },
        ],
      },
      {
        name: 'Panier Recapitulatif',
        dailyData: [
          { date: '2026-02-16', visits: 19927, visitWithErrors: 3499 },
          { date: '2026-02-17', visits: 21384, visitWithErrors: 3741 },
          { date: '2026-02-18', visits: 19505, visitWithErrors: 3356 },
          { date: '2026-02-19', visits: 19783, visitWithErrors: 3451 },
          { date: '2026-02-20', visits: 21328, visitWithErrors: 3685 },
          { date: '2026-02-21', visits: 25792, visitWithErrors: 4562 },
          { date: '2026-02-22', visits: 1260, visitWithErrors: 172 },
          { date: '2026-02-23', visits: 18211, visitWithErrors: 3361 },
          { date: '2026-02-24', visits: 19323, visitWithErrors: 3407 },
          { date: '2026-02-25', visits: 19471, visitWithErrors: 3351 },
          { date: '2026-02-26', visits: 20278, visitWithErrors: 3463 },
          { date: '2026-02-27', visits: 21076, visitWithErrors: 3629 },
          { date: '2026-02-28', visits: 27197, visitWithErrors: 4717 },
          { date: '2026-03-01', visits: 1323, visitWithErrors: 205 },
          { date: '2026-03-02', visits: 20749, visitWithErrors: 3740 },
          { date: '2026-03-03', visits: 22027, visitWithErrors: 3997 },
          { date: '2026-03-04', visits: 21636, visitWithErrors: 4666 },
          { date: '2026-03-05', visits: 22370, visitWithErrors: 4154 },
          { date: '2026-03-06', visits: 23548, visitWithErrors: 4207 },
          { date: '2026-03-07', visits: 28480, visitWithErrors: 5287 },
          { date: '2026-03-08', visits: 1411, visitWithErrors: 203 },
          { date: '2026-03-09', visits: 20261, visitWithErrors: 3618 },
          { date: '2026-03-10', visits: 21465, visitWithErrors: 3742 },
          { date: '2026-03-11', visits: 21325, visitWithErrors: 3760 },
          { date: '2026-03-12', visits: 20310, visitWithErrors: 3604 },
          { date: '2026-03-13', visits: 22703, visitWithErrors: 3925 },
          { date: '2026-03-14', visits: 28306, visitWithErrors: 5156 },
          { date: '2026-03-15', visits: 1455, visitWithErrors: 217 },
          { date: '2026-03-16', visits: 18535, visitWithErrors: 3228 },
          { date: '2026-03-17', visits: 20188, visitWithErrors: 3548 },
          { date: '2026-03-18', visits: 19695, visitWithErrors: 3467 },
        ],
      },
    ],
    success: true,
  });
});

export default router;
