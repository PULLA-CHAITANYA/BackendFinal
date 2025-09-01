import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import portfinder from "portfinder";
import { connectFilteredMongo } from "./lib/mongo-filtered.js";
import { connectMongo } from "./lib/mongo.js";
import adminRoutes from "./routes/admin-score.js";
import authRoutes from "./routes/auth.js";
import beneficiaryRoutes from "./routes/beneficiary.js";
import claimsRoutes from "./routes/claims.js";
import fraudClusterRoutes from "./routes/fraudCluster.js";


import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors({ origin: ["https://nice-forest-0c9364310.1.azurestaticapps.net","http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://localhost:5176"], credentials: false }));
app.use(express.json());

app.use("/api", claimsRoutes);
app.use("/api", fraudClusterRoutes);
app.use("/api/beneficiary", beneficiaryRoutes);

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/claims", claimsRoutes);
app.use("/api/admin-score", adminRoutes);

const startServer = async () => {
  try {
    // Connect to main database
    await connectMongo().catch(err => {
      console.error('Failed to connect to main database:', err);
      throw err;
    });
    console.log('Connected to main database');
    
    // Connect to filtered database
    await connectFilteredMongo().catch(err => {
      console.error('Failed to connect to filtered database:', err);
      throw err;
    });
    console.log('Connected to filtered database');

    const port = await portfinder.getPortPromise({
      port: Number(process.env.PORT || 3000),
      stopPort: 5000
    });
    app.listen(port, () => console.log(`API ready on http://localhost:${port}`));
  } catch (error) {
    console.error('Failed to connect to databases:', error);
    process.exit(1);
  }
};

startServer();
