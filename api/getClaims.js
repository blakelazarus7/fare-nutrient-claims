export default async function handler(req, res) {
  // ✅ CORS setup
  const allowedOrigins = ["https://www.eatfare.com", "http://localhost:3000"];
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ✅ Env variables
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const BASE_ID = 'appXXDxqsKzF2RoF4';
  const PRODUCE_TABLE = 'Produce';
  const CLAIMS_TABLE = 'Nutrient Claims';

  const { sku } = req.query;

  if (!sku) {
    return res.status(400).json({ error: "Missing SKU in query" });
  }

  try {
    // 🔍 1. Get Produce record by SKU
    const produceResp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PRODUCE_TABLE}?filterByFormula={SKU}="${sku}"`, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      },
    });

    const produceData = await produceResp.json();
    const record = produceData.records[0];

    if (!record) {
      return res.status(404).json({ error: "SKU not found" });
    }

    const comparisonText = record.fields["Nutrient Comparison"];
    if (!comparisonText) {
      return res.status(404).json({ error: "Nutrient Comparison field missing" });
    }

    // 🧠 2. Parse lines
    const lines = comparisonText.split("\n");
    const parsed = lines.map((line) => {
      const [name, rest] = line.split(": ");
      const isHigher = rest.includes("⬆️");
      const value = parseFloat(rest.match(/[\d.]+/g)?.[0] || "0");
      return { name: name.trim(), line, isHigher, value };
    });

    // 🔝 3. Sort for top 2 nutrients
    const topTwo = parsed
      .filter((p) => p.isHigher)
      .sort((a, b) => b.value - a.value)
      .slice(0, 2);

    if (topTwo.length < 2) {
      const fill = parsed
        .filter((p) => !topTwo.includes(p))
        .sort((a, b) => b.value - a.value);
      while (topTwo.length < 2 && fill.length > 0) {
        topTwo.push(fill.shift());
      }
    }

    // 🔎 4. Look up icons + headlines
    const nutrientQuery = `OR(${topTwo.map(n => `{Name}="${n.name}"`).join(",")})`;
    const claimsResp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${CLAIMS_TABLE}?filterByFormula=${encodeURIComponent(nutrientQuery)}`, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      },
    });

    const claimsData = await claimsResp.json();
    const claimsMap = {};
    claimsData.records.forEach(rec => {
      claimsMap[rec.fields["Name"]] = {
        icon: rec.fields["Icon"]?.[0]?.url || "",
        header1: rec.fields["Header 1"] || "",
        header2: rec.fields["Header 2"] || "",
        details: rec.fields["Details"] || ""
      };
    });

    // ✅ 5. Build response
    const topNutrients = topTwo.map((nutrient) => {
      const claim = claimsMap[nutrient.name] || {};
      return {
        nutrient: nutrient.name,
        headline: nutrient.isHigher ? claim.header1 : claim.header2 || "",
        icon: claim.icon || "",
        details: claim.details || ""
      };
    });

    return res.status(200).json({
      sku,
      topNutrients,
    });
  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({ error: "Internal Server Error", detail: err.message });
  }
}
