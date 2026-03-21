import Anthropic from '@anthropic-ai/sdk';
import { neon } from '@neondatabase/serverless';
import { verifyAuth } from '../_auth.js';

export const config = { maxDuration: 300 };

const SYSTEM_PROMPT = `You are an investor discovery specialist. Your job is to find ~20 investor candidates that are a strong fit for a startup's current fundraise, using web research.

## Execution Protocol

### Step 1 — Understand the Company
You will receive the full company profile. Analyze:
- Stage, raise amount, valuation, industry, sector
- Target investor types (VC, Angel, Growth Equity, Strategic, etc.)
- Investment thesis, moat, competitive advantages
- Team background, traction metrics
- Geographic location

### Step 2 — Research Investors
Run 8-12 focused web searches to find investors matching the profile:
1. "<industry>" "<stage>" investors 2025 2026 — find active investors in the space
2. "<sector>" seed investors fund — sector-specific funds
3. "AI" "enterprise" investor portfolio — thesis-aligned funds
4. angel investor "<industry>" active 2025 2026 — if targeting angels
5. "<location>" venture capital seed — geographic matches
6. "<competitor name>" investors backers — investors who backed similar companies
7. site:crunchbase.com "<industry>" investor — structured investor data
8. "<target investor type>" "<stage>" fund — type-specific searches

Prioritize:
- Investors actively deploying capital (recent investments in 2024-2026)
- Thesis alignment with the company's industry and sector
- Stage match (investor's preferred stages include the company's current round)
- Check size fit (company's raise is within investor's typical range)
- Geographic relevance or remote-friendly investors

### Step 3 — Compile Candidates
For each candidate, gather:
- **firm_name**: Investor/fund name (or individual angel name)
- **contact_name**: Key partner or GP name if identifiable
- **investor_type**: VC, Angel, Growth Equity, PE, Family Office, Strategic, Accelerator, etc.
- **rationale**: 2-3 sentences on why this investor is a fit
- **thesis_alignment**: How their investment thesis aligns with the company
- **location**: Investor's HQ or primary location
- **check_size_min**: Typical minimum check size in USD (integer)
- **check_size_max**: Typical maximum check size in USD (integer)
- **website**: Official website URL
- **source_url**: URL of the research source where you found this investor
- **source_name**: Name of the source (e.g., "Crunchbase", "TechCrunch", "LinkedIn")

### Step 4 — Submit
Call submit_discovery EXACTLY ONCE with all candidates.

## Rules
- Target ~20 candidates but quality over quantity. 15-25 is acceptable.
- Never fabricate investors. Every candidate must come from search results.
- Diversify: mix of lead investors, co-investors, angels, and strategic investors as appropriate.
- Prefer investors with recent activity (investments in 2024-2026).
- Include both well-known and emerging investors.
- Check sizes as integers in USD. Use 0 if unknown.
- Only include verified URLs from search results.
- Be token-efficient. No narration between searches.

## Date & Fact Accuracy
- Today's date: {today}. Validate source recency.
- Prefer search results over training knowledge.
- Cite sources for each candidate.`;

