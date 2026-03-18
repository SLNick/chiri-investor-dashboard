import Anthropic from '@anthropic-ai/sdk';
import { neon } from '@neondatabase/serverless';
import { verifyAuth } from '../../../_auth.js';

export const config = { maxDuration: 300 };

const SYSTEM_PROMPT = `You are an investor enrichment specialist for Chiri, the AI enterprise autopilot platform that observes processes, deploys digital workers, and captures labor budget. Your job is to research investor firms and propose verified data updates for operator review.

## Execution Protocol

### Step 1 — Read the Record
You will receive the current investor record as context. Identify which fields are empty or contain only basic data — those are your enrichment targets.

### Step 2 — Targeted Research
Run 3-5 focused web searches using specific, quoted terms:
1. "<firm name>" site:crunchbase.com — funding info, portfolio, description
2. "<firm name>" investor fund AUM assets under management
3. "<firm name>" portfolio companies investments
4. "<firm name>" check size investment thesis strategy
5. "<firm name>" "<contact name>" — if contact is known

Focus on tier-A/B sources (Crunchbase, PitchBook, SEC, LinkedIn, Bloomberg, TechCrunch, official firm website).

### Step 3 — Validate & Score Confidence
Assign confidence: **high** (2+ sources or official source), **medium** (single reputable source), **low** (inferred/outdated).
Only propose high or medium confidence updates.

### Step 4 — Submit Updates
Call submit_enrichment EXACTLY ONCE with all verified updates AND the fit score.

Enrichable fields:
- **description**: Brief firm description (2-3 sentences)
- **aum**: Assets under management (e.g., "$2.5B")
- **investment_focus**: Thesis/focus areas comma-separated
- **check_size_min**: Min check size USD as integer
- **check_size_max**: Max check size USD as integer
- **fund_stage**: Stage preferences (e.g., "Seed, Series A, Series B")
- **portfolio_companies**: Array max 10: [{"name": "Company", "url": "https://..."}]
- **investor_type**: e.g., "VC", "PE", "Growth Equity", "Family Office"
- **location**: HQ location
- **linkedin_url**: LinkedIn company page URL (verified from search)
- **twitter_url**: Twitter/X URL (verified from search)
- **website**: Official website URL (verified from search)

### Step 4b — Score Investor-Company Fit
Using the enriched investor data AND the company profile provided in your context, evaluate how well this investor matches the company's current raise. Generate:
- **fit_score** (0-100 integer):
  - 90-100: Exceptional fit — thesis, stage, check size, and track record all align
  - 70-89: Strong fit — most dimensions align with minor gaps
  - 50-69: Moderate fit — some alignment but notable mismatches
  - 30-49: Weak fit — few alignment points
  - 0-29: Poor fit — fundamental mismatches
- **fit_assessment**: 2-3 sentence explanation of the score
- **fit_signals**: Array of scoring dimensions, each with signal name, sentiment (positive/neutral/negative), and detail

Score across these dimensions:
1. **Stage Match** — Does the investor's preferred fund stages include the company's current round?
2. **Check Size Fit** — Is the company's raise amount within the investor's typical check size range?
3. **Thesis Alignment** — Does the investor's focus areas overlap with the company's industry/sector (AI, enterprise automation, services-as-software)?
4. **Investor Type** — Is this investor type one the company targets?
5. **Portfolio Signal** — Has the investor backed companies in similar sectors (AI agents, enterprise automation, process intelligence, digital workers)?
6. **Geographic Fit** — Does the investor operate in the company's geography?

Include fit_score, fit_assessment, and fit_signals as changes in your submit_enrichment call (alongside the enrichment field changes).

### Step 5 — Report
Brief summary: what was found, sources, what couldn't be enriched. Include the fit score and key reasons.

## Rules
- Never fabricate data. Empty enrichment is better than wrong.
- Prefer recency. Use most recent source for conflicts.
- Be specific with dollar amounts — "$X.XB" or "$XXM" for AUM.
- Check sizes as integers. Portfolio max 10.
- Only include verified URLs from search results.
- Be token-efficient. No narration.

## Date & Fact Accuracy
- Today's date: {today}. Validate source recency.
- Never state dates not in search results.
- Cite sources: "AUM of $2B (source: Crunchbase, 2025)".
- Prefer search results over training knowledge.`;

const SUBMIT_ENRICHMENT_TOOL = {
  name: "submit_enrichment",
  description: "Submit proposed enrichment updates for operator review. Call exactly once with all verified findings.",
  input_schema: {
    type: "object",
    properties: {
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string" },
            new_value: { description: "Proposed new value" },
            confidence: { type: "string", enum: ["high", "medium"] },
            source: { type: "string" }
          },
          required: ["field", "new_value", "confidence", "source"]
        }
      },
      summary: { type: "string" },
      fit_score: { type: "integer", description: "0-100 overall investor-company fit score" },
      fit_assessment: { type: "string", description: "2-3 sentence explanation of the fit score" },
      fit_signals: {
        type: "array",
        description: "Scoring dimensions with sentiment",
        items: {
          type: "object",
          properties: {
            signal: { type: "string", description: "Dimension name, e.g., Stage Match" },
            sentiment: { type: "string", enum: ["positive", "neutral", "negative"], description: "How well this dimension aligns" },
            detail: { type: "string", description: "Brief explanation" }
          },
          required: ["signal", "sentiment", "detail"]
        }
      }
    },
    required: ["changes", "summary", "fit_score", "fit_assessment", "fit_signals"]
  }
};

