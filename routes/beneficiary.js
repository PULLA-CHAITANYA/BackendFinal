import dotenv from 'dotenv';
import { Router } from 'express';
import { MongoClient } from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const router = Router();

// Use main DB for beneficiaries
const client2 = new MongoClient(process.env.MONGO_URI);
const dbName2 = process.env.DB_NAME || "ClaimsDB";
const collectionName2 = "beneficiaries";

router.get("/:beneId", async (req, res) => {
  try {
    await client2.connect();
    const db = client2.db(dbName2);
    const collection = db.collection(collectionName2);

    const bene = await collection.findOne({ BeneID: req.params.beneId });

    if (!bene) {
      return res.json({ found: false });
    }

    res.json({ found: true, data: bene });
  } catch (err) {
    console.error("Beneficiary lookup failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
