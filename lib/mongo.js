// server/lib/mongo.js
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load .env from multiple possible locations
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '../..', '.env') });

const uri = process.env.MONGO_URI || process.env.MONGO_URL;
const dbName = process.env.DB_NAME || "ClaimsDB";

if (!uri) {
  throw new Error("Missing MONGO_URI or MONGO_URL in .env");
}

let client;
let db;

/** Connect once and reuse */
export async function connectMongo() {
  if (db) return db;

  client = new MongoClient(uri, {
    monitorCommands: true,
    retryWrites: true,
    w: 'majority',
    tls: true,
  // tlsAllowInvalidCertificates: true, // REMOVE for Atlas compatibility
    serverApi: {
      version: '1',
      strict: true,
      deprecationErrors: true
    }
  });
  await client.connect();
  db = client.db(dbName);
  await ensureIndexes(db);
  console.log(`[Mongo] Connected to ${dbName}`);
  return db;
}

export function getDb() {
  if (!db) throw new Error("Mongo not connected yet. Call connectMongo() first.");
  return db;
}

async function ensureIndexes(db) {
  await db.collection("Users").createIndex({ email: 1 }, { unique: true }).catch(() => {});
  await db.collection("ExistingClaims").createIndex({ ClaimID: 1 }, { unique: false }).catch(() => {});
  await db.collection("NewClaims").createIndex({ ClaimID: 1 }, { unique: false }).catch(() => {});
}