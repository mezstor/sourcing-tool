import OpenAI from 'openai'

const apiKey = process.env.OPENAI_API_KEY
const client = new OpenAI({ apiKey })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { chatText, masterRequirements } = req.body

    if (!chatText || !masterRequirements) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Filter out unimportant requirements
    const importantKeywords = ['mage', 'moq', 'price', 'cost', 'prototype', 'sample', 'size', 'dimension', 'box', 'material', 'color', 'payment', 'lead time', 'quantity', 'specification']
    const filteredRequirements = masterRequirements.filter(r => {
      const label = r.label.toLowerCase()
      // Keep if matches important keywords or explicitly marked
      return importantKeywords.some(k => label.includes(k)) || r.label.includes('MOQ') || r.label.includes('Images')
    })

    const prompt = 'You are a sourcing expert auditor for import/export operations.\n\n' +
      'MASTER REQUIREMENTS for this supplier:\n' +
      filteredRequirements.map(r => `- ${r.label} (Status: ${r.status})`).join('\n') +
      '\n\nSUPPLIER CHAT TEXT:\n' +
      chatText +
      '\n\nAnalyze the chat and:\n' +
      '1. For each master requirement, determine if it\'s: "confirmed" (green), "conflict" (red), or "missing" (grey)\n' +
      '2. Extract any additional supplier notes that aren\'t related to master requirements\n' +
      '3. IMPORTANT: Generate ONE comprehensive multi-part question covering ALL GREY items (missing info). Do NOT ask about RED items again (they already said no). The question should cover multiple aspects in one message to maximize efficiency.\n' +
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
      '  "next_question_chinese": "ONE comprehensive multi-part question in Chinese covering ALL GREY items (not multiple questions)",\n' +
      '  "next_question_english": "English translation of the question"\n' +
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
