export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.eatfare.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const skuSlug = req.query.sku;
  const airtableApiKey = process.env.AIRTABLE_API_KEY;
  const baseId = "appqVG3KsoAa1eRai";
  const produceTable = "Produce";
  const claimsTable = "Nutrient Claims";

  try {
    const fetchProduce = await fetch(
      `https://api.airtable.com/v0/${baseId}/${produceTable}?filterByFormula={SKU}='${skuSlug}'`,
      {
        headers: {
          Authorization: `Bearer ${airtableApiKey}`,
        },
      }
    );

    const produceData = await fetchProduce.json();
    if (!produceData.records.length) {
      return res.status(404).json({ error: "SKU not found." });
    }

    const nutrientComparison = produceData.records[0].fields["Nutrient Comparison"];
    if (!nutrientComparison) {
      return res.status(200).json({ claims: [] });
    }

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

    let top = parsed.filter((n) => n.symbol.includes("higher"));
    if (top.length < 2) {
      const others = parsed.filter((n) => !n.symbol.includes("higher"));
      others.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
      top = [...top, ...others.slice(0, 2 - top.length)];
    } else {
      top.sort((a, b) => b.delta - a.delta);
    }
    top = top.slice(0, 2);

    const fetchClaims = await fetch(`https://api.airtable.com/v0/${baseId}/${claimsTable}`, {
      headers: {
        Authorization: `Bearer ${airtableApiKey}`,
      },
    });

    const claimsData = await fetchClaims.json();

    const enriched = top.map((item) => {
      const match = claimsData.records.find((r) => {
        return r.fields["Name"]?.toLowerCase().trim() === item.name.toLowerCase().trim();
      });
      if (!match) return null;
      const isHigher = item.symbol.includes("higher");
      return {
        name: item.name,
        claim: isHigher ? match.fields["Header 1"] : match.fields["Header 2"],
        details: match.fields["Details"] || "",
        icon: match.fields["Icon"]?.[0]?.url || null,
      };
    }).filter(Boolean);

    return res.status(200).json({ claims: enriched });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
