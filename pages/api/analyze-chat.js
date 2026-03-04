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

    const prompt = `You are a sourcing expert auditor.

MASTER REQUIREMENTS for this supplier:
${masterRequirements.map(r => `- ${r.label} (Status: ${r.status})`).join('\n')}

SUPPLIER CHAT TEXT:
${chatText}

Analyze the chat and:
1. For each master requirement, determine if it's: "confirmed" (green), "conflict" (red), or "missing" (grey)
2. Extract any additional supplier notes that aren't related to master requirements
3. Generate a professional Chinese question to ask the supplier about any RED or GREY items

Respond in JSON format:
{
  "requirements": [
    { "label": "requirement name", "status": "confirmed|conflict|missing", "evidence": "brief quote or note" }
  ],
  "supplier_notes": "any extra info about the supplier",
  "next_question_chinese": "professional question in Chinese"
}`

    const message = await client.chat.completions.create({
      model: 'gpt-4-turbo',
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
