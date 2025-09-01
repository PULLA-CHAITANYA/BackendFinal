// routes/fraudCluster.js
import express from 'express';
import { connectFilteredMongo, getFilteredDatasetCol } from '../lib/mongo-filtered.js';

const router = express.Router();

router.get('/fraud-cluster/:providerId', async (req, res) => {
  const providerId = String(req.params.providerId || '').toUpperCase().trim();
  const daysWindow = Number(req.query.daysWindow ?? 30);
  if (!providerId) return res.status(400).json({ error: 'providerId required' });

  try {
    console.log(`[fraudCluster] providerId: ${providerId}, daysWindow: ${daysWindow}`);
    await connectFilteredMongo();
    const col = getFilteredDatasetCol();
    console.log('[fraudCluster] Connected to FilteredDataset collection');

    const cursor = col.find(
      { Provider: { $ne: null }, BeneID: { $ne: null }, ClaimStartDt: { $ne: null } },
      { projection: { Provider: 1, BeneID: 1, ClaimStartDt: 1, ClaimEndDt: 1, _id: 0 } }
    );
    const records = await cursor.toArray();
    console.log(`[fraudCluster] Records fetched: ${records.length}`);
    records.forEach((r, idx) => {
      try {
        r.Provider = String(r.Provider).toUpperCase().trim();
        r.ClaimStartDt = new Date(r.ClaimStartDt);
        r.ClaimEndDt = new Date(r.ClaimEndDt);
      } catch (e) {
        console.error(`[fraudCluster] Error parsing record at index ${idx}:`, r, e);
      }
    });

    // Build provider-provider graph
    const maxDiffMs = daysWindow * 24 * 60 * 60 * 1000;
    const beneGroups = new Map();
    for (const r of records) {
      if (!beneGroups.has(r.BeneID)) beneGroups.set(r.BeneID, []);
      beneGroups.get(r.BeneID).push(r);
    }
    console.log(`[fraudCluster] beneGroups size: ${beneGroups.size}`);

  // Graph: provider -> Set of connected providers
  const G = new Map();
  // For edge details (shared beneficiaries)
  const edgeDetails = new Map();

    for (const [beneId, group] of beneGroups.entries()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = 0; j < group.length; j++) {
          if (i === j) continue;
          const row1 = group[i], row2 = group[j];
          if (row1.Provider === row2.Provider) continue;
          if (Math.abs(row1.ClaimStartDt - row2.ClaimStartDt) <= maxDiffMs) {
            // Add edge
            if (!G.has(row1.Provider)) G.set(row1.Provider, new Set());
            G.get(row1.Provider).add(row2.Provider);
            // Track shared beneficiaries
            const key = row1.Provider < row2.Provider ? `${row1.Provider}|${row2.Provider}` : `${row2.Provider}|${row1.Provider}`;
            if (!edgeDetails.has(key)) edgeDetails.set(key, { providers: [row1.Provider, row2.Provider], beneficiaries: new Set() });
            edgeDetails.get(key).beneficiaries.add(beneId);
          }
        }
      }
    }
    console.log(`[fraudCluster] G size: ${G.size}, edgeDetails size: ${edgeDetails.size}`);

    // Find cluster for providerId using BFS
    if (!G.has(providerId)) {
      console.log(`[fraudCluster] Provider ${providerId} not in suspicious clusters.`);
      return res.json({ providerId, inRing: false, reason: 'Provider not in suspicious clusters' });
    }
    const visited = new Set([providerId]);
    const queue = [providerId];
    while (queue.length) {
      const u = queue.shift();
      for (const v of G.get(u) || []) {
        if (!visited.has(v)) {
          visited.add(v);
          queue.push(v);
        }
      }
    }
    const cluster = Array.from(visited);
    console.log(`[fraudCluster] Cluster size: ${cluster.length}`);

    // Collect suspicious links
    const suspiciousLinks = [];
    for (const key of edgeDetails.keys()) {
      const { providers, beneficiaries } = edgeDetails.get(key);
      if (cluster.includes(providers[0]) && cluster.includes(providers[1])) {
        suspiciousLinks.push({
          provider1: providers[0],
          provider2: providers[1],
          shared_beneficiaries: Array.from(beneficiaries)
        });
      }
    }
    console.log(`[fraudCluster] suspiciousLinks count: ${suspiciousLinks.length}`);

    res.json({
      providerId,
      inRing: true,
      clusterSize: cluster.length,
      providersInCluster: cluster,
      suspiciousLinks
    });
  } catch (err) {
    console.error('fraud-cluster error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;