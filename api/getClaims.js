export default async function handler(req, res) {
  console.log("🔥 GET /api/getClaims called");

  const { sku } = req.query;
  console.log("🔍 SKU param:", sku);

  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = "appXXDxqsKzF2RoF4";
  const tableName = "Produce";

  if (!sku || !apiKey) {
    console.error("❌ Missing SKU or API key");
    return res.status(400).json({ error: "Missing SKU or Airtable API key." });
  }

  const airtableUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?filterByFormula=({SKU}="${sku}")`;

  console.log("🌐 Airtable URL:", airtableUrl);

  try {
    const airtableRes = await fetch(airtableUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    const statusCode = airtableRes.status;
    const body = await airtableRes.text();

    console.log(`📡 Airtable response [${statusCode}]:`, body);

    if (statusCode !== 200) {
      return res.status(statusCode).json({ error: "Airtable fetch failed", body });
    }

    const json = JSON.parse(body);
    const record = json.records?.[0];

    if (!record) {
      console.warn("⚠️ No records returned for that SKU");
      return res.status(404).json({ error: "SKU not found." });
    }

    const fields = record.fields;
    const nutrientComparison = fields["Nutrient Comparison"];

    return res.status(200).json({
      sku,
      comparison: nutrientComparison || "No nutrient data available.",
    });
  } catch (err) {
    console.error("💥 Exception thrown:", err);
    return res.status(500).json({ error: "Server crash", message: err.message });
  }
}
