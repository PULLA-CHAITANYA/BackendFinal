// server/lib/mongo-autopopulate.js
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config({ path: path.join(__dirname, "../..", ".env") });

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME || "ClaimsDB";

if (!uri) {
  throw new Error("Missing MONGO_URI_AUTOPOPULATE in .env");
}


let client;
let db;
let beneficiariesCol;


/** Connect once and reuse */
export async function connectAutopopulateMongo() {
  if (db && beneficiariesCol) return beneficiariesCol;

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
  beneficiariesCol = db.collection('beneficiaries');
  console.log(`[Mongo] Connected to DB: ${dbName}, collection: beneficiaries`);
  return beneficiariesCol;
}

export function getAutopopulateCol() {
  if (!beneficiariesCol) throw new Error("Autopopulate Mongo not connected yet. Call connectAutopopulateMongo() first.");
  return beneficiariesCol;
}
