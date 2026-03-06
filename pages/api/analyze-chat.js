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

    // Build previous status context
    // CONFIRMED and CONFLICT are LOCKED forever
    // PARTIAL can upgrade to confirmed based on new info
    let previousContext = ''
    if (previousAnalysis && previousAnalysis.requirements) {
      const locked = previousAnalysis.requirements
        .filter(r => r.status === 'confirmed' || r.status === 'conflict')
        .map(r => `"${r.label}" = ${r.status.toUpperCase()} (LOCKED - never change this)`)
        .join('\n')
      const partial = previousAnalysis.requirements
        .filter(r => r.status === 'partial')
        .map(r => `"${r.label}" = PARTIAL so far (re-evaluate with new chat - can upgrade to CONFIRMED if fully answered)`)
        .join('\n')

      if (locked) previousContext += `\n\nLOCKED FROM PREVIOUS CHATS (do NOT change):\n${locked}`
      if (partial) previousContext += `\n\nPARTIAL FROM PREVIOUS CHATS (re-evaluate - may upgrade to CONFIRMED):\n${partial}`
    }

    const requirementsList = masterRequirements.map(r => {
      const detail = r.value ? ` (${r.value})` : ''
      return `- "${r.label}"${detail}`
    }).join('\n')

    const prompt =
      'You are a strict sourcing auditor. Analyze supplier chat against requirements.\n' +
      'Use AI JUDGMENT to understand meaning, context, and semantics - not string matching.\n\n' +
      '=== MASTER REQUIREMENTS ===\n' +
      requirementsList +
      previousContext +
      '\n\n=== SUPPLIER CHAT ===\n' +
      chatText +
      '\n\n=== HOW TO ANALYZE ===\n' +
      'For EACH requirement, determine status using semantic understanding:\n\n' +
      '✅ CONFIRMED = Supplier said YES or value MATCHES requirement (same component, same category)\n' +
      '🟠 PARTIAL = Some info given but incomplete (e.g., price given but no lead time, promised but not delivered)\n' +
      '❌ CONFLICT = Supplier said NO, gave DIFFERENT value for SAME component, or explicitly refused\n' +
      '⏳ MISSING = Supplier did not mention this at all\n\n' +

      '=== SEMANTIC MATCHING (CRITICAL!) ===\n' +
      'Use AI reasoning to understand WHAT specs apply to WHICH component:\n\n' +
      'RULE 1: CONTEXT FIRST - understand what each value refers to before comparing\n' +
      '  • req="5cm ring" + supplier="15cm box" → DIFFERENT parts → ring size still MISSING ⏳\n' +
      '  • req="5cm ring" + supplier="15cm ring" → SAME part, different value → CONFLICT 🔴\n' +
      '  • req="metal step" + supplier="plastic step" → SAME part, different material → CONFLICT 🔴\n' +
      '  • req="vanilla" + supplier="lavendel" → SAME category (scents), different → CONFLICT 🔴\n' +
      '  • req="red" + supplier="blue" → SAME category (colors), different → CONFLICT 🔴\n\n' +

      'RULE 2: REFUSALS = CONFLICT 🔴\n' +
      '  • "没有" (don\'t have), "不做" (don\'t make), "不能" (cannot), "无法" (unable) = CONFLICT 🔴\n' +
      '  • "没有原型" = "no prototype" → Prototype capability = CONFLICT 🔴 (NOT missing!)\n' +
      '  • "我们只做X" = "we only make X" → anything that is NOT X = CONFLICT 🔴\n\n' +

      'RULE 3: PROTOTYPE vs PRODUCTION are DIFFERENT contexts\n' +
      '  • "Prototype price 300 RMB" → Prototype capability = CONFIRMED ✅ (they can make it!)\n' +
      '  • "Production: 250 units @ 8 RMB each" → This is BULK pricing, NOT prototype!\n' +
      '    → Prototype capability still MISSING ⏳\n\n' +

      'RULE 4: PROMISES = PARTIAL 🟠\n' +
      '  • "I will send photos" / "马上发图片" → Images = PARTIAL 🟠 (promised, not delivered)\n\n' +

      'RULE 5: PRICE RECOGNITION\n' +
      '  • Any mention of 元/块/人民币/RMB/¥ + number = price info\n' +
      '  • Price given but no lead time → price & lead time = PARTIAL 🟠\n' +
      '  • Both price AND lead time given → CONFIRMED ✅\n\n' +

      '=== RULES ===\n' +
      '• LOCKED statuses (confirmed/conflict) from previous chats NEVER change\n' +
      '• PARTIAL can upgrade to CONFIRMED with new info\n' +
      '• Write fresh evidence for each requirement\n\n' +

      '=== FOLLOW-UP QUESTION ===\n' +
      'Write ONE question in English bundling ALL missing/partial items:\n' +
      '• CRITICAL: Always ask about MOQ (Minimum Order Quantity) if not yet confirmed\n' +
      '• Ask about EVERY MISSING requirement\n' +
      '• Ask ONLY for missing details of PARTIAL requirements\n' +
      '• Do NOT ask about confirmed or conflict items\n' +
      '• 3+ items → numbered list: "Can you confirm the following: 1. ... 2. ... 3. ..."\n' +
      'Then translate it to Chinese EXACTLY - the Chinese version must be a precise translation of the English one.\n\n' +

      '=== MANDATORY: RETURN ALL REQUIREMENTS ===\n' +
      'You MUST return a status for EVERY SINGLE requirement listed above.\n' +
      'If there are 7 requirements, your response MUST have exactly 7 entries.\n' +
      'NEVER skip requirements. For unmentioned ones → "missing".\n\n' +

      'Respond ONLY in JSON:\n' +
      '{\n' +
      '  "requirements": [\n' +
      '    { "label": "exact requirement name", "status": "confirmed|partial|conflict|missing", "evidence": "short evidence" }\n' +
      '  ],\n' +
      '  "supplier_notes": "key facts",\n' +
      '  "supplier_notes_english": "English translation",\n' +
      '  "next_question_english": "ONE comprehensive question covering ALL missing/partial items (in English)",\n' +
      '  "next_question_chinese": "EXACT Chinese translation of the English question above"\n' +
      '}'

    const message = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 2000
    })

    const responseText = message.choices[0].message.content

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
