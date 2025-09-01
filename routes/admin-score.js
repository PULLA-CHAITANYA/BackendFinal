// server/routes/admin-score.js
import express from "express";
import fetch from "node-fetch";
import { auth } from "../middleware/auth.js";

// Import aggregation functions
import { buildVectorForClaimId } from "../scripts/aggregate.js";

const router = express.Router();

/**
 * Resolve model endpoint + headers from env
 */
function getModelConfig() {
  const url =
    process.env.AML_URL ||
    process.env.AML_ENDPOINT ||
    process.env.AZURE_ML_ENDPOINT ||
    process.env.MODEL_URL ||
    "";

  const key =
    process.env.AML_KEY ||
    process.env.AZURE_ML_KEY ||
    process.env.MODEL_KEY ||
    "";

  if (!url || !/^https?:\/\//i.test(url)) {
    return { error: "Invalid or missing ML endpoint URL" };
  }

  const headers = {
    "Content-Type": "application/json",
  };

  // Azure ML expects "Authorization: Bearer <key>"
  if (key) {
    headers.Authorization = `Bearer ${key}`;
    // Some Azure ML deployments might need this header instead
    if (process.env.AZUREML_HEADER) {
      headers[process.env.AZUREML_HEADER] = key;
    }
  }

  return { url, headers };
}

/**
 * Build payload in the exact format the model expects
 */
async function buildPayload(claim, aggregatedData) {
  if (!aggregatedData || !aggregatedData.vector) {
    throw new Error("Aggregated data is required for model prediction");
  }

  // The model expects exactly these 14 features in this order:
  // [total_claims, total_beneficiaries, avg_claim_amount, max_claim_amount, 
  //  std_claim_amount, avg_length_of_stay, distinct_diagnoses, avg_beneficiary_age,
  //  pct_male, pct_female, avg_chronic_conditions, inpatient_outpatient_ratio, 
  //  claims_per_beneficiary, max_to_avg_claim_ratio]
  
  const modelFeatures = [
    aggregatedData.explain.totalClaims,
    aggregatedData.explain.totalBeneficiaries, 
    aggregatedData.explain.avgClaim,
    aggregatedData.explain.maxClaim,
    aggregatedData.explain.stdClaim,
    aggregatedData.explain.avgStay,
    aggregatedData.explain.distinctDx,
    aggregatedData.explain.avgAge,
    aggregatedData.explain.pctMale,
    aggregatedData.explain.pctFemale,
    aggregatedData.explain.avgChronicPerClaim,
    aggregatedData.explain.ioRatio,
    aggregatedData.explain.claimsPerBene,
    aggregatedData.explain.maxToAvg
  ];

  return {
    data: [modelFeatures]
  };
}

/**
 * Generate AI explanation using Cohere
 */
async function generateAIExplanation(provider, prediction, probability, topFeatures) {
  try {
    const cohereApiKey = process.env.COHERE_API_KEY;
    if (!cohereApiKey) {
      return "AI explanation unavailable - Cohere API key not configured";
    }

    const prompt = `
The fraud detection model predicted **${prediction}**
for Provider: ${provider} with probability ${probability.toFixed(2)}.

The top factors influencing this prediction were:
${topFeatures.map(f => `- ${f.feature}: value=${f.value}, impact=${f.impact.toFixed(4)}`).join('\n')}

Please explain the result as **3–5 short, high-impact bullet points**
that a business stakeholder or auditor can quickly understand.
Keep each point concise (max 1 sentence).
`;

    const response = await fetch('https://api.cohere.ai/v1/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cohereApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'command-r',
        message: prompt,
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      throw new Error(`Cohere API error: ${response.status}`);
    }

    const data = await response.json();
    return data.text?.trim() || "Unable to generate explanation";
  } catch (error) {
    console.error('Error generating AI explanation:', error);
    return `AI explanation error: ${error.message}`;
  }
}

