import OpenAI from 'openai'

const apiKey = process.env.OPENAI_API_KEY
const client = new OpenAI({ apiKey })

// Consolidate related specifications to avoid duplicates and improve clarity
function consolidateSpecifications(specs) {
  if (!specs || specs.length === 0) return specs

  const consolidated = []
  const seen = new Set()

  for (const spec of specs) {
    const lowerSpec = spec.toLowerCase()

    // Check if this spec is a duplicate or related to an existing one
    let merged = false

    // Consolidate sample-related specs
    if ((lowerSpec.includes('sample') || lowerSpec.includes('prototype')) &&
        (lowerSpec.includes('capability') || lowerSpec.includes('capacity') ||
         lowerSpec.includes('price') || lowerSpec.includes('cost') ||
         lowerSpec.includes('lead time') || lowerSpec.includes('timeline'))) {

      // Find existing sample-related spec
      const existingIndex = consolidated.findIndex(s =>
        (s.toLowerCase().includes('sample') || s.toLowerCase().includes('prototype'))
      )

      if (existingIndex >= 0) {
        // Merge with existing sample spec
        const existing = consolidated[existingIndex]
        if (!existing.toLowerCase().includes('capability') && lowerSpec.includes('capability')) {
          consolidated[existingIndex] = `${existing} (including capability for 1-2 units)`
        }
        if (!existing.toLowerCase().includes('price') && (lowerSpec.includes('price') || lowerSpec.includes('cost'))) {
          consolidated[existingIndex] = `${consolidated[existingIndex]}, pricing, and lead time`
        }
        merged = true
      }
    }

    // Consolidate lead time specs
    if (!merged && (lowerSpec.includes('lead time') || lowerSpec.includes('timeline') || lowerSpec.includes('delivery time'))) {
      const existingIndex = consolidated.findIndex(s => s.toLowerCase().includes('lead time') || s.toLowerCase().includes('timeline'))
      if (existingIndex >= 0) {
        merged = true // Skip, already have lead time
      }
    }

    // Add spec if not merged as duplicate
    if (!merged && !seen.has(lowerSpec.slice(0, 50))) {
      consolidated.push(spec)
      seen.add(lowerSpec.slice(0, 50))
    }
  }

  return consolidated
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { projectName } = req.body

    if (!projectName) {
      return res.status(400).json({ error: 'Missing project name' })
    }

    const prompt = `You are a sourcing expert. Given a product name, generate 5-8 key specifications/requirements that a supplier MUST confirm.

Product: "${projectName}"

Generate specific, measurable requirements that would be important for sourcing this product from Alibaba/1688.

Return ONLY a JSON object with this format (no markdown, no extra text):
{
  "specifications": [
    "Specification 1",
    "Specification 2",
    "Specification 3"
  ]
}

Examples of good specs:
- "Material composition and quality grade"
- "Exact dimensions (length x width x height)"
- "Color options available"
- "Minimum order quantity"
- "Sample availability and cost"
- "Lead time from order to shipment"
- "Certification standards (CE, FCC, etc.)"
- "Packaging type and customization options"`

    const message = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 512
    })

    const responseText = message.choices[0].message.content

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("No JSON found in response")
    }

    const result = JSON.parse(jsonMatch[0])

    // Consolidate related specifications to avoid duplicates
    const consolidatedSpecs = consolidateSpecifications(result.specifications)

    return res.status(200).json({ specifications: consolidatedSpecs })
  } catch (error) {
    console.error('OpenAI API error:', error)
    return res.status(500).json({
      error: 'Failed to generate specifications',
      message: error.message
    })
  }
}
