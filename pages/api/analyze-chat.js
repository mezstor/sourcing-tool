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

    const requirementsList = masterRequirements.map(r => {
      const detail = r.value ? ` (${r.value})` : ''
      return `- "${r.label}"${detail}`
    }).join('\n')

    const prompt =
      'You are a strict sourcing auditor checking supplier responses against requirements.\n\n' +
      '=== MASTER REQUIREMENTS ===\n' +
      'These are the specifications your client needs. Some have specific values (e.g., Material=cotton), others are capabilities (can you make it?).\n' +
      requirementsList +
      previousContext +
      '\n\n=== NEW SUPPLIER CHAT (analyze this carefully) ===\n' +
      chatText +
      '\n\n=== STEP 1: UNDERSTAND REQUIREMENT SPECS ===\n' +
      'Requirements can have specific values. Examples:\n' +
      '  • Material = "cotton" (requirement specifies material)\n' +
      '  • Product Type = "dog rope" (requirement specifies type)\n' +
      '  • MOQ = "10 units" (requirement specifies minimum quantity)\n' +
      'Compare supplier offers AGAINST these specs.\n\n' +

      '=== STEP 2: PRODUCT SPECIFICATION EXTRACTION ===\n' +
      'Extract what supplier actually offers:\n' +
      '  • MATERIAL: What material are they offering? (e.g., artificial leather, cotton, stone, glass, plastic, metal)\n' +
      '  • TYPE/MODEL: What exact product type? (e.g., cat rope vs dog rope, glass bottle vs plastic bottle)\n' +
      '  • PROPERTIES: Any other key properties (color, size, style, etc.)\n' +
      '  EXAMPLES:\n' +
      '    - "我们只能做人造革材质的牵引绳" → Material: artificial leather, Type: leash/rope\n' +
      '    - "我们只做猫绳" → Type: cat rope/leash\n' +
      '    - "我们用石头做" → Material: stone\n' +
      '    - "只能做玻璃的" → Material: glass\n\n' +

      '=== STEP 3: SEMANTIC MATCHING FOR REQUIREMENT SPECS ===\n' +
      'Use AI judgment (not hardcoded rules) for ANY requirement specification:\n' +
      'For EACH requirement with a specific value:\n' +
      '  1. Extract supplier value from message (e.g., "lavendel" from "we only make lavendel")\n' +
      '  2. Understand the CATEGORY: What type of spec is this?\n' +
      '     - Scent/flavor: vanilla, lavendel, rose, mint → all in same category\n' +
      '     - Color: red, blue, green, yellow → all in same category\n' +
      '     - Material: cotton, linen, wool, polyester, artificial leather, glass, stone, metal → same category\n' +
      '     - Texture: smooth, rough, silky → same category\n' +
      '     - Size/dimensions: any measurement values → same category\n' +
      '     - And 1000 other possible specifications (taste, weight, shape, style, finish, etc.)\n' +
      '  3. SEMANTIC COMPARISON:\n' +
      '     - If supplier value = requirement value EXACTLY (or equivalent) → CONFIRMED ✅\n' +
      '       EXAMPLES: req="vanilla" + supplier="vanilla" → CONFIRMED\n' +
      '       EXAMPLES: req="cotton" + supplier="cotton fabric" → CONFIRMED (equivalent)\n' +
      '     - If supplier value ≠ requirement value BUT same category → CONFLICT 🔴\n' +
      '       EXAMPLES: req="vanilla" + supplier="lavendel" → CONFLICT (both scents, but different)\n' +
      '       EXAMPLES: req="red" + supplier="blue" → CONFLICT (both colors, but different)\n' +
      '       EXAMPLES: req="cotton" + supplier="artificial leather" → CONFLICT (both materials, but different)\n' +
      '     - If supplier did NOT mention this category at all → MISSING ⏳\n' +
      '  4. CRITICAL: Use semantic reasoning, NOT string matching. The system must understand meaning.\n\n' +

      '=== ANALYSIS RULES ===\n\n' +

      '✅ CONFIRMED = Supplier clearly said YES or gave a specific value that matches requirement:\n' +
      '  • Capability requirements: supplier said "可以做" / "能做" / "we can make" / "we offer this" → CONFIRMED\n' +
      '    - "原型机可以做" = "we CAN make prototypes" → Prototype/Sample CAPABILITY = CONFIRMED\n' +
      '    - "我们可以定制" = "we can customize" → Customization = CONFIRMED\n' +
      '  • Simple yes: "we have photos" / "有图片" → Images = CONFIRMED\n' +
      '  • MOQ match: requirement "10 units" + supplier "最低10件" → MOQ = CONFIRMED\n' +
      '  • Material/Type match: requirement="cotton" + supplier offers "cotton" → Material = CONFIRMED\n\n' +

      '🟠 PARTIAL = Supplier gave SOME information but not everything needed:\n' +
      '  • Price mentioned but lead time missing → price & lead time = PARTIAL\n' +
      '  • Capability confirmed but price/lead time not yet given → capability = CONFIRMED, price & lead time = PARTIAL\n' +
      '  PRICE RECOGNITION - ANY of these patterns = price information:\n' +
      '    Currency words: 元, 块, 块钱, 人民币, RMB, rmb, CNY, cny, ¥\n' +
      '    Price words: 价格, 报价, 单价, 起价, 费用, 成本, 定价, 价钱, 收费\n' +
      '    Examples:\n' +
      '    - "22元" / "22块" / "22块钱" / "¥22" → price = 22\n' +
      '    - "200人民币" / "200 RMB" / "200 rmb" / "200 CNY" → price = 200\n' +
      '    - "起价200元" = starting price 200 → price info\n' +
      '    - "单价22元" = unit price 22 → price info\n' +
      '    - "报价200元" = quoted price 200 → price info\n' +
      '    - "费用22元" / "成本22元" = cost 22 → price info\n' +
      '    ANY of the above = price is given → price & lead time requirement = at least PARTIAL\n' +
      '    EXAMPLE: "起价200元人民币" → price & lead time = PARTIAL (price given, lead time missing)\n' +
      '    EXAMPLE: "单价22块" → price & lead time = PARTIAL (price given, lead time missing)\n\n' +

      '❌ CONFLICT = Supplier said NO or gave a DIFFERENT value than required (RED STATUS):\n' +
      '  SEMANTIC MISMATCHES (AI determines if specs conflict):\n' +
      '  • SAME CATEGORY, DIFFERENT VALUE = CONFLICT 🔴\n' +
      '    Examples:\n' +
      '    - Scent: req="vanilla" supplier="lavendel" → both scents, different → CONFLICT 🔴\n' +
      '    - Color: req="red" supplier="blue" → both colors, different → CONFLICT 🔴\n' +
      '    - Material: req="cotton" supplier="artificial leather" → both materials, different → CONFLICT 🔴\n' +
      '    - Texture: req="smooth" supplier="rough" → both textures, different → CONFLICT 🔴\n' +
      '    - Style: req="modern" supplier="vintage" → both styles, different → CONFLICT 🔴\n' +
      '    - Weight: req="lightweight" supplier="heavy" → same scale, different → CONFLICT 🔴\n' +
      '    - Size: req="small" supplier="extra large" → same dimension, different → CONFLICT 🔴\n' +
      '  • EXPLICIT REFUSAL = CONFLICT 🔴\n' +
      '    - Chinese: "不做"=don\'t make, "不能"=cannot, "无法"=unable, "没有"=don\'t have\n' +
      '    - "我们不做原型" = "we do NOT make prototypes" → CONFLICT 🔴\n' +
      '  • "ONLY X" = CONFLICT for anything that is NOT X\n' +
      '    - "我们只能做人造革，不能做棉布" = only artificial leather, NOT cotton → CONFLICT 🔴\n' +
      '    - "我们只做猫绳，不做狗绳" = only cat ropes, NOT dog ropes → CONFLICT 🔴\n\n' +

      '⏳ MISSING = Supplier did not mention this at all\n\n' +

      '=== CRITICAL RULES ===\n' +
      '0. SEMANTIC MATCHING for any requirement specification:\n' +
      '   - Always use AI JUDGMENT, not hardcoded string matching\n' +
      '   - Understand what category the specification is (scent, color, material, texture, style, size, etc.)\n' +
      '   - If supplier offers something in the SAME CATEGORY but DIFFERENT VALUE → CONFLICT 🔴\n' +
      '   - This works for 1000+ different specification types without any new code\n' +
      '   - Example: requirement="vanilla" + supplier="lavendel" → CONFLICT 🔴 (both scents, different)\n' +
      '   - Example: requirement="cotton" + supplier="artificial leather" → CONFLICT 🔴 (both materials, different)\n' +
      '   - Example: "We can make prototypes of artificial leather" + requirement "cotton" = capability CONFIRMED but material CONFLICT 🔴\n' +
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
      '}\n\n' +
      'EXAMPLE 1 - Requirement: "Vanilla scent":\n' +
      '  Supplier says: "我们只能做薰衣草香味" (we can only make lavendel scent)\n' +
      '  SEMANTIC ANALYSIS:\n' +
      '    - Category: SCENT (both are scents)\n' +
      '    - Requirement: vanilla\n' +
      '    - Supplier: lavendel\n' +
      '    - Same category? YES → both are scents\n' +
      '    - Same value? NO → vanilla ≠ lavendel\n' +
      '  RESULT: Scent = CONFLICT 🔴 (supplier offers different scent)\n\n' +
      'EXAMPLE 2 - Requirement: "Cotton dog rope":\n' +
      '  Supplier says: "我们只能做人造革材质的牵引绳" (only artificial leather leashes)\n' +
      '  SEMANTIC ANALYSIS:\n' +
      '    - Material category: MATERIAL (both are materials)\n' +
      '    - Type category: TYPE (both are ropes/leashes)\n' +
      '    - Material: requirement "cotton" vs supplier "artificial leather" → different materials → CONFLICT 🔴\n' +
      '    - Type: both are ropes/leashes → CONFIRMED ✅\n' +
      '  RESULT: Material = CONFLICT 🔴, Type = CONFIRMED ✅\n\n' +
      'EXAMPLE 3 - Requirement: "Red color":\n' +
      '  Supplier says: "我们只做蓝色的" (we only make blue)\n' +
      '  SEMANTIC ANALYSIS:\n' +
      '    - Category: COLOR (both are colors)\n' +
      '    - Requirement: red\n' +
      '    - Supplier: blue\n' +
      '    - Same category? YES → both are colors\n' +
      '    - Same value? NO → red ≠ blue\n' +
      '  RESULT: Color = CONFLICT 🔴 (supplier offers different color)\n\n' +
      'EXAMPLE 4 - Requirement: "Glass product":\n' +
      '  Supplier says: "我们只用石头做" (we only make stone)\n' +
      '  SEMANTIC ANALYSIS:\n' +
      '    - Category: MATERIAL (both are materials)\n' +
      '    - Requirement: glass\n' +
      '    - Supplier: stone\n' +
      '    - Same category? YES → both are materials\n' +
      '    - Same value? NO → glass ≠ stone\n' +
      '  RESULT: Material = CONFLICT 🔴 (supplier offers different material)'

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
