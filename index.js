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
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();

// ✅ FIXED CORS CONFIG
app.use(
  cors({
    origin: [
      "https://nice-forest-0c9364310.1.azurestaticapps.net", // frontend
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://localhost:5176",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // must be true for cookies/tokens
  })
);

// ✅ Explicitly handle preflight requests
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin);
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  return res.sendStatus(200);
});

app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/claims", claimsRoutes);
app.use("/api/admin-score", adminRoutes);
app.use("/api/beneficiary", beneficiaryRoutes);
app.use("/api", claimsRoutes);
app.use("/api", fraudClusterRoutes);

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

const startServer = async () => {
  try {
    await connectMongo();
    console.log("Connected to main database");

    await connectFilteredMongo();
    console.log("Connected to filtered database");

    const port = await portfinder.getPortPromise({
      port: Number(process.env.PORT || 3000),
      stopPort: 5000,
    });
    app.listen(port, () =>
      console.log(`API ready on http://localhost:${port}`)
    );
  } catch (error) {
    console.error("Failed to connect to databases:", error);
    process.exit(1);
  }
};

startServer();
