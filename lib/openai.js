export async function analyzeChat(chatText, masterRequirements) {
  try {
    const response = await fetch('/api/analyze-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chatText,
        masterRequirements
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to analyze chat')
    }

    return await response.json()
  } catch (error) {
    console.error("Chat analysis error:", error)
    throw error
  }
}
