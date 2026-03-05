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

      '=== STEP 3: CONTEXT-AWARE MATCHING (CRITICAL!) ===\n' +
      'BEFORE comparing values, you MUST understand WHAT they apply to!\n' +
      '\n' +
      'CONTEXT UNDERSTANDING - Identify WHICH component/part the spec applies to:\n' +
      '  Requirement: "5cm ring"\n' +
      '    → Spec applies to: THE RING (not the box, not the container)\n' +
      '  Supplier: "15cm x 15cm box"\n' +
      '    → Spec applies to: THE BOX (not the ring inside)\n' +
      '  RESULT: Different components → NO CONFLICT (5cm ring can fit in 15cm box)\n' +
      '\n' +
      '  Requirement: "Prototype capability (1-2 units)"\n' +
      '    → What: Can make small samples\n' +
      '  Supplier: "Production price: 8 RMB per unit for 250 units"\n' +
      '    → What: Bulk production pricing (NOT prototype pricing!)\n' +
      '  RESULT: Different production types → Prototype capability is STILL MISSING ⏳\n' +
      '\n' +
      '  Requirement: "Prototype price"\n' +
      '    → What: Cost of 1-2 sample units\n' +
      '  Supplier: "Prototype: 300 RMB each"\n' +
      '    → What: Cost per sample unit\n' +
      '  RESULT: Same component, same pricing level → CONFIRMED ✅ (or PARTIAL if no lead time)\n' +
      '\n' +
      '=== STEP 4: SEMANTIC MATCHING FOR REQUIREMENT SPECS ===\n' +
      'Use AI judgment (not hardcoded rules) for ANY requirement specification:\n' +
      'For EACH requirement with a specific value:\n' +
      '  1. Extract supplier value from message (e.g., "lavendel" from "we only make lavendel")\n' +
      '  2. Understand the CATEGORY: What type of spec is this?\n' +
      '     - Scent/flavor: vanilla, lavendel, rose, mint → all in same category\n' +
      '     - Color: red, blue, green, yellow → all in same category\n' +
      '     - Material: cotton, linen, wool, polyester, artificial leather, glass, stone, metal → same category\n' +
      '     - Texture: smooth, rough, silky → same category\n' +
      '     - Size/dimensions: any measurement values → same category (BUT CONTEXT MATTERS!)\n' +
      '     - And 1000 other possible specifications (taste, weight, shape, style, finish, etc.)\n' +
      '  3. SEMANTIC COMPARISON (WITH CONTEXT):\n' +
      '     - If supplier value = requirement value EXACTLY (or equivalent) AND SAME COMPONENT → CONFIRMED ✅\n' +
      '       EXAMPLES: req="vanilla" + supplier="vanilla" → CONFIRMED\n' +
      '       EXAMPLES: req="cotton ring" + supplier="cotton ring" → CONFIRMED (equivalent)\n' +
      '     - If supplier value ≠ requirement value BUT same category AND SAME COMPONENT → CONFLICT 🔴\n' +
      '       EXAMPLES: req="5cm ring" + supplier="15cm ring" → CONFLICT (both ring sizes, but different)\n' +
      '       EXAMPLES: req="vanilla flavor" + supplier="lavendel flavor" → CONFLICT (both flavors, different)\n' +
      '     - If supplier value is for DIFFERENT COMPONENT → NOT A CONFLICT\n' +
      '       EXAMPLES: req="5cm ring" + supplier="15cm box" → NO CONFLICT (different parts)\n' +
      '       EXAMPLES: req="prototype" + supplier="bulk production price" → NO CONFLICT (different production types)\n' +
      '     - If supplier did NOT mention this at all → MISSING ⏳\n' +
      '  4. CRITICAL: Use semantic reasoning to UNDERSTAND CONTEXT first, then compare!\n\n' +

      '=== ANALYSIS RULES ===\n\n' +

      '✅ CONFIRMED = Supplier clearly said YES or gave a specific value that matches requirement:\n' +
      '  • Capability requirements: supplier said "可以做" / "能做" / "we can make" / "we offer this" → CONFIRMED\n' +
      '    - "原型机可以做" = "we CAN make prototypes" → Prototype/Sample CAPABILITY = CONFIRMED\n' +
      '    - "我们可以定制" = "we can customize" → Customization = CONFIRMED\n' +
      '  • Simple yes: "we have photos" / "有图片" → Images = CONFIRMED\n' +
      '  • MOQ match: requirement "10 units" + supplier "最低10件" → MOQ = CONFIRMED\n' +
      '  • Material/Type match: requirement="cotton" + supplier offers "cotton" → Material = CONFIRMED\n\n' +

      '🟠 PARTIAL = Supplier gave SOME information but not everything needed:\n' +
      '  • PROTOTYPE PRICE (not production price!) given = PROTOTYPE CAPABILITY is CONFIRMED ✅\n' +
      '    - CONTEXT MATTERS: "300 RMB prototype" ≠ "8 RMB per unit for 250 pieces"\n' +
      '    - "Prototype price: 300 RMB" OR "We can make samples for 300 RMB" → they CAN make prototypes!\n' +
      '      → Prototype capability = CONFIRMED ✅\n' +
      '      → Prototype price & lead time = PARTIAL 🟠 (price given, lead time missing)\n' +
      '    - "Production price: 8 RMB per unit for 250 pieces" → this is BULK pricing, NOT prototype pricing!\n' +
      '      → Prototype capability = STILL MISSING ⏳ (you must ask!)\n' +
      '      → Production pricing is different from prototype pricing\n' +
      '    - NEVER ask "can you make prototypes?" if they already quoted PROTOTYPE price!\n' +
      '    - ALWAYS ask "can you make prototypes?" if they only quoted PRODUCTION/BULK price!\n' +
      '  • "Will send" / "Will do" = PARTIAL (promise, not yet delivered)\n' +
      '    - "我马上发图片" / "I will send photos" = promise to send → Images = PARTIAL 🟠\n' +
      '    - NOT MISSING (they promised) but NOT CONFIRMED (not yet done)\n' +
      '    - Note: If photos sent outside chat, they cannot be shown as confirmed (they\'re not text)\n' +
      '  • Price mentioned but lead time missing → price & lead time = PARTIAL\n' +
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
      '    - "原型价格为300元" = prototype price 300 → they CAN make prototypes!\n' +
      '    ANY of the above = price is given → price & lead time requirement = at least PARTIAL\n' +
      '    EXAMPLE: "起价200元人民币" → price & lead time = PARTIAL (price given, lead time missing)\n' +
      '    EXAMPLE: "单价22块" → price & lead time = PARTIAL (price given, lead time missing)\n' +
      '    EXAMPLE: "原型价格为300元" → Prototype price & lead time = PARTIAL, Prototype capability = CONFIRMED ✅\n\n' +

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
      '  • SIZE/DIMENSION MISMATCH = CONFLICT 🔴 (ONLY IF SAME COMPONENT!)\n' +
      '    - CONTEXT CRITICAL: Compare dimensions for THE SAME PART only!\n' +
      '    - req="5cm ring" supplier="15cm ring" → SAME COMPONENT (ring) DIFFERENT SIZE → CONFLICT 🔴\n' +
      '    - req="5cm ring" supplier="15cm x 15cm box" → DIFFERENT COMPONENTS (ring vs box) → NO CONFLICT\n' +
      '    - req="10 units (MOQ)" supplier="400 units" → DIFFERENT PRODUCTION LEVELS → CONFLICT 🔴 (for standard orders)\n' +
      '    - req="10 units (prototype MOQ)" supplier="400 units (production MOQ)" → DIFFERENT LEVELS → NO CONFLICT\n' +
      '    - req="small" supplier="extra large" → SAME COMPONENT DIFFERENT SIZE → CONFLICT 🔴\n' +
      '  • EXPLICIT REFUSAL = CONFLICT 🔴\n' +
      '    - Chinese: "不做"=don\'t make, "不能"=cannot, "无法"=unable, "没有"=don\'t have\n' +
      '    - "我们不做原型" = "we do NOT make prototypes" → CONFLICT 🔴\n' +
      '  • "ONLY X" = CONFLICT for anything that is NOT X\n' +
      '    - "我们只能做人造革，不能做棉布" = only artificial leather, NOT cotton → CONFLICT 🔴\n' +
      '    - "我们只做猫绳，不做狗绳" = only cat ropes, NOT dog ropes → CONFLICT 🔴\n' +
      '    - "我们只有15厘米的塑料环" = ONLY 15cm rings (not 5cm) → SIZE CONFLICT 🔴\n\n' +

      '⏳ MISSING = Supplier did not mention this at all\n\n' +

      '=== CRITICAL RULES ===\n' +
      '0. CONTEXT IS KING - Always understand WHAT before comparing VALUES:\n' +
      '   - "5cm ring" ≠ "5cm box" - different components\n' +
      '   - "Prototype price" ≠ "Production price" - different production levels\n' +
      '   - "Ring size 5cm" ≠ "Box size 15cm" - different parts, no conflict\n' +
      '   - "Prototype price 300 RMB" ≠ "Production price 8 RMB per 250 units" - different levels\n' +
      '1. SEMANTIC MATCHING for any requirement specification:\n' +
      '   - Always use AI JUDGMENT, not hardcoded string matching\n' +
      '   - Understand what category the specification is (scent, color, material, texture, style, size, etc.)\n' +
      '   - If supplier offers something in the SAME CATEGORY, SAME COMPONENT, but DIFFERENT VALUE → CONFLICT 🔴\n' +
      '   - This works for 1000+ different specification types without any new code\n' +
      '   - Example: requirement="vanilla ring" + supplier="lavendel ring" → CONFLICT 🔴 (same part, different value)\n' +
      '   - Example: requirement="cotton ring" + supplier="artificial leather ring" → CONFLICT 🔴 (same part, different value)\n' +
      '   - Example: requirement="cotton ring" + supplier="cotton box" → NO CONFLICT (different parts)\n' +
      '2. PROTOTYPE PRICE vs PRODUCTION PRICE:\n' +
      '   - "Prototype price 300 RMB" = they CAN make prototypes!\n' +
      '     → Prototype capability = CONFIRMED ✅\n' +
      '     → Prototype price & lead time = PARTIAL 🟠 (price given, lead time missing)\n' +
      '   - "Production price 8 RMB per unit for 250 pieces" = BULK pricing, NOT prototype pricing!\n' +
      '     → Prototype capability = STILL MISSING ⏳ (you MUST ask!)\n' +
      '   - CONTEXT MATTERS: These are different production types!\n' +
      '3. PROMISES vs DELIVERY:\n' +
      '   - "我马上发图片" / "I will send photos" = PARTIAL 🟠 (promise made, awaiting delivery)\n' +
      '   - "我们有图片" / "We have photos" = CONFIRMED ✅ (already have)\n' +
      '   - "我会定制" / "We can customize" = CONFIRMED ✅ (capability)\n' +
      '   - Note: If photos sent OUTSIDE chat, they cannot be shown as CONFIRMED in the app (not text)\n' +
      '4. SIZE CONFLICTS (CONTEXT DEPENDENT!):\n' +
      '   - ONLY conflict if same component has different size!\n' +
      '   - req="5cm ring" + supplier="15cm ring" → CONFLICT 🔴 (same component, different size)\n' +
      '   - req="5cm ring" + supplier="15cm box" → NO CONFLICT (different components)\n' +
      '   - req="small product" + supplier="large product" → CONFLICT 🔴 (same component, different size)\n' +
      '4. LOCKED statuses (confirmed/conflict) NEVER change\n' +
      '5. PARTIAL statuses CAN upgrade to CONFIRMED if new chat provides the missing details\n' +
      '6. Never copy old evidence - always write fresh evidence based on the new chat + overall conversation\n' +
      '7. DO NOT REPEAT QUESTIONS ALREADY ANSWERED:\n' +
      '   - If supplier gave prototype price → DON\'T ask "can you make prototypes?"\n' +
      '   - If supplier promised to send photos → DON\'T ask "do you have photos?"\n' +
      '   - If supplier gave size → DON\'T ask "what size?" if they already specified\n\n' +

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
      '  RESULT: Material = CONFLICT 🔴 (supplier offers different material)\n\n' +
      'EXAMPLE 5 - CONTEXT CRITICAL: "Prototype price 300 RMB" vs "Production price 8 RMB per 250":\n' +
      '  Requirements: Prototype capability, Prototype price & lead time\n' +
      '  Supplier says: "原型价格为300元人民币" (prototype price 300 RMB each)\n' +
      '    → CONTEXT: This is PROTOTYPE pricing, not production pricing!\n' +
      '    → Prototype capability = CONFIRMED ✅ (they quoted prototype price!)\n' +
      '    → Prototype price & lead time = PARTIAL 🟠 (price given, lead time missing)\n' +
      '  RESULT: Prototype capability = CONFIRMED ✅, Prototype price = PARTIAL 🟠\n' +
      '  NEXT QUESTION: Only ask for LEAD TIME!\n' +
      '  ----\n' +
      '  WRONG SCENARIO - Supplier says: "生产价格：250件起，每件8元" (Production: 250 min, 8 RMB each)\n' +
      '    → CONTEXT: This is PRODUCTION pricing, NOT prototype pricing!\n' +
      '    → Prototype capability = STILL MISSING ⏳ (we DON\'T know if they can make 1-2 samples!)\n' +
      '    → Prototype price & lead time = MISSING ⏳\n' +
      '  RESULT: These are different production levels! Must still ask about prototype capability!\n\n' +
      'EXAMPLE 6 - CONTEXT CRITICAL: "5cm ring" vs "15cm x 15cm box":\n' +
      '  Requirements: Ring size 5cm\n' +
      '  Supplier says: "我们有5厘米的环和15厘米x15厘米的盒子" (we have 5cm rings and 15cm x 15cm boxes)\n' +
      '    → CONTEXT: Ring size = 5cm ✅, Box size = 15cm (DIFFERENT COMPONENTS)\n' +
      '    → Ring size = CONFIRMED ✅\n' +
      '  RESULT: No conflict! Ring matches 5cm requirement. Box is different component.\n' +
      '  ----\n' +
      '  CONFLICT SCENARIO - Supplier says: "我们只有15厘米的塑料环" (we only have 15cm plastic rings)\n' +
      '    → CONTEXT: Ring size = 15cm, but requirement = 5cm (SAME COMPONENT)\n' +
      '    → Ring size = CONFLICT 🔴 (supplier can\'t provide 5cm, only 15cm)\n' +
      '  RESULT: This IS a conflict! Different sizes for the SAME part!\n\n' +
      'EXAMPLE 7 - NO CONFLICT: "5cm ring" vs "15cm packaging":\n' +
      '  Requirements: Product ring size 5cm\n' +
      '  Supplier says: "环是5厘米的，包装盒是15厘米" (ring is 5cm, packaging box is 15cm)\n' +
      '    → CONTEXT: Ring = 5cm ✅ (matches requirement), Box = 15cm (different part)\n' +
      '    → Ring size = CONFIRMED ✅\n' +
      '  RESULT: No conflict! Compare SAME components only!'

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
