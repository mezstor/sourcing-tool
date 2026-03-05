import OpenAI from 'openai'

const apiKey = process.env.OPENAI_API_KEY
const client = new OpenAI({ apiKey })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { chatText, masterRequirements, previousAnalysis } = req.body

    if (!chatText || !masterRequirements) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Build context about what's already been confirmed, conflicted, or partially answered
    let previousContext = ''
    if (previousAnalysis && previousAnalysis.requirements) {
      const confirmed = previousAnalysis.requirements.filter(r => r.status === 'confirmed').map(r => r.label).join(', ')
      const conflicted = previousAnalysis.requirements.filter(r => r.status === 'conflict').map(r => r.label).join(', ')
      const partial = previousAnalysis.requirements.filter(r => r.status === 'partial').map(r => `${r.label} (evidence: "${r.evidence}")`).join(', ')

      if (confirmed) {
        previousContext += `\n\nALREADY CONFIRMED (do NOT downgrade or ask about these again): ${confirmed}`
      }
      if (conflicted) {
        previousContext += `\n\nALREADY CONFLICTED - Supplier said NO (do NOT downgrade or ask about these again): ${conflicted}`
      }
      if (partial) {
        previousContext += `\n\nALREADY PARTIAL (Supplier responded but incomplete - do NOT downgrade to MISSING): ${partial}`
      }
    }

    // Use ALL master requirements - don't filter out any user-specified requirements
    const prompt = 'You are a sourcing expert auditor for import/export operations.\n\n' +
      'MASTER REQUIREMENTS for this supplier:\n' +
      masterRequirements.map(r => `- ${r.label} (Status: ${r.status})`).join('\n') +
      previousContext +
      '\n\nSUPPLIER CHAT TEXT:\n' +
      chatText +
      '\n\nAnalyze the chat CAREFULLY for each requirement:\n' +
      '1. For each master requirement, determine if it\'s: "confirmed" (green), "partial" (yellow/orange), "conflict" (red), or "missing" (grey)\n' +
      '   CRITICAL RULE: Status CAN ONLY STAY SAME or UPGRADE, NEVER DOWNGRADE:\n' +
      '   - confirmed → can ONLY stay confirmed (never go to partial/conflict/missing)\n' +
      '   - conflict → can ONLY stay conflict (never go to partial/missing/confirmed)\n' +
      '   - partial → can upgrade to confirmed (if more details given), or stay partial\n' +
      '   - missing → can upgrade to partial/conflict/confirmed (first mention of requirement)\n' +
      '   Example: If MOQ was "CONFLICT (600 units)" in previous chat, and new chat mentions \"600 units\", it stays CONFLICT\n\n' +
      'CONFIRMED STATUS (✅ Green - fully answered):\n' +
      '  - Supplier clearly stated they can/have it with specific details\n' +
      '  - "we have capability AND price is X AND lead time is Y" = CONFIRMED\n' +
      '  - "we provide this service, cost is X, deadline is Y" = CONFIRMED\n' +
      '  - "yes, we have sample/prototype capability, price 22 RMB" = CONFIRMED (though might ask for lead time later)\n\n' +
      'PARTIAL STATUS (🟠 Orange/Yellow - answered but incomplete):\n' +
      '  - Supplier answered PART of the requirement but missing critical details\n' +
      '  - Example 1: Says "we have sample capability" BUT no price given → PARTIAL\n' +
      '  - Example 2: Says "startup fee 200 RMB for prototype" = PARTIAL (has capability + startup cost, missing price/lead time)\n' +
      '  - Example 3: Says "prototype price 22 RMB" BUT no lead time/startup cost → PARTIAL\n' +
      '  - For multi-part requirements like "Prototype/Sample capability and price (1-2 units)":\n' +
      '    - They said "capability available" BUT NOT price → PARTIAL\n' +
      '    - They said "startup cost 200" → PARTIAL (has cost, missing per-unit price and lead time)\n' +
      '    - They said "price 22 RMB, lead time 30 days" BUT NOT capability/startup cost → PARTIAL\n' +
      '  - DETECTION: Any mention of startup fee, price component, or capability component = partial answer\n\n' +
      'CONFIRMED STATUS INDICATORS (🟢 Green - ONLY when FULLY answered):\n' +
      '  - ONLY for simple yes/no requirements that are fully answered\n' +
      '  - "we have product photos" = CONFIRMED\n' +
      '  - "customization available" = CONFIRMED (simple capability)\n' +
      '  - "we accept MOQ 1000" = CONFIRMED (specific number)\n' +
      '  - CRITICAL: For multi-part requirements like "Prototype/Sample price & lead time":\n' +
      '    - "can do prototype" ALONE = PARTIAL (missing price/lead time)\n' +
      '    - "price 20 RMB" ALONE = PARTIAL (missing capability/lead time)\n' +
      '    - "price 20 RMB, lead time 30 days" = CONFIRMED (both parts answered)\n' +
      '  - Even with typos: "possibe" = possible, "costumized" = customized\n\n' +
      'CONFLICT STATUS (❌ Red - impossible):\n' +
      '  - Direct negatives: "we cannot", "we don\'t have", "not possible", "impossible", "we don\'t do"\n' +
      '  - "we don\'t offer", "not available", "not in stock", "we don\'t provide"\n' +
      '  - "only X" (implicit conflict for OTHER items). Example: "only purple candles" = red = CONFLICT\n' +
      '  - EXPLICIT SPEC MISMATCH (they mention a DIFFERENT specific value):\n' +
      '    * Requirement "white shoes" + Supplier says "red shoes" = ❌ CONFLICT (color mismatch)\n' +
      '    * Requirement "metal material" + Supplier says "plastic" = ❌ CONFLICT (material mismatch)\n' +
      '    * Requirement "13-inch" + Supplier says "14-inch" = ❌ CONFLICT (size mismatch)\n' +
      '    * Requirement "Nike brand" + Supplier says "Adidas" = ❌ CONFLICT (brand mismatch)\n' +
      '  - KEY RULE: If supplier mentions a SPECIFIC value for the requirement that DIFFERS from what\'s needed = CONFLICT\n\n' +
      'MISSING STATUS (⏳ Grey - not mentioned):\n' +
      '  - Requirement not mentioned in the chat at all\n\n' +
      'IMPORTANT CONTEXT:\n' +
      '1. DISTINGUISH confirmed vs partial:\n' +
      '   - CONFIRMED = full answer with ALL details\n' +
      '   - PARTIAL = they responded but SOME details missing\n' +
      '   - Example: "can do prototype, startup fee 200 RMB" = PARTIAL (has capability + startup cost, missing per-unit price and lead time)\n' +
      '2. SPECIFICATION MISMATCHES = CONFLICT:\n' +
      '   - "red shoes" vs requirement "white shoes" = CONFLICT (color mismatch)\n' +
      '   - "14 inch" vs requirement "13 inch" = CONFLICT (size mismatch)\n' +
      '   - "plastic" vs requirement "metal" = CONFLICT (material mismatch)\n' +
      '   - "Adidas" vs requirement "Nike" = CONFLICT (brand mismatch)\n' +
      '   - KEY: When they mention a DIFFERENT specific value = CONFLICT\n' +
      '3. "only X" logic: "only purple" + requirement "red" = red = CONFLICT\n' +
      '4. Startup fee mention = evidence for Prototype capability (mark as PARTIAL, not MISSING)\n\n' +
      '2. Extract any additional supplier notes that aren\'t related to master requirements\n' +
      '3. IMPORTANT: Generate ONE comprehensive follow-up question. Coverage:\n' +
      '   - Include ALL GREY items (not mentioned yet)\n' +
      '   - Include PARTIAL items BUT ask for the MISSING DETAILS ONLY (not re-ask what they already said)\n' +
      '   - Example: If "sample price" is PARTIAL (they said "22 RMB" but no lead time), ask "What is the lead time and startup cost?"\n' +
      '   - Do NOT ask about CONFIRMED or CONFLICT items\n' +
      '   - Be specific about what details are needed\n' +
      '   Question format:\n' +
      '   - 3+ items → Use numbered list: "能否逐条确认以下内容:" or "Please confirm:"\n' +
      '   - 1-2 items → Conversational: "请问贵司能否...?" or "Could you please...?"\n' +
      '   - Vary phrasing: don\'t use identical templates each time\n' +
      '   Examples:\n' +
      '     * Numbered: "能否请逐条确认: 1. 产品照片 - 有吗? 2. MOQ详情 - 您的最低起订量是多少? 3. 定制能力 - 支持吗?"\n' +
      '     * Conversational: "贵司能提供产品样品吗？样品的起样成本和交期各是多少？"\n' +
      '     * Specific: "您提到样品价格22元，请问起样的成本、交期和最小数量各是多少?"\n' +
      '4. If no GREY or PARTIAL items, say: "All key requirements confirmed or clarified"\n' +
      '5. Generate BOTH Chinese AND English versions\n\n' +
      'Respond in JSON format:\n' +
      '{\n' +
      '  "requirements": [\n' +
      '    { "label": "requirement name", "status": "confirmed|partial|conflict|missing", "evidence": "brief quote or note from supplier" }\n' +
      '  ],\n' +
      '  "supplier_notes": "any extra info about the supplier",\n' +
      '  "supplier_notes_english": "English translation of supplier notes (if different from above)",\n' +
      '  "next_question_chinese": "ONE comprehensive question in Chinese. Ask about GREY items (yes/no) and PARTIAL items (ask for missing details specifically, not re-ask what they said). Or \\"All key requirements confirmed\\" if none remaining",\n' +
      '  "next_question_english": "English translation of the question or confirmation message"\n' +
      '}'

    const message = await client.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 1024
    })

    const responseText = message.choices[0].message.content

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("No JSON found in response")
    }

    const analysisResult = JSON.parse(jsonMatch[0])

    return res.status(200).json(analysisResult)
  } catch (error) {
    console.error('OpenAI API error:', error)
    return res.status(500).json({
      error: 'Failed to analyze chat',
      message: error.message
    })
  }
}
