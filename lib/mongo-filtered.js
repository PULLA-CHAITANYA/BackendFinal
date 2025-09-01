// server/lib/mongo-filtered.js
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load .env from multiple possible locations
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config({ path: path.join(__dirname, "../..", ".env") });

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME || "ClaimsDB";

if (!uri) {
  throw new Error("Missing MONGO_URI2 in .env");
}


let client;
let db;
let filteredDatasetCol;


/** Connect once and reuse */
export async function connectFilteredMongo() {
  if (db && filteredDatasetCol) return filteredDatasetCol;

  client = new MongoClient(uri, {
    monitorCommands: true,
    retryWrites: true,
    w: "majority",
    tls: true,
    serverApi: {
      version: "1",
      strict: true,
      deprecationErrors: true,
    },
  });
  await client.connect();
  db = client.db(dbName);
  filteredDatasetCol = db.collection('FilteredDataset');
  console.log(`[Mongo] Connected to DB: ${dbName}, collection: FilteredDataset`);
  return filteredDatasetCol;
}

export function getFilteredDatasetCol() {
  if (!filteredDatasetCol) throw new Error("Filtered Mongo not connected yet. Call connectFilteredMongo() first.");
  return filteredDatasetCol;
}