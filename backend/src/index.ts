import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import contentsquareRouter from './routes/contentsquare.js';
import authRouter from './routes/auth.js';

const app = express();

app.use(cors({
  origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS,
  credentials: true,
}));

app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' },
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/auth', authRouter);
app.use('/api/contentsquare', apiLimiter, contentsquareRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(env.PORT, () => {
  console.log(`Contentsquare Dashboard API running on port ${env.PORT}`);
});
