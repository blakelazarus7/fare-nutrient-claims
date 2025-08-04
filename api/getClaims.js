export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.eatfare.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const sku = req.query.sku;
  const airtableApiKey = process.env.AIRTABLE_API_KEY;
  const baseId = "appqVG3KsoAa1eRai";
  const produceTable = "Produce";
  const claimsTable = "Nutrient Claims";

  try {
    // STEP 1 – Fetch Produce row by SKU
    const produceRes = await fetch(
      `https://api.airtable.com/v0/${baseId}/${produceTable}?filterByFormula={SKU}="${sku}"`,
      {
        headers: {
          Authorization: `Bearer ${airtableApiKey}`,
        },
      }
    );

    const produceData = await produceRes.json();
    if (!produceData.records.length) {
      return res.status(404).json({ error: "SKU not found." });
    }

    const nutrientComparison = produceData.records[0].fields["Nutrient Comparison"];
    if (!nutrientComparison) {
      return res.status(200).json({ sku, topNutrients: [] });
    }

    // STEP 2 – Parse Comparison string
    const lines = nutrientComparison.trim().split("\n");
    const parsed = lines
      .map((line) => {
        const match = line.match(/^(.+?): (.+?) \(([^)]+) baseline (.+)\)$/);
        if (!match) return null;
        const [, name, value, symbol, baseline] = match;
        return {
          name: name.trim(),
          symbol,
          delta: parseFloat(value) - parseFloat(baseline),
          original: line,
        };
      })
      .filter(Boolean);

    // STEP 3 – Choose top 2 nutrients (prefer higher)
    let top = parsed.filter((n) => n.symbol.includes("higher"));
    if (top.length < 2) {
      const others = parsed.filter((n) => !n.symbol.includes("higher"));
      others.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
      top = [...top, ...others.slice(0, 2 - top.length)];
    } else {
      top.sort((a, b) => b.delta - a.delta);
    }
    top = top.slice(0, 2);

    // STEP 4 – Fetch all nutrient claims
    const claimsRes = await fetch(
      `https://api.airtable.com/v0/${baseId}/${claimsTable}`,
      {
        headers: {
          Authorization: `Bearer ${airtableApiKey}`,
        },
      }
    );

    const claimsData = await claimsRes.json();

    // STEP 5 – Enrich top nutrients with claim data
    const topNutrients = top.map((item) => {
      const match = claimsData.records.find((r) => {
        return r.fields["Name"]?.toLowerCase().trim() === item.name.toLowerCase().trim();
      });

      const isHigher = item.symbol.includes("higher");

      return {
        nutrient: item.name,
        headline: match
          ? isHigher
            ? match.fields["Header 1"]
            : match.fields["Header 2"]
          : `${item.name} level ${item.symbol}`,
        icon: match?.fields["Icon"]?.[0]?.url || "",
        details: match?.fields["Details"] || "",
      };
    });

    return res.status(200).json({ sku, topNutrients });
  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
