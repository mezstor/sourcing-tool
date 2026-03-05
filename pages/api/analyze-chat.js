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

    // Build previous status context - statuses must NEVER downgrade
    let previousContext = ''
    if (previousAnalysis && previousAnalysis.requirements) {
      const locked = previousAnalysis.requirements
        .filter(r => r.status === 'confirmed' || r.status === 'conflict')
        .map(r => `"${r.label}" = ${r.status.toUpperCase()} (LOCKED - do not change)`)
        .join('\n')
      const partial = previousAnalysis.requirements
        .filter(r => r.status === 'partial')
        .map(r => `"${r.label}" = PARTIAL (evidence so far: "${r.evidence}")`)
        .join('\n')

      if (locked) previousContext += `\n\nLOCKED STATUSES (NEVER change these):\n${locked}`
      if (partial) previousContext += `\n\nPARTIAL (can upgrade to confirmed if more details given, never downgrade to missing):\n${partial}`
    }

    const requirementsList = masterRequirements.map(r => `- "${r.label}"`).join('\n')

    const prompt =
      'You are a strict sourcing auditor. Your job is to check supplier responses against requirements.\n\n' +
      '=== MASTER REQUIREMENTS ===\n' +
      requirementsList +
      previousContext +
      '\n\n=== SUPPLIER CHAT ===\n' +
      chatText +
      '\n\n=== YOUR TASK ===\n' +
      'Go through EVERY requirement one by one. For each requirement:\n\n' +
      'STEP 1 - Find evidence: Search the supplier chat for anything related to this requirement.\n' +
      'STEP 2 - Classify using these STRICT rules:\n\n' +
      '❌ CONFLICT = Supplier answered but value DIFFERS from requirement, OR they said NO/CANNOT:\n\n' +
      '=== CONFLICTING SPECS (Value mismatch) ===\n' +
      '• Color mismatch: requirement="white", supplier said "black" → CONFLICT\n' +
      '• Size mismatch: requirement="20 cm", supplier said "30 cm" → CONFLICT\n' +
      '• Size mismatch: requirement="2 meter", supplier said "3 meters" → CONFLICT\n' +
      '• Material mismatch: requirement="cotton", supplier said "synthetic" → CONFLICT\n' +
      '• Material mismatch: requirement="coton", supplier said "合成材料" (synthetic) → CONFLICT\n' +
      '• MOQ mismatch: requirement="100 units", supplier said "600 units" → CONFLICT\n\n' +
      '=== REFUSALS / NEGATIONS (They said NO/CANNOT/DON\'T HAVE) ===\n' +
      'THESE ARE ALWAYS CONFLICT:\n\n' +
      'English negations:\n' +
      '  "we cannot", "we can\'t", "not possible", "impossible", "we don\'t have", "not available",\n' +
      '  "we don\'t make", "we don\'t offer", "we don\'t provide", "we don\'t do"\n\n' +
      'Chinese negations (CRITICAL - these appear in Chinese chats):\n' +
      '  "不做" (do not make) - Example: "我们不做原型" = "we do not make prototypes" → CONFLICT\n' +
      '  "不能" (cannot/can\'t) - Example: "我们不能定制" = "we cannot customize" → CONFLICT\n' +
      '  "无法" (cannot/unable) - Example: "无法提供" = "cannot provide" → CONFLICT\n' +
      '  "没有" (don\'t have) - Example: "没有库存" = "no stock" → CONFLICT\n' +
      '  "不提供" (don\'t provide) - Example: "不提供原型" = "don\'t provide prototypes" → CONFLICT\n' +
      '  "不支持" (don\'t support) - Example: "不支持定制" = "don\'t support customization" → CONFLICT\n' +
      '  "无" (none/don\'t) - Example: "我们无法提供此服务" = "we cannot provide this service" → CONFLICT\n\n' +
      '"Only X" logic:\n' +
      '  "we only have black" → everything NOT black = CONFLICT (white=CONFLICT, red=CONFLICT, etc.)\n' +
      '  "only synthetic materials" → cotton=CONFLICT, wool=CONFLICT, etc.\n\n' +
      '🟠 PARTIAL = Supplier mentioned this topic but gave INCOMPLETE details:\n' +
      '  • Said "we can make prototypes" but NO price → PARTIAL\n' +
      '  • Said "startup fee 200 RMB" but NO lead time → PARTIAL\n' +
      '  • Said "we have photos" → CONFIRMED (they said they have them)\n' +
      '  • Said "can do samples, price 22 RMB" but no lead time → PARTIAL\n\n' +
      '✅ CONFIRMED = Supplier clearly answered YES with sufficient detail:\n' +
      '  • "we have product photos" → CONFIRMED for Images requirement\n' +
      '  • "we can customize" → CONFIRMED for customization\n' +
      '  • "we accept MOQ 100" → CONFIRMED for MOQ requirement\n' +
      '  • "we make 20x20 samples" → CONFIRMED for samples (spec matches)\n\n' +
      '⏳ MISSING = Supplier did NOT mention this requirement at all\n\n' +
      '=== CRITICAL RULES ===\n' +
      '1. NEGATION WORDS = Always CONFLICT. Look for Chinese words: 不做, 不能, 无法, 没有, 不提供, 不支持\n' +
      '2. Spec mismatch (color/size/material differs) = CONFLICT, never MISSING\n' +
      '3. Never mark MISSING if supplier mentioned a value - even if wrong = CONFLICT\n' +
      '4. "Only X" = CONFLICT for everything that is NOT X\n' +
      '5. LOCKED statuses (confirmed/conflict from before) NEVER change\n\n' +
      '=== FOLLOW-UP QUESTION ===\n' +
      'CRITICAL: Generate ONE single comprehensive question that bundles ALL items needing action:\n' +
      '- Include EVERY MISSING requirement (grey items) in this ONE question\n' +
      '- Include EVERY PARTIAL requirement (orange items) in this ONE question, asking for MISSING DETAILS ONLY\n' +
      '- Do NOT include confirmed (green) or conflict (red) items\n' +
      'This is NOT multiple separate questions - it is ONE multi-part question!\n\n' +
      'Format guidelines:\n' +
      '  3+ items → Use numbered list format:\n' +
      '    能否逐条确认以下信息:\n' +
      '    1. [specific question about first missing/partial item]\n' +
      '    2. [specific question about second missing/partial item]\n' +
      '    3. [specific question about third missing/partial item]\n\n' +
      '  1-2 items → Use conversational format without numbers\n\n' +
      'EXAMPLES OF CORRECT BUNDLING:\n' +
      '  WRONG: Only asks about one item: "您是否可以提供样品?"\n' +
      '  CORRECT: Asks about all missing/partial items together:\n' +
      '    "能否逐条确认: 1. 最低起订量(MOQ)是多少? 2. 您是否可以提供1-2个样品？样品的起样成本和交期各是多少? 3. 您支持定制吗?"\n\n' +
      'Vary language naturally. Do not use identical templates each time.\n\n' +
      'Respond ONLY in this JSON format (no other text):\n' +
      '{\n' +
      '  "requirements": [\n' +
      '    { "label": "exact requirement name", "status": "confirmed|partial|conflict|missing", "evidence": "quote or reason" }\n' +
      '  ],\n' +
      '  "supplier_notes": "key facts about supplier",\n' +
      '  "supplier_notes_english": "English translation",\n' +
      '  "next_question_chinese": "ONE comprehensive question in Chinese - bundle all missing/partial items together",\n' +
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
