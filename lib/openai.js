import OpenAI from 'openai'

const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY
const client = new OpenAI({ apiKey })

export async function analyzeChat(chatText, masterRequirements) {
  try {
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

    const message = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: prompt }
      ]
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("No JSON found in response")

    return JSON.parse(jsonMatch[0])
  } catch (error) {
    console.error("OpenAI API error:", error)
    throw error
  }
}
