# Phase 3 : Segments, Filtres Globaux & Interactivite

## Scope

1. Filtres globaux (segment + device) dans le header
2. Tableau comparatif segments + bar chart empile
3. Click-to-filter sur pie chart Appareils
4. Drill-down page → Web Vitals par page

## Fichiers a modifier

| Fichier | Action |
|---------|--------|
| `backend/src/routes/contentsquare.ts` | Ajouter endpoint `/site-metrics-by-segment`, ajouter param `segmentId` a `/site-metrics` |
| `frontend/src/services/api.ts` | Ajouter types + methodes segment, page web vitals |
| `frontend/src/pages/Contentsquare.tsx` | Filtres globaux, section segments, interactivite |

## Etape 1 : Backend

### 1.1 Modifier `/site-metrics` pour accepter `segmentId`
- Ajouter param optionnel `segmentId` au GET `/site-metrics`
- Le passer a `csApiGet('/v1/metrics/site', { ..., segmentId })`

### 1.2 Ajouter `GET /site-metrics-by-segment`
- 4 appels paralleles a `/v1/metrics/site` avec `segmentId=1|2|3|4`
- Retourne `{ segments: [{ id, name, visits, bounceRate, sessionTimeAverage, pageviewAverage }] }`
- Noms hardcodes : New Users(1), Returning(2), Bots(3), Purchase Intent(4)

## Etape 2 : Frontend API

### 2.1 Nouveaux types
```ts
interface CSSegmentMetrics {
  id: number;
  name: string;
  visits: number;
  bounceRate: number;
  sessionTimeAverage: number;
  pageviewAverage: number;
}
interface CSSegmentBreakdownResponse {
  segments: CSSegmentMetrics[];
  success: boolean;
}
```

### 2.2 Nouvelles methodes
```ts
api.getSegmentBreakdown(startDate, endDate) → CSSegmentBreakdownResponse
api.getSiteMetricsFiltered(startDate, endDate, device?, segmentId?) → CSSiteMetricsResponse
```

## Etape 3 : Frontend - Filtres globaux

### 3.1 State filtres
- `selectedDevice: 'all' | 'desktop' | 'mobile' | 'tablet'`
- `selectedSegmentId: number | null`
- Quand un filtre change, `loadData()` est re-appele avec les nouveaux params

### 3.2 UI filtres (dans le header, apres les date pickers)
- Dropdown device : Tous / Desktop / Mobile / Tablet
- Dropdown segment : Tous / New Users / Returning / Bots / Purchase Intent
- Badge actif quand filtre != default

### 3.3 Impact sur `loadData()`
- `fetchSiteMetricsChunked` passe `device` et `segmentId` a l'API
- Le backend `/site-metrics` passe ces params a CS

## Etape 4 : Frontend - Section Segments

### 4.1 Tableau comparatif
- Apres les KPIs
- 4 lignes (segments), colonnes: Nom, Visites, Bounce%, Duree session, Pages/visite
- Ligne highlight si le segment est selectionne dans le filtre
- Click sur une ligne → selectionne ce segment dans le filtre global

### 4.2 Bar chart empile
- A cote du tableau (2 colonnes)
- Stacked bar : visites par segment
- Couleurs : New=#3b82f6, Returning=#22c55e, Bots=#94a3b8, Purchase=#f97316

## Etape 5 : Frontend - Interactivite

### 5.1 Click pie chart Appareils
- `onClick` sur le Pie → `setSelectedDevice(deviceName)`
- Si deja selectionne → reset a 'all'
- Segment actif visuellement distinct (opacity ou stroke)

### 5.2 Drill-down page
- Click sur une ligne du tableau pages → expande une row detail
- Appel API : `getContentsquareWebVitals(pageGroupId, startDate, endDate)`
- Affiche les 5 Web Vitals (LCP, INP, CLS, FCP, TTFB) avec rating badges
- Bouton "fermer" pour collapse

## Verification
1. Filtre device change les KPIs (visites diminuent quand on filtre mobile)
2. Filtre segment change les KPIs
3. Click pie chart active le filtre device
4. Tableau segments montre 4 lignes avec metriques
5. Bar chart segments affiche les proportions
6. Click page → expand montre les Web Vitals
7. Tout fonctionne avec les presets de dates
