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

    const requirementsList = masterRequirements.map(r => `- "${r.label}"`).join('\n')

    const prompt =
      'You are a strict sourcing auditor checking supplier responses against requirements.\n\n' +
      '=== MASTER REQUIREMENTS ===\n' +
      requirementsList +
      previousContext +
      '\n\n=== NEW SUPPLIER CHAT (analyze this carefully) ===\n' +
      chatText +
      '\n\n=== ANALYSIS RULES ===\n\n' +

      '✅ CONFIRMED = Supplier clearly said YES or gave a specific value that matches:\n' +
      '  • Capability requirements: supplier said "可以做" / "能做" / "we can make" / "we offer this" → CONFIRMED\n' +
      '    - "原型机可以做" = "we CAN make prototypes" → Prototype/Sample CAPABILITY = CONFIRMED\n' +
      '    - "我们可以定制" = "we can customize" → Customization = CONFIRMED\n' +
      '  • Simple yes: "we have photos" / "有图片" → Images = CONFIRMED\n' +
      '  • MOQ match: requirement "10 units" + supplier "最低10件" → MOQ = CONFIRMED\n\n' +

      '🟠 PARTIAL = Supplier gave SOME information but not everything needed:\n' +
      '  • Price mentioned but lead time missing → price & lead time = PARTIAL\n' +
      '  • Capability confirmed but price/lead time not yet given → capability = CONFIRMED, price & lead time = PARTIAL\n' +
      '  PRICE RECOGNITION - ANY of these patterns = price information:\n' +
      '    - Any number + 元/RMB/rmb/人民币 (e.g. "22元", "200 RMB", "起价200元人民币")\n' +
      '    - "起价X元" = starting price X → this IS price information\n' +
      '    - "价格为X元" = price is X → this IS price information\n' +
      '    - "费用X元" = cost X → this IS price information\n' +
      '    EXAMPLE: "起价200元人民币" → Prototype price & lead time = PARTIAL (price given, lead time missing)\n' +
      '    EXAMPLE: "价格为22元" → Prototype price & lead time = PARTIAL (price given, lead time missing)\n\n' +

      '❌ CONFLICT = Supplier said NO or gave a DIFFERENT value than required:\n' +
      '  • Chinese NO words: "不做"=do not make, "不能"=cannot, "无法"=unable, "没有"=don\'t have, "不提供"=don\'t provide\n' +
      '    - "我们不做原型" = "we do NOT make prototypes" → Prototype CAPABILITY = CONFLICT\n' +
      '  • English NO: "we cannot", "not possible", "we don\'t have", "not available"\n' +
      '  • Color mismatch: requirement="yellow", supplier said "only green" → yellow = CONFLICT\n' +
      '  • Material mismatch: requirement="plastic", supplier said "only metal" → plastic = CONFLICT\n' +
      '  • Size mismatch: requirement="20cm", supplier said "30cm" → CONFLICT\n' +
      '  • MOQ mismatch: requirement="10 units", supplier said "minimum 1000" → CONFLICT\n' +
      '  • "Only X" = CONFLICT for everything that is NOT X\n\n' +

      '⏳ MISSING = Supplier did not mention this at all\n\n' +

      '=== CRITICAL RULES ===\n' +
      '1. CAPABILITY vs PRICE are separate requirements:\n' +
      '   - "Prototype capability" = can they make it? YES/NO → use CONFIRMED/CONFLICT\n' +
      '   - "Prototype price & lead time" = what does it cost and how long? → use PARTIAL if only price, CONFIRMED if both\n' +
      '   - "原型机可以做，但起价200元" → capability=CONFIRMED (they CAN do it), price & lead time=PARTIAL (price 200 given, lead time missing)\n' +
      '2. ANY price mention (元/RMB/rmb + number) = evidence for price requirement → at minimum PARTIAL\n' +
      '3. LOCKED statuses (confirmed/conflict) NEVER change\n' +
      '4. PARTIAL statuses CAN upgrade to CONFIRMED if new chat provides the missing details\n' +
      '5. Never copy old evidence - always write fresh evidence based on the new chat + overall conversation\n\n' +

      '=== FOLLOW-UP QUESTION ===\n' +
      'Write ONE single comprehensive question bundling ALL items needing clarification:\n' +
      '- EVERY MISSING requirement (grey) → ask if they have it\n' +
      '- EVERY PARTIAL requirement (orange) → ask ONLY for the missing details\n' +
      '- Do NOT include confirmed (green) or conflict (red) items\n\n' +
      'CRITICAL: Bundle into ONE message, not separate questions!\n' +
      'Format:\n' +
      '  3+ items → numbered list: "能否逐条确认: 1. ... 2. ... 3. ..."\n' +
      '  1-2 items → conversational\n\n' +
      'WRONG: "您是否可以提供样品?" (only asks about one thing)\n' +
      'RIGHT: "能否逐条确认以下信息: 1. MOQ是多少? 2. 样品价格及交期是多少? 3. 支持定制吗?"\n\n' +

      'Respond ONLY in JSON (no other text):\n' +
      '{\n' +
      '  "requirements": [\n' +
      '    { "label": "exact requirement name", "status": "confirmed|partial|conflict|missing", "evidence": "fresh evidence from current analysis" }\n' +
      '  ],\n' +
      '  "supplier_notes": "key facts about supplier",\n' +
      '  "supplier_notes_english": "English translation",\n' +
      '  "next_question_chinese": "ONE comprehensive question in Chinese covering ALL missing/partial items",\n' +
      '  "next_question_english": "English translation"\n' +
      '}'

    const message = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 1200
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