router.get("/score/:claimId", auth('admin'), async (req, res) => {
  try {
    const { claimId } = req.params;

    console.log(`Starting scoring for claim: ${claimId}`);

    // Get aggregated data first (includes raw claim)
    const aggregatedResult = await buildVectorForClaimId(claimId);
    
    if (!aggregatedResult.rawClaim) {
      return res.status(404).json({ 
        error: "Claim not found",
        detail: aggregatedResult.explain?.reason || "Claim not found in database"
      });
    }

    const rawClaim = aggregatedResult.rawClaim;
    console.log(`Found claim for provider: ${rawClaim.Provider}`);

    // Build comprehensive payload with aggregated features
    const payloadSent = await buildPayload(rawClaim, aggregatedResult);
    console.log(`Built payload with ${aggregatedResult.vector?.length || 0} aggregated features`);

    const cfg = getModelConfig();
    if (cfg.error) {
      console.error("Model config error:", cfg.error);
      return res.status(400).json({ error: cfg.error });
    }

    console.log(`Calling ML endpoint: ${cfg.url}`);

    // Call model endpoint
    const resp = await fetch(cfg.url, {
      method: "POST",
      headers: cfg.headers,
      body: JSON.stringify(payloadSent),
    });

    const text = await resp.text();
    console.log(`ML response status: ${resp.status}, body length: ${text.length}`);
    
    let body;
    try {
      body = JSON.parse(text);
    } catch (parseError) {
      console.error("Failed to parse ML response:", parseError);
      body = { raw: text, parseError: parseError.message };
    }

    if (!resp.ok) {
      console.error("ML endpoint error:", resp.status, body);
      return res.status(resp.status).json({
        error: body?.error || body?.message || `Scoring failed (${resp.status})`,
        raw: body,
        statusCode: resp.status
      });
    }

    // Extract prediction and probability from model response
    const modelResult = body?.results?.[0] || body;
    const prediction = modelResult?.prediction ?? body?.prediction ?? body?.result;
    const probability = modelResult?.probability ?? body?.probability ?? body?.score ?? body?.fraud_probability;
    
    // Determine fraud label
    const fraudLabel = prediction === 1 ? "Fraud" : "Not Fraud";
    
    console.log(`Model prediction: ${prediction}, probability: ${probability}, label: ${fraudLabel}`);

    // Extract real SHAP values and top features from model response
    let featureImportance = [];
    
    if (modelResult?.top_features) {
      // Use the top features directly from the model
      featureImportance = modelResult.top_features.slice(0, 5);
    } else if (modelResult?.shap_values && body?.feature_names) {
      // Build top features from SHAP values and feature names
      const featureNames = body.feature_names;
      const shapValues = modelResult.shap_values;
      const featureValues = payloadSent.data[0];
      
      featureImportance = shapValues
        .map((shap, idx) => ({
          feature: featureNames[idx],
          value: featureValues[idx],
          impact: shap
        }))
        .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
        .slice(0, 5);
    } else {
      // Fallback: create basic feature importance from aggregated data
      const featureNames = [
        'total_claims', 'total_beneficiaries', 'avg_claim_amount', 'max_claim_amount',
        'std_claim_amount', 'avg_length_of_stay', 'distinct_diagnoses', 'avg_beneficiary_age',
        'pct_male', 'pct_female', 'avg_chronic_conditions', 'inpatient_outpatient_ratio',
        'claims_per_beneficiary', 'max_to_avg_claim_ratio'
      ];
      
      const featureValues = payloadSent.data[0];
      featureImportance = featureNames.slice(0, 5).map((name, idx) => ({
        feature: name,
        value: featureValues[idx],
        impact: 0
      }));
    }

    // Generate AI explanation
    const aiExplanation = await generateAIExplanation(
      rawClaim.Provider,
      fraudLabel,
      probability || 0,
      featureImportance
    );

    const result = {
      label: fraudLabel,
      prediction: prediction,
      probability: probability,
      raw: body,
      topFeatures: featureImportance,
      aiExplanation: aiExplanation,
      confidence: body?.confidence,
    };

    console.log(`Scoring completed. Label: ${result.label}, Probability: ${result.probability}`);

    return res.json({
      rawClaim,
      payloadSent,
      aggregatedData: {
        vector: aggregatedResult.vector,
        explain: aggregatedResult.explain
      },
      result,
      label: result.label,
      prediction: result.prediction,
      probability: result.probability,
      topFeatures: result.topFeatures,
      aiExplanation: result.aiExplanation,
      raw: result.raw,
    });
  } catch (e) {
    console.error("admin-score error:", e);
    return res.status(500).json({ 
      error: "Server error", 
      detail: e.message,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

export default router;