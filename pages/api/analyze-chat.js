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
      '\n\nAnalyze the chat and:\n' +
      '1. For each master requirement, determine if it\'s: "confirmed" (green), "conflict" (red), or "missing" (grey)\n' +
      '   - CONFIRMED: Supplier explicitly agreed, confirmed, or accepted the requirement\n' +
      '   - CONFLICT: Supplier explicitly said NO, cannot provide, refused, not available, not possible, doesn\'t work, etc.\n' +
      '   - MISSING: Requirement not mentioned or discussed yet\n' +
      '2. Extract any additional supplier notes that aren\'t related to master requirements\n' +
      '3. IMPORTANT: Generate ONE comprehensive multi-part question covering ALL GREY items that haven\'t been confirmed or conflicted yet. Do NOT ask about items that are already confirmed or conflicted. The question should combine multiple grey items into one efficient message.\n' +
      '4. If there are no GREY items left, indicate "All key requirements confirmed"\n' +
      '5. Generate BOTH Chinese AND English versions of the question\n\n' +
      'Example format for multi-part question in Chinese: "请问贵司在100件起订量下的价格是多少，样品/小批量价格如何，起样成本及交期各多少？"\n\n' +
      'Respond in JSON format:\n' +
      '{\n' +
      '  "requirements": [\n' +
      '    { "label": "requirement name", "status": "confirmed|conflict|missing", "evidence": "brief quote or note" }\n' +
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
