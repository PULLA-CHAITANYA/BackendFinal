import axios from 'axios';
import { spawn } from 'child_process';
import { Router } from 'express';
import Joi from 'joi';
import { config } from '../config.js';
import { connectFilteredMongo, getFilteredDatasetCol } from '../lib/mongo-filtered.js';
import { getDb } from '../lib/mongo.js';
import { auth } from '../middleware/auth.js';

const router = Router();

/* -----------------------------------------------------------------------------
   Validation for single claim submit
----------------------------------------------------------------------------- */
const claimSchema = Joi.object({
  ClaimID: Joi.string().required(),
  BeneID: Joi.string().required(),
  ClaimStartDt: Joi.string().allow('', null),
  ClaimEndDt: Joi.string().allow('', null),
  DOB: Joi.string().allow('', null),
  AdmissionDt: Joi.string().allow('', null),
  InscClaimAmtReimbursed: Joi.alternatives().try(Joi.number(), Joi.string()).allow(null),
  DiagnosisGroupCode: Joi.string().allow('', null),
  Gender: Joi.alternatives()
    .try(
      Joi.number().valid(1, 2),
      Joi.string().valid('1', '2', 'M', 'F', 'Male', 'Female', 'Male (M)', 'Female (F)')
    )
    .allow(null),
  ChronicCond_Alzheimer: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'Yes', 'No', 'Yes (1)', 'No (0)')).allow(null),
  ChronicCond_HeartFailure: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'Yes', 'No', 'Yes (1)', 'No (0)')).allow(null),
  ChronicCond_KidneyDisease: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'Yes', 'No', 'Yes (1)', 'No (0)')).allow(null),
  ChronicCond_Cancer: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'Yes', 'No', 'Yes (1)', 'No (0)')).allow(null),
  ChronicCond_ObstrPulmonary: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'Yes', 'No', 'Yes (1)', 'No (0)')).allow(null),
  ChronicCond_Depression: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'Yes', 'No', 'Yes (1)', 'No (0)')).allow(null),
  ChronicCond_Diabetes: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'Yes', 'No', 'Yes (1)', 'No (0)')).allow(null),
  ChronicCond_IschemicHeart: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'Yes', 'No', 'Yes (1)', 'No (0)')).allow(null),
  ChronicCond_Osteoporosis: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'Yes', 'No', 'Yes (1)', 'No (0)')).allow(null),
  ChronicCond_rheumatoidarthritis: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'Yes', 'No', 'Yes (1)', 'No (0)')).allow(null),
  ChronicCond_stroke: Joi.alternatives().try(Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'Yes', 'No', 'Yes (1)', 'No (0)')).allow(null)
}).unknown(true);

