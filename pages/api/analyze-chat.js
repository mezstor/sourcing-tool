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

    // Build context about what's already been confirmed or conflicted
    let previousContext = ''
    if (previousAnalysis && previousAnalysis.requirements) {
      const confirmed = previousAnalysis.requirements.filter(r => r.status === 'confirmed').map(r => r.label).join(', ')
      const conflicted = previousAnalysis.requirements.filter(r => r.status === 'conflict').map(r => r.label).join(', ')

      if (confirmed) {
        previousContext += `\n\nALREADY CONFIRMED (do NOT ask about these again): ${confirmed}`
      }
      if (conflicted) {
        previousContext += `\n\nALREADY CONFLICTED - Supplier said NO (do NOT ask about these again): ${conflicted}`
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
      '1. For each master requirement, determine if it\'s: "confirmed" (green), "conflict" (red), or "missing" (grey)\n\n' +
      'CONFIRMED STATUS INDICATORS (Look for these words/phrases - ignore typos like "possibe"/"costumized"):\n' +
      '  - "we have", "we can", "we provide", "we do", "yes", "we accept", "we agree"\n' +
      '  - "possible", "no problem", "can do", "available", "in stock"\n' +
      '  - "we can provide customization", "customized printing available"\n' +
      '  - Even with typos: "possibe" = possible, "costumized" = customized\n\n' +
      'CONFLICT STATUS INDICATORS:\n' +
      '  - "we cannot", "we don\'t have", "not possible", "impossible", "we don\'t do"\n' +
      '  - "we don\'t offer", "not available", "not in stock", "we don\'t provide"\n' +
      '  - "no customization", "no printing", "cannot be done"\n\n' +
      'MISSING STATUS:\n' +
      '  - Requirement not mentioned in the chat at all\n\n' +
      'IMPORTANT: Look at the FULL context. If supplier says "we have no glass but customization is possible", then:\n' +
      '  - glass = CONFLICT (they said they don\'t have it)\n' +
      '  - customized printing = CONFIRMED (they said "possible/can do")\n' +
      '  - Do NOT confuse them\n\n' +
      '2. Extract any additional supplier notes that aren\'t related to master requirements\n' +
      '3. IMPORTANT: Generate ONE comprehensive multi-part question covering ALL GREY items that haven\'t been confirmed or conflicted yet. Do NOT ask about items that are already confirmed or conflicted. The question should combine multiple grey items into one efficient message.\n' +
      '4. If there are no GREY items left, indicate "All key requirements confirmed"\n' +
      '5. Generate BOTH Chinese AND English versions of the question\n\n' +
      'Example format for multi-part question in Chinese: "请问贵司在100件起订量下的价格是多少，样品/小批量价格如何，起样成本及交期各多少？"\n\n' +
      'Respond in JSON format:\n' +
      '{\n' +
      '  "requirements": [\n' +
      '    { "label": "requirement name", "status": "confirmed|conflict|missing", "evidence": "brief quote or note from supplier" }\n' +
      '  ],\n' +
      '  "supplier_notes": "any extra info about the supplier",\n' +
      '  "supplier_notes_english": "English translation of supplier notes (if different from above)",\n' +
      '  "next_question_chinese": "ONE comprehensive multi-part question in Chinese covering ALL GREY items (not multiple questions), or \\"All key requirements confirmed\\" if nothing left",\n' +
      '  "next_question_english": "English translation of the question or confirmation message"\n' +
      '}'

    const message = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
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