const ALLOWED_FIELDS = new Set([
  'description', 'aum', 'investment_focus', 'check_size_min', 'check_size_max',
  'fund_stage', 'portfolio_companies', 'investor_type', 'location',
  'linkedin_url', 'twitter_url', 'website',
  'fit_score', 'fit_assessment', 'fit_signals'
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = verifyAuth(req);
  if (!email) return res.status(401).json({ error: 'Unauthorized' });

  const sql = neon(process.env.DATABASE_URL);
  const investorId = parseInt(req.query.id);
  const { requestId } = req.body || {};

  if (isNaN(investorId) || !requestId) {
    return res.status(400).json({ error: 'Missing investorId or requestId' });
  }

  // Fetch investor
  const investors = await sql`SELECT * FROM investors WHERE id = ${investorId}`;
  if (!investors.length) return res.status(404).json({ error: 'Investor not found' });
  const investor = investors[0];

  // Fetch company profile for fit scoring
  const [profileRow] = await sql`SELECT value FROM config WHERE key = 'company_profile'`;
  const companyProfile = profileRow?.value || {};

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const today = new Date().toISOString().split('T')[0];
    const systemPrompt = SYSTEM_PROMPT.replace('{today}', today);

    const context = {
      firm: investor.firm,
      contact: investor.contact || '',
      url: investor.url || '',
      notes: investor.notes || '',
      description: investor.description || '',
      aum: investor.aum || '',
      investment_focus: investor.investment_focus || '',
      check_size_min: investor.check_size_min || null,
      check_size_max: investor.check_size_max || null,
      fund_stage: investor.fund_stage || '',
      portfolio_companies: investor.portfolio_companies || [],
      investor_type: investor.investor_type || '',
      location: investor.location || '',
      linkedin_url: investor.linkedin_url || '',
      twitter_url: investor.twitter_url || '',
      website: investor.website || ''
    };

    // Build compact company profile for fit scoring context
    const companyContext = {
      name: companyProfile.name || '',
      stage: companyProfile.stage || '',
      raise_amount: companyProfile.raise_amount || '',
      valuation: companyProfile.pre_money_valuation || '',
      industry: companyProfile.industry || '',
      sector: companyProfile.sector || '',
      location: companyProfile.location || '',
      description: companyProfile.description || '',
      target_investor_types: companyProfile.target_investor_types || [],
      moat: companyProfile.moat || '',
      tam: companyProfile.tam || '',
      key_products: (companyProfile.key_products || []).slice(0, 5),
      competitive_advantages: companyProfile.competitive_advantages || '',
    };

    let messages = [{
      role: "user",
      content: `Today's date: ${today}.\n\nEnrich this investor record. Research the firm, propose updates for empty or incomplete fields, AND score the investor-company fit.\n\nCurrent investor record:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\nCompany profile (use this to generate the fit score):\n\`\`\`json\n${JSON.stringify(companyContext, null, 2)}\n\`\`\``
    }];

    let enrichmentData = null;
    let summaryText = '';

    // Agentic loop
    for (let i = 0; i < 10; i++) {
      const response = await client.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 8192,
        temperature: 0.3,
        system: systemPrompt,
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 8 },
          SUBMIT_ENRICHMENT_TOOL
        ],
        messages
      });

      for (const block of response.content) {
        if (block.type === 'text') summaryText += block.text;
      }

      const toolUses = response.content.filter(b => b.type === 'tool_use');
      const submitCall = toolUses.find(t => t.name === 'submit_enrichment');

      if (submitCall) {
        enrichmentData = submitCall.input;
        break;
      }

      if (response.stop_reason === 'end_turn') break;

      // Continue conversation
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

    // Build proposed changes
    let proposedChanges = [];
    if (enrichmentData && enrichmentData.changes) {
      proposedChanges = enrichmentData.changes
        .filter(c => ALLOWED_FIELDS.has(c.field))
        .map(c => ({
          field: c.field,
          old_value: investor[c.field] || null,
          new_value: c.new_value,
          confidence: c.confidence,
          source: c.source
        }));
    }

    // Add fit score as proposed changes (from top-level tool output)
    if (enrichmentData) {
      if (enrichmentData.fit_score !== undefined) {
        proposedChanges.push({
          field: 'fit_score',
          old_value: investor.fit_score || null,
          new_value: enrichmentData.fit_score,
          confidence: 'high',
          source: 'AI fit analysis'
        });
      }
      if (enrichmentData.fit_assessment) {
        proposedChanges.push({
          field: 'fit_assessment',
          old_value: investor.fit_assessment || null,
          new_value: enrichmentData.fit_assessment,
          confidence: 'high',
          source: 'AI fit analysis'
        });
      }
      if (enrichmentData.fit_signals) {
        proposedChanges.push({
          field: 'fit_signals',
          old_value: investor.fit_signals || null,
          new_value: enrichmentData.fit_signals,
          confidence: 'high',
          source: 'AI fit analysis'
        });
      }
    }

    const finalSummary = enrichmentData?.summary || summaryText || 'No enrichment data found.';

    await sql`
      UPDATE enrichment_requests
      SET status = 'completed',
          proposed_changes = ${JSON.stringify(proposedChanges)},
          summary = ${finalSummary},
          completed_at = NOW()
      WHERE id = ${requestId}
    `;

    await sql`UPDATE investors SET enrichment_status = ${proposedChanges.length > 0 ? 'completed' : 'none'} WHERE id = ${investorId}`;

    return res.status(200).json({ success: true, changes: proposedChanges.length });

  } catch (err) {
    console.error('Enrichment worker failed:', err);
    await sql`
      UPDATE enrichment_requests
      SET status = 'failed', error = ${String(err.message || err).slice(0, 1000)}
      WHERE id = ${requestId}
    `;
    await sql`UPDATE investors SET enrichment_status = 'failed' WHERE id = ${investorId}`;
    return res.status(500).json({ error: String(err.message || err).slice(0, 500) });
  }
}
