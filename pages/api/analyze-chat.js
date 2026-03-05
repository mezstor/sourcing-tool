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
      '❌ CONFLICT = Supplier answered but value DIFFERS from requirement:\n' +
      '  • Color mismatch: requirement="white", supplier said "black" or "only black" → CONFLICT\n' +
      '  • Color mismatch: requirement="black", supplier said "only yellow" → CONFLICT\n' +
      '  • Size mismatch: requirement="2 meter", supplier said "3 meters" → CONFLICT\n' +
      '  • Size mismatch: requirement="13 inch", supplier said "14 inch" → CONFLICT\n' +
      '  • Material mismatch: requirement="metal", supplier said "plastic" → CONFLICT\n' +
      '  • Material mismatch: requirement="cotton", supplier said "synthetic fiber" → CONFLICT\n' +
      '  • MOQ mismatch: requirement="MOQ 100", supplier said "MOQ 600" → CONFLICT\n' +
      '  • Brand mismatch: requirement="Nike", supplier said they make another brand → CONFLICT\n' +
      '  • "Only X" = CONFLICT for everything that is NOT X\n' +
      '    Example: "we only have black lights" → white=CONFLICT, red=CONFLICT, etc.\n' +
      '  • Direct refusal: "we cannot", "not possible", "we don\'t have" → CONFLICT\n\n' +
      '🟠 PARTIAL = Supplier mentioned this topic but gave INCOMPLETE details:\n' +
      '  • Said "we can make prototypes" but NO price → PARTIAL\n' +
      '  • Said "startup fee 200 RMB" but NO lead time → PARTIAL\n' +
      '  • Said "we can send photos" → PARTIAL or CONFIRMED depending on whether they mean now\n' +
      '  • Said "can do" for a multi-part requirement without all details → PARTIAL\n\n' +
      '✅ CONFIRMED = Supplier clearly answered YES with sufficient detail:\n' +
      '  • Simple yes/no requirement: "yes we have photos" → CONFIRMED\n' +
      '  • Customization: "we can customize" → CONFIRMED\n' +
      '  • MOQ match: requirement="100 units", supplier said "我们最低100件" → CONFIRMED\n' +
      '  • Prototype complete: price + lead time + capability all mentioned → CONFIRMED\n\n' +
      '⏳ MISSING = Supplier did NOT mention this requirement at all\n\n' +
      '=== IMPORTANT RULES ===\n' +
      '1. "Only X" means NO to everything else. ALWAYS mark other colors/materials as CONFLICT.\n' +
      '2. A different size/color/material = CONFLICT, not missing. Supplier DID answer but wrongly.\n' +
      '3. Never mark something as MISSING if the supplier mentioned a value for it (even a wrong value).\n' +
      '4. LOCKED statuses from previous chats stay locked. Never change confirmed→missing or conflict→missing.\n' +
      '5. "I can send pictures" = CONFIRMED for Images requirement (they said they have them).\n\n' +
      '=== FOLLOW-UP QUESTION ===\n' +
      'Generate ONE question covering:\n' +
      '- All MISSING requirements (ask if they have them)\n' +
      '- PARTIAL requirements (ask for the SPECIFIC missing details only)\n' +
      '- Do NOT ask about CONFIRMED or CONFLICT requirements\n' +
      'Format: 3+ items → numbered list in Chinese. 1-2 items → conversational.\n' +
      'Vary phrasing naturally - do not use same template each time.\n\n' +
      'Respond ONLY in this JSON format (no other text):\n' +
      '{\n' +
      '  "requirements": [\n' +
      '    { "label": "exact requirement name from list", "status": "confirmed|partial|conflict|missing", "evidence": "exact quote or clear reason" }\n' +
      '  ],\n' +
      '  "supplier_notes": "key facts about supplier (Chinese ok)",\n' +
      '  "supplier_notes_english": "English translation of supplier notes",\n' +
      '  "next_question_chinese": "follow-up question in Chinese",\n' +
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
