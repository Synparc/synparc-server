import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing in .env");
}

// Client postgres pour les requêtes de l'application
const queryClient = postgres(connectionString);
export const db = drizzle(queryClient, { schema });