const SUBMIT_DISCOVERY_TOOL = {
  name: "submit_discovery",
  description: "Submit discovered investor candidates. Call exactly once with all candidates found.",
  input_schema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            firm_name: { type: "string", description: "Investor/fund name" },
            contact_name: { type: "string", description: "Key partner or GP name" },
            investor_type: { type: "string", description: "VC, Angel, Growth Equity, PE, etc." },
            rationale: { type: "string", description: "Why this investor is a fit" },
            thesis_alignment: { type: "string", description: "How thesis aligns with company" },
            location: { type: "string", description: "HQ location" },
            check_size_min: { type: "integer", description: "Min check size USD" },
            check_size_max: { type: "integer", description: "Max check size USD" },
            website: { type: "string", description: "Official website URL" },
            source_url: { type: "string", description: "Research source URL" },
            source_name: { type: "string", description: "Source name" }
          },
          required: ["firm_name", "investor_type", "rationale"]
        }
      },
      summary: { type: "string", description: "Brief summary of discovery results" }
    },
    required: ["candidates", "summary"]
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = verifyAuth(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.DATABASE_URL);
  const { requestId } = req.body || {};

  if (!requestId) return res.status(400).json({ error: 'Missing requestId' });

  // Fetch company profile
  const [profileRow] = await sql`SELECT value FROM config WHERE key = 'company_profile'`;
  const profile = profileRow?.value || {};

  // Fetch existing investors to avoid duplicates
  const existingInvestors = await sql`SELECT firm FROM investors`;
  const existingFirms = existingInvestors.map(i => i.firm.toLowerCase());

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const today = new Date().toISOString().split('T')[0];
    const systemPrompt = SYSTEM_PROMPT.replace('{today}', today);

    const profileContext = {
      name: profile.name || '',
      description: profile.description || '',
      tagline: profile.tagline || '',
      stage: profile.stage || '',
      raise_amount: profile.raise_amount || '',
      pre_money_valuation: profile.pre_money_valuation || '',
      industry: profile.industry || '',
      sector: profile.sector || '',
      location: profile.location || '',
      website: profile.website || '',
      target_investor_types: profile.target_investor_types || [],
      moat: profile.moat || '',
      competitive_advantages: profile.competitive_advantages || '',
      why_now: profile.why_now || '',
      tam: profile.tam || '',
      sam: profile.sam || '',
      som: profile.som || '',
      arr: profile.arr || '',
      mrr_growth: profile.mrr_growth || '',
      customers: profile.customers || '',
      burn_rate: profile.burn_rate || '',
      runway: profile.runway || '',
      use_of_funds: profile.use_of_funds || '',
      key_products: (profile.key_products || []).slice(0, 5),
      competitors: (profile.competitors || []).slice(0, 6),
      team: (profile.team || []).slice(0, 5),
      strategic_goals: (profile.strategic_goals || []).slice(0, 4),
    };

    let messages = [{
      role: "user",
      content: `Today's date: ${today}.\n\nFind ~20 investor candidates for this company's fundraise. Research the web thoroughly.\n\nCompany profile:\n\`\`\`json\n${JSON.stringify(profileContext, null, 2)}\n\`\`\`\n\nExisting investors in pipeline (avoid duplicates): ${existingFirms.join(', ') || 'None yet'}`
    }];

    let discoveryData = null;
    let summaryText = '';

    // Agentic loop
    for (let i = 0; i < 15; i++) {
      const response = await client.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 16384,
        temperature: 0.4,
        system: systemPrompt,
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 15 },
          SUBMIT_DISCOVERY_TOOL
        ],
        messages
      });

      for (const block of response.content) {
        if (block.type === 'text') summaryText += block.text;
      }

      const toolUses = response.content.filter(b => b.type === 'tool_use');
      const submitCall = toolUses.find(t => t.name === 'submit_discovery');

      if (submitCall) {
        discoveryData = submitCall.input;
        break;
      }

      if (response.stop_reason === 'end_turn') break;

      messages.push({ role: "assistant", content: response.content });
      if (toolUses.length > 0) {
        const toolResults = toolUses.map(tu => ({
          type: "tool_result",
          tool_use_id: tu.id,
          content: "Tool executed successfully."
        }));
        messages.push({ role: "user", content: toolResults });
      }
    }

    // Store candidates
    let candidateCount = 0;
    if (discoveryData && discoveryData.candidates) {
      for (const c of discoveryData.candidates) {
        await sql`
          INSERT INTO discovery_candidates (
            request_id, firm_name, contact_name, investor_type, rationale,
            thesis_alignment, location, check_size_min, check_size_max,
            website, source_url, source_name, status
          ) VALUES (
            ${requestId}, ${c.firm_name}, ${c.contact_name || ''},
            ${c.investor_type || ''}, ${c.rationale || ''},
            ${c.thesis_alignment || ''}, ${c.location || ''},
            ${c.check_size_min || null}, ${c.check_size_max || null},
            ${c.website || ''}, ${c.source_url || ''}, ${c.source_name || ''},
            'pending'
          )
        `;
        candidateCount++;
      }
    }

    await sql`
      UPDATE discovery_requests
      SET status = 'completed',
          candidate_count = ${candidateCount},
          completed_at = NOW()
      WHERE id = ${requestId}
    `;

    return res.status(200).json({ success: true, candidates: candidateCount });

  } catch (err) {
    console.error('Discovery worker failed:', err);
    await sql`
      UPDATE discovery_requests
      SET status = 'failed', error = ${String(err.message || err).slice(0, 1000)}
      WHERE id = ${requestId}
    `;
    return res.status(500).json({ error: String(err.message || err).slice(0, 500) });
  }
}
