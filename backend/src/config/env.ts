import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from project root (2 levels up from config/)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const env = {
  PORT: parseInt(process.env.PORT || '3002'),
  NODE_ENV: process.env.NODE_ENV || 'development',
  CONTENTSQUARE_API_URL: process.env.CONTENTSQUARE_API_URL || 'https://api.contentsquare.com',
  CONTENTSQUARE_CLIENT_ID: process.env.CONTENTSQUARE_CLIENT_ID || '',
  CONTENTSQUARE_CLIENT_SECRET: process.env.CONTENTSQUARE_CLIENT_SECRET || '',
  CONTENTSQUARE_PROJECT_ID: parseInt(process.env.CONTENTSQUARE_PROJECT_ID || '16096'),
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  CORS_ORIGINS: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
};
