import OpenAI from 'openai'

const apiKey = process.env.OPENAI_API_KEY
const client = new OpenAI({ apiKey })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { chatText, masterRequirements, previousAnalysis, lastQuestion } = req.body

    if (!chatText || !masterRequirements) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Build previous status context
    // CONFIRMED is locked forever — supplier already confirmed, no need to re-ask
    // CONFLICT can upgrade to CONFIRMED if supplier EXPLICITLY agrees in new chat
    // PARTIAL can upgrade to CONFIRMED when the missing detail is provided
    let previousContext = ''
    if (previousAnalysis && previousAnalysis.requirements) {
      const confirmed = previousAnalysis.requirements
        .filter(r => r.status === 'confirmed')
        .map(r => `"${r.label}" → CONFIRMED ✅ LOCKED. Do not change. Do not ask again.`)
        .join('\n')

      const conflict = previousAnalysis.requirements
        .filter(r => r.status === 'conflict')
        .map(r => {
          const isMOQ = /moq|minimum order/i.test(r.label)
          const evidence = r.evidence ? ` (Previously: "${r.evidence}")` : ''
          const moqNote = isMOQ
            ? '\n   MOQ SPECIAL: If new chat shows supplier agrees to our required quantity — e.g. "100件可以", "100 units OK", "没问题" after asking about 100 units — → CONFIRMED ✅'
            : ''
          return `"${r.label}" → CONFLICT 🔴${evidence}${moqNote}\n   Only change to CONFIRMED ✅ if supplier EXPLICITLY agrees in the NEW chat. Otherwise keep as CONFLICT.`
        })
        .join('\n')

      const partial = previousAnalysis.requirements
        .filter(r => r.status === 'partial')
        .map(r => {
          const evidence = r.evidence ? `\n   Already provided: "${r.evidence}"` : ''
          return (
            `"${r.label}" → PARTIAL 🟠${evidence}\n` +
            `   RULE: Check if the NEW chat provides the MISSING part.\n` +
            `   You do NOT need to see the already-confirmed part again.\n` +
            `   If the new chat provides the missing detail → CONFIRMED ✅\n` +
            `   If new chat has NO new info about this → keep PARTIAL.`
          )
        })
        .join('\n')

      if (confirmed) previousContext += `\n\n--- CONFIRMED (locked, never re-ask) ---\n${confirmed}`
      if (conflict) previousContext += `\n\n--- CONFLICT (can upgrade if supplier explicitly agrees) ---\n${conflict}`
      if (partial) previousContext += `\n\n--- PARTIAL (upgrade to CONFIRMED if the missing detail arrives) ---\n${partial}`
    }

    const requirementsList = masterRequirements.map(r => {
      const detail = r.value ? ` (${r.value})` : ''
      return `- "${r.label}"${detail}`
    }).join('\n')

    // Build last question context for mapping numbered supplier responses
    let lastQuestionContext = ''
    if (lastQuestion && (lastQuestion.english || lastQuestion.chinese)) {
      lastQuestionContext =
        '\n\n=== LAST QUESTION WE SENT TO SUPPLIER (for mapping responses) ===\n' +
        'The previous question sent to the supplier was:\n' +
        (lastQuestion.english ? `ENGLISH: ${lastQuestion.english}\n` : '') +
        (lastQuestion.chinese ? `CHINESE: ${lastQuestion.chinese}\n` : '') +
        'CRITICAL: If the supplier responds with numbered/lettered answers (like "1: yes  2: ABS plastic  3: 20 days"),\n' +
        'map each answer to the corresponding numbered item in the last question above.\n' +
        'Use this mapping to correctly update requirement statuses.'
    }

    const prompt =
      'You are a strict sourcing auditor. Analyze supplier chat against requirements.\n' +
      'Use AI JUDGMENT to understand meaning, context, and semantics - not string matching.\n\n' +
      '=== MASTER REQUIREMENTS ===\n' +
      requirementsList +
      previousContext +
      lastQuestionContext +
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
      '  • req="red" + supplier="blue" → SAME category (colors), different → CONFLICT 🔴\n' +
      '  • req="stone mug" + supplier="we only have glass mugs" → glass ≠ stone → CONFLICT 🔴\n' +
      '    (supplier\'s stated product type implies the required material is NOT available)\n\n' +

      'RULE 2: REFUSALS = CONFLICT 🔴\n' +
      '  • "没有" (don\'t have), "不做" (don\'t make), "不能" (cannot), "无法" (unable) = CONFLICT 🔴\n' +
      '  • "没有原型" = "no prototype" → Prototype capability = CONFLICT 🔴 (NOT missing!)\n' +
      '  • "我们只做X" / "我们只售X" / "我们只有X" / "我们只提供X" = "we only make/sell/have/offer X"\n' +
      '    → anything that is NOT X = CONFLICT 🔴\n' +
      '  • MATERIAL CONFLICT via product type: if supplier says "we only have/sell GLASS mugs"\n' +
      '    and requirement is "stone" material → stone = CONFLICT 🔴 (glass ≠ stone)\n' +
      '    The offered product material directly contradicts the required material.\n\n' +

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

      '=== WHEN SUPPLIER ASKS US A QUESTION ===\n' +
      'If the supplier\'s message contains questions directed at us (like "How many do you need?",\n' +
      '"What quantity?", "几件?", "需要多少?", "数量是多少?" etc.):\n' +
      '• Find the answer in the requirements list (e.g., MOQ requirement tells our needed quantity)\n' +
      '• Prepend the answer at the START of next_question_english and next_question_chinese\n' +
      '• Format: "We need X units. [Then ask all remaining grey/orange requirements as normal]"\n' +
      '• Chinese format: "我们需要X件。[然后正常问所有灰色/橙色需求]"\n\n' +

      '=== HIGHER MOQ RULE (ONE-TIME ONLY) ===\n' +
      'If the supplier states their MOQ is HIGHER than the MOQ listed in requirements:\n' +
      '• Mark the MOQ requirement as CONFLICT 🔴\n' +
      '• Check the LAST QUESTION WE SENT (see context above):\n' +
      '  - If the lastQuestion did NOT already ask about ordering at our lower MOQ → ask it NOW:\n' +
      '    "Is it possible to order [our required MOQ] units? If yes, what would the price per unit be at that quantity?"\n' +
      '  - If the lastQuestion ALREADY asked about lower MOQ → do NOT ask again. MOQ is done.\n' +
      '• Bundle this with ALL other missing/partial requirements in one question.\n\n' +

      '=== ORANGE BALL (PARTIAL) RESOLUTION ===\n' +
      'For each PARTIAL (orange) requirement, ask for ONLY the specific missing detail:\n' +
      '  • Price given but no lead time → ask specifically for lead time\n' +
      '  • Photos promised but not sent → ask to send photos now\n' +
      '  • Partial specification given → ask for the remaining specific detail\n' +
      'ALWAYS include ALL partial requirement follow-ups bundled in the one question.\n\n' +

      '=== FOLLOW-UP QUESTION — STRICT RULES ===\n' +
      'Write ONE question in English bundling ALL missing/partial items.\n\n' +
      '⛔ ABSOLUTE PROHIBITION — NEVER ask about these:\n' +
      '  • Any requirement with status CONFLICT (red) — the supplier already refused or it is incompatible\n' +
      '  • Any requirement with status CONFIRMED (green) — already answered\n' +
      '  • EXCEPTION: MOQ CONFLICT → ask ONCE about lower MOQ (see HIGHER MOQ RULE above)\n\n' +
      '✅ ALWAYS include these:\n' +
      '  • EVERY MISSING (grey) requirement — ask every single one\n' +
      '  • EVERY PARTIAL (orange) requirement — ask for the specific missing detail\n' +
      '  • Price if not yet confirmed\n\n' +
      'FORMAT:\n' +
      '  • 3+ items → numbered list: "Can you confirm the following: 1. ... 2. ... 3. ..."\n' +
      '  • If supplier asked us a question → answer it FIRST, then ask our questions\n' +
      'Then translate to Chinese EXACTLY — the Chinese version must be a precise translation of the English.\n\n' +

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