/* -----------------------------------------------------------------------------
   Provider: single claim submit
----------------------------------------------------------------------------- */
router.post('/submit', auth('provider'), async (req, res) => {
  try {
    const body = await claimSchema.validateAsync(req.body);
    const db = getDb();
    const existingClaims = db.collection(config.collections.existingClaims);
    const newClaims = db.collection(config.collections.newClaims);
  await connectFilteredMongo();
  const filteredCol = getFilteredDatasetCol();

    // Prepare common fields
    const commonDoc = {
      Provider: req.user.providerId,
      ClaimID: body.ClaimID,
      BeneID: body.BeneID,
      ClaimStartDt: body.ClaimStartDt ? new Date(body.ClaimStartDt) : null,
      ClaimEndDt: body.ClaimEndDt ? new Date(body.ClaimEndDt) : null,
      DOB: body.DOB ? new Date(body.DOB) : null,
      AdmissionDt: body.AdmissionDt ? new Date(body.AdmissionDt) : null,
      InscClaimAmtReimbursed: body.InscClaimAmtReimbursed != null ? Number(body.InscClaimAmtReimbursed) : null,
      DiagnosisGroupCode: body.DiagnosisGroupCode,
      Gender: body.Gender ? (
        String(body.Gender).toLowerCase().includes('female') || String(body.Gender).includes('F') || body.Gender === '2' || body.Gender === 2 ? 2 :
        String(body.Gender).toLowerCase().includes('male') || String(body.Gender).includes('M') || body.Gender === '1' || body.Gender === 1 ? 1 :
        null
      ) : null
    };

    // Chronic conditions mapping (standardized to 1 or 0)
    const chronicFields = [
      'ChronicCond_Alzheimer',
      'ChronicCond_HeartFailure',
      'ChronicCond_KidneyDisease',
      'ChronicCond_Cancer',
      'ChronicCond_ObstrPulmonary',
      'ChronicCond_Depression',
      'ChronicCond_Diabetes',
      'ChronicCond_IschemicHeart',
      'ChronicCond_Osteoporosis',
      'ChronicCond_rheumatoidarthritis',
      'ChronicCond_stroke'
    ];

    chronicFields.forEach(field => {
      const val = body[field];
      commonDoc[field] = (val === '1' || val === 1 || String(val).toLowerCase().includes('yes')) ? 1 : 
                         (val === '0' || val === 0 || String(val).toLowerCase().includes('no')) ? 0 : null;
    });


    // Document for NewClaims (with status/timestamps)
    const newClaimDoc = {
      ...commonDoc,
      status: 'Pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insert only into NewClaims
    const newResult = await newClaims.insertOne(newClaimDoc);
    console.log('NewClaims document inserted:', newResult.insertedId);

    // Insert into filtered collection (using MONGO_URI2)
    const filteredDoc = {
      Provider: req.user.providerId,
      BeneID: body.BeneID,
      ClaimStartDt: commonDoc.ClaimStartDt,
      ClaimEndDt: commonDoc.ClaimEndDt
    };
    await filteredCol.insertOne(filteredDoc);

    // Log the claim submission
    console.log(`Claim submitted: ${JSON.stringify(body)}`);

    res.json({ 
      message: 'Claim submitted successfully',
      claimId: body.ClaimID
    });
  } catch (e) {
    console.error('Claim submission error:', e);
    res.status(400).json({ error: e.message });
  }
});

/* -----------------------------------------------------------------------------
   Provider: BULK submit (array of claims)
----------------------------------------------------------------------------- */
router.post('/submit-bulk', auth('provider'), async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || !items.length) return res.status(400).json({ error: 'items[] required' });

    // Minimal per-row validation
    const rowSchema = Joi.object({
      ClaimID: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
      BeneID: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
      ClaimStartDt: Joi.alternatives().try(Joi.date(), Joi.string().allow('', null)).optional(),
      ClaimEndDt: Joi.alternatives().try(Joi.date(), Joi.string().allow('', null)).optional(),
      DOB: Joi.alternatives().try(Joi.date(), Joi.string().allow('', null)).optional(),
      AdmissionDt: Joi.alternatives().try(Joi.date(), Joi.string().allow('', null)).optional(),
      InscClaimAmtReimbursed: Joi.alternatives().try(Joi.number(), Joi.string()).allow(null, ''),
      DiagnosisGroupCode: Joi.alternatives().try(Joi.string(), Joi.number()).allow('', null),
      Gender: Joi.alternatives().try(Joi.string(), Joi.number()).allow('', null),
      ChronicCond_Alzheimer: Joi.any(),
      ChronicCond_HeartFailure: Joi.any(),
      ChronicCond_KidneyDisease: Joi.any(),
      ChronicCond_Cancer: Joi.any(),
      ChronicCond_ObstrPulmonary: Joi.any(),
      ChronicCond_Depression: Joi.any(),
      ChronicCond_Diabetes: Joi.any(),
      ChronicCond_IschemicHeart: Joi.any(),
      ChronicCond_Osteoporosis: Joi.any(),
      ChronicCond_rheumatoidarthritis: Joi.any(),
      ChronicCond_stroke: Joi.any()
    }).unknown(true);

    const cleaned = [];
    for (const r of items) {
      const v = await rowSchema.validateAsync(r);
      const commonDoc = {
        Provider: req.user.providerId,
        ClaimID: String(v.ClaimID),
        BeneID: String(v.BeneID),
        ClaimStartDt: v.ClaimStartDt ? new Date(v.ClaimStartDt) : null,
        ClaimEndDt: v.ClaimEndDt ? new Date(v.ClaimEndDt) : null,
        DOB: v.DOB ? new Date(v.DOB) : null,
        AdmissionDt: v.AdmissionDt ? new Date(v.AdmissionDt) : null,
        InscClaimAmtReimbursed: v.InscClaimAmtReimbursed != null ? Number(v.InscClaimAmtReimbursed) : null,
        DiagnosisGroupCode: v.DiagnosisGroupCode ? String(v.DiagnosisGroupCode) : null,
        Gender: v.Gender ? Number(v.Gender) : null
      };

      // Chronic conditions
      const chronicFields = [
        'ChronicCond_Alzheimer',
        'ChronicCond_HeartFailure',
        'ChronicCond_KidneyDisease',
        'ChronicCond_Cancer',
        'ChronicCond_ObstrPulmonary',
        'ChronicCond_Depression',
        'ChronicCond_Diabetes',
        'ChronicCond_IschemicHeart',
        'ChronicCond_Osteoporosis',
        'ChronicCond_rheumatoidarthritis',
        'ChronicCond_stroke'
      ];
      chronicFields.forEach(field => {
        commonDoc[field] = v[field] != null ? Number(v[field]) : null;
      });

      cleaned.push({
        ...commonDoc,
        status: 'Pending',
        createdAt: new Date()
      });
    }

  const db = getDb();
  const newClaims = db.collection(config.collections.newClaims);

  if (!cleaned.length) return res.json({ inserted: 0 });

  const opts = { ordered: false };
  await newClaims.insertMany(cleaned, opts);

  res.json({ inserted: cleaned.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* -----------------------------------------------------------------------------
   Provider stats (enhanced)
----------------------------------------------------------------------------- */
router.get('/provider-stats', auth('provider'), async (req, res) => {
  try {
    const db = getDb();
    const col = db.collection(config.collections.newClaims);
    
    const [agg] = await col
      .aggregate([
        { $match: { Provider: req.user.providerId } },
        {
          $group: {
            _id: '$Provider',
            total: { $sum: 1 },
            approved: {
              $sum: {
                $cond: [
                  { $regexMatch: { input: "$status", regex: /^approved$/i } },
                  1,
                  0,
                ],
              },
            },
            rejected: {
              $sum: {
                $cond: [
                  { $regexMatch: { input: "$status", regex: /^rejected$/i } },
                  1,
                  0,
                ],
              },
            },
            pending: {
              $sum: {
                $cond: [
                  { $regexMatch: { input: "$status", regex: /^pending$/i } },
                  1,
                  0,
                ],
              },
            },
            totalReimb: { $sum: { $toDouble: '$InscClaimAmtReimbursed' } }
          }
        }
      ])
      .toArray();

    const recent = await col
      .find(
        { Provider: req.user.providerId },
        {
          projection: {
            ClaimID: 1,
            ClaimStartDt: 1,
            InscClaimAmtReimbursed: 1,
            DiagnosisGroupCode: 1,
            status: 1
          }
        }
      )
      .sort({ ClaimStartDt: -1 })
      .limit(10)
      .toArray();

    const stats = agg || { total: 0, approved: 0, rejected: 0, pending: 0, totalReimb: 0 };
    
    const totalReimbursed = stats.totalReimb || 0;
    const avgReimbursed = stats.total > 0 ? Math.round(totalReimbursed / stats.total) : 0;
    const typeCounts = {
      Pending: stats.pending || 0,
      Approved: stats.approved || 0,
      Rejected: stats.rejected || 0
    };

    res.json({
      totalReimbursed,
      avgReimbursed,
      typeCounts,
      recent
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* -----------------------------------------------------------------------------
   Admin: pending queue (NewClaims only)
----------------------------------------------------------------------------- */
router.get('/pending', auth('admin'), async (req, res) => {
  try {
    const db = getDb();
    const col = db.collection(config.collections.newClaims);
    const items = await col
      .find(
        { status: { $regex: /^pending$/i } },
        {
          projection: {
            _id: 0,
            ClaimID: 1,
            Provider: 1,
            ClaimStartDt: 1,
            InscClaimAmtReimbursed: 1,
            DiagnosisGroupCode: 1,
            status: 1
          }
        }
      )
      .sort({ ClaimStartDt: -1 })
      .limit(200)
      .toArray();

    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =============================================================================
   ADMIN Review flow:
   GET /api/claims/:id/score
   1) Read raw claim from NewClaims (fallback ExistingClaims) → get Provider
   2) Load ALL provider history from ExistingClaims
   3) Compute 14-feature vector in Node (safe coercions)
   4) POST {data:[[...14]]} to Azure ML
============================================================================= */
router.get('/:id/score', auth('admin'), async (req, res) => {
  try {
    if (!config.mlUrl || !config.mlKey) {
      return res.status(500).json({ error: 'ML_URL / ML_KEY not configured' });
    }

    const db = getDb();
    const newCol = db.collection(config.collections.newClaims);
    const oldCol = db.collection(config.collections.existingClaims);

    // (1) claim lookup
    let claim = await newCol.findOne({ ClaimID: req.params.id });
    if (!claim) claim = await oldCol.findOne({ ClaimID: req.params.id });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    const providerId = claim.Provider;
    if (!providerId) return res.status(400).json({ error: 'Claim has no Provider' });

    // (2) provider history
    const docs = await oldCol
      .find(
        { Provider: providerId },
        {
          projection: {
            BeneID: 1,
            InscClaimAmtReimbursed: 1,
            DiagnosisGroupCode: 1,
            ClaimStartDt: 1,
            ClaimEndDt: 1,
            DOB: 1,
            AdmissionDt: 1,
            Gender: 1,
            ChronicCond_Alzheimer: 1,
            ChronicCond_HeartFailure: 1,
            ChronicCond_KidneyDisease: 1,
            ChronicCond_Cancer: 1,
            ChronicCond_ObstrPulmonary: 1,
            ChronicCond_Depression: 1,
            ChronicCond_Diabetes: 1,
            ChronicCond_IschemicHeart: 1,
            ChronicCond_Osteoporosis: 1,
            ChronicCond_rheumatoidarthritis: 1,
            ChronicCond_stroke: 1
          }
        }
      )
      .toArray();
    if (!docs.length) return res.status(404).json({ error: `No history for Provider=${providerId}` });

    // (3) robust feature computation
    const MS_DAY = 86400000;
    const MS_YEAR = 365 * MS_DAY;
    const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const toDate = (v) => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d : null;
    };
    const isMale = (g) => g === 1 || g === '1' || g === 'M' || g === 'm';
    const isFemale = (g) => g === 2 || g === '2' || g === 'F' || g === 'f';
    // Debug: Print raw claim and provider history for aggregation
    console.log('--- Raw Claim for Aggregation ---');
    console.log(JSON.stringify(claim, null, 2));
    console.log('--- Provider History (ExistingClaims) ---');
    console.log(JSON.stringify(docs, null, 2));

            // ================= DEBUG LOGS FOR AGGREGATION =================
            console.log('\n================ RAW CLAIM FOR AGGREGATION ================');
            console.dir(claim, { depth: null, colors: true });
            console.log('\n================ PROVIDER HISTORY (ExistingClaims) ================');
            console.dir(docs, { depth: null, colors: true });
            // ==============================================================
    let n = 0;
    let sumAmt = 0,
      sumAmtSq = 0,
      maxAmt = 0;
    let sumLoS = 0,
      sumAge = 0;
    let male = 0,
      female = 0,
      inpatient = 0,
      outpatient = 0;
    const beneSet = new Set();
    const dxSet = new Set();

    const chronicKeys = [
      'ChronicCond_Alzheimer',
      'ChronicCond_HeartFailure',
      'ChronicCond_KidneyDisease',
      'ChronicCond_Cancer',
      'ChronicCond_ObstrPulmonary',
      'ChronicCond_Depression',
      'ChronicCond_Diabetes',
      'ChronicCond_IschemicHeart',
      'ChronicCond_Osteoporosis',
      'ChronicCond_rheumatoidarthritis',
      'ChronicCond_stroke'
    ];
    const chronicSums = Object.fromEntries(chronicKeys.map((k) => [k, 0]));

    for (const d of docs) {
      n += 1;
      const amt = toNum(d.InscClaimAmtReimbursed);
      sumAmt += amt;
      sumAmtSq += amt * amt;
      if (amt > maxAmt) maxAmt = amt;

      if (d.BeneID != null) beneSet.add(String(d.BeneID));
      if (d.DiagnosisGroupCode != null) dxSet.add(String(d.DiagnosisGroupCode));

      const start = toDate(d.ClaimStartDt);
      const end = toDate(d.ClaimEndDt);
      const dob = toDate(d.DOB);
      if (start && end) sumLoS += (end - start) / MS_DAY;
      if (start && dob) sumAge += (start - dob) / MS_YEAR;

      if (isMale(d.Gender)) male += 1;
      else if (isFemale(d.Gender)) female += 1;

      const adm = toDate(d.AdmissionDt);
      if (adm) inpatient += 1;
      else outpatient += 1;

      for (const k of chronicKeys) chronicSums[k] += toNum(d[k]);
    }

    const total_claims = n;
    const total_beneficiaries = beneSet.size;

    const avg_claim_amount = sumAmt / (n || 1);
    const variance = Math.max(sumAmtSq / (n || 1) - avg_claim_amount * avg_claim_amount, 0);
    const std_claim_amount = Math.sqrt(variance);

    const avg_length_of_stay = sumLoS / (n || 1);
    const distinct_diagnoses = dxSet.size;
    const avg_beneficiary_age = sumAge / (n || 1);

    const totalGender = male + female;
    const pct_male = totalGender ? male / totalGender : 0;
    const pct_female = 1 - pct_male;

    const chronicMeans = chronicKeys.map((k) => chronicSums[k] / (n || 1));
    const avg_chronic_conditions = chronicMeans.reduce((a, b) => a + b, 0) / chronicMeans.length;

    const inpatient_outpatient_ratio = inpatient / (outpatient + 1);
    const claims_per_beneficiary = total_claims / (total_beneficiaries + 1);
    const max_to_avg_claim_ratio = maxAmt / (avg_claim_amount + 1);

    const featuresArray = [
      total_claims,
      total_beneficiaries,
      avg_claim_amount,
      maxAmt,
      std_claim_amount,
      avg_length_of_stay,
      distinct_diagnoses,
      avg_beneficiary_age,
      pct_male,
      pct_female,
      avg_chronic_conditions,
      inpatient_outpatient_ratio,
      claims_per_beneficiary,
      max_to_avg_claim_ratio
    ];

    // ================= DEBUG LOGS FOR AGGREGATED FEATURES =================
    console.log('\n================ AGGREGATED FEATURES FOR MODEL ================');
    console.dir(featuresArray, { depth: null, colors: true });
    // ==============================================================
    const payload = { data: [featuresArray] };

    // (4) score
    console.log('Sending ML request with payload:', JSON.stringify(payload, null, 2));
    
    const { data: mlResponse } = await axios.post(config.mlUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.mlKey}`
      },
      timeout: 15000
    });
    // Debug: Print computed features before sending to model
    console.log('--- Aggregated Features for Model ---');
    console.log(JSON.stringify(featuresArray, null, 2));

    console.log('ML Response received:', JSON.stringify(mlResponse, null, 2));

    // Extract the prediction result
    const prediction = mlResponse.result && mlResponse.result[0];
    const fraudScore = prediction !== undefined ? prediction : null;
    const fraudLabel = fraudScore === 1 ? 'Fraudulent' : fraudScore === 0 ? 'Legitimate' : 'Unknown';

    res.json({
      claimId: req.params.id,
      providerId,
      rawClaim: claim,
      featuresArray,
      payloadSent: payload,
      mlResponse,
      fraudScore,
      fraudLabel,
      success: true
    });
  } catch (e) {
    console.error('ML Scoring Error:', e.message);
    console.error('Error details:', e.response?.data || e);
    res.status(500).json({ 
      error: e.message,
      details: e.response?.data || 'No additional details',
      claimId: req.params.id
    });
  }
});

/* -----------------------------------------------------------------------------
   Admin: approve/reject (mirror to both collections)
----------------------------------------------------------------------------- */
router.post('/:id/review', auth('admin'), async (req, res) => {
  try {
    const { decision, score, label } = req.body;
    if (!['Approved', 'Rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be Approved or Rejected' });
    }

    const db = getDb();
    const newCol = db.collection(config.collections.newClaims);
    const oldCol = db.collection(config.collections.existingClaims);

    const set = {
      status: decision,
      reviewedAt: new Date(),
      reviewedBy: req.user.email,
      ...(typeof score === 'number' ? { mlScore: score } : {}),
      ...(label ? { mlLabel: label } : {})
    };

    const r1 = await newCol.updateOne({ ClaimID: req.params.id }, { $set: set });
    await oldCol.updateOne({ ClaimID: req.params.id }, { $set: set }); // best-effort mirror

    if (r1.matchedCount === 0) return res.status(404).json({ error: 'Claim not found in NewClaims' });

    // Run fraud prediction & explanation script
    const py = spawn('python3', ['tools/fraud_explain.py', req.params.id], { stdio: ['ignore', 'pipe', 'pipe'] });

    let pyOut = '';
    py.stdout.on('data', (data) => { pyOut += data.toString(); });
    py.stderr.on('data', (data) => { console.error('Python error:', data.toString()); });

    py.on('close', async (code) => {
      console.log('Fraud explanation script exited with code', code);
      if (pyOut) {
        try {
          const parsed = JSON.parse(pyOut);
          await newCol.updateOne({ ClaimID: req.params.id }, { $set: { fraudExplanation: parsed } });
          await oldCol.updateOne({ ClaimID: req.params.id }, { $set: { fraudExplanation: parsed } });
        } catch (err) {
          console.error('Failed to parse fraud explanation output:', err);
        }
      }
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* -----------------------------------------------------------------------------
   Admin: overview counts (from NewClaims)
----------------------------------------------------------------------------- */
router.get('/admin-summary', auth('admin'), async (req, res) => {
  try {
    const db = getDb();
    const col = db.collection(config.collections.newClaims);

    const [overall] = await col
      .aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            approved: {
              $sum: {
                $cond: [
                  { $regexMatch: { input: "$status", regex: /^approved$/i } },
                  1,
                  0,
                ],
              },
            },
            rejected: {
              $sum: {
                $cond: [
                  { $regexMatch: { input: "$status", regex: /^rejected$/i } },
                  1,
                  0,
                ],
              },
            },
            pending: {
              $sum: {
                $cond: [
                  { $regexMatch: { input: "$status", regex: /^pending$/i } },
                  1,
                  0,
                ],
              },
            },
          }
        }
      ])
      .toArray();

    const perProvider = await col
      .aggregate([
        {
          $group: {
            _id: { provider: '$Provider', status: { $toLower: '$status' } },
            n: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: '$_id.provider',
            counts: { $push: { k: '$_id.status', v: '$n' } }
          }
        },
        {
          $project: {
            _id: 0,
            Provider: '$_id',
            counts: { $arrayToObject: '$counts' }
          }
        }
      ])
      .toArray();

    res.json({ overall: overall || null, perProvider });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;