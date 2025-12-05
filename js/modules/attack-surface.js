// Attack Surface Analysis Module
// Categorizes requests by attack surface using LLM

import { streamExplanationWithSystem } from './ai.js';
import { getAISettings } from './ai.js';

/**
 * Build analysis prompt for LLM
 * @param {Array} requests - Array of request objects
 * @returns {string} - Formatted prompt
 */
export function buildAnalysisPrompt(requests) {
    const requestSummaries = requests.map((req, idx) => {
        const url = req.request?.url || '';
        const method = req.request?.method || 'GET';

        // Extract query parameters
        let params = [];
        try {
            const urlObj = new URL(url);
            params = Array.from(urlObj.searchParams.keys());
        } catch (e) {
            // Invalid URL
        }

        // Extract header names (not values for privacy)
        const headerNames = req.request?.headers?.map(h => h.name) || [];

        return {
            index: idx,
            method: method,
            path: url.split('?')[0],
            params: params,
            headers: headerNames.filter(h => !['cookie', 'authorization', 'x-api-key'].includes(h.toLowerCase()))
        };
    });

    const prompt = `Analyze these HTTP requests and group them into security-relevant attack surface categories.

IMPORTANT: Create categories dynamically based on what you see in the requests. Don't use a predefined list.

Common patterns to look for:
- Authentication & session management
- User data & personal information
- File operations & media handling
- Administrative & privileged functions
- Financial & payment operations
- Third-party integrations
- Analytics & tracking
- API endpoints & data operations
- Static resources

For each request, provide:
1. category: A clear, descriptive category name (e.g., "User Authentication", "Payment Processing", "Admin Panel")
2. confidence: "high", "medium", or "low"
3. reasoning: Brief explanation (max 15 words)
4. icon: A single emoji that represents the category (e.g., 🔐 for auth, 💳 for payments)

Create NEW categories as needed based on the actual functionality you observe.

Requests:
${JSON.stringify(requestSummaries, null, 2)}

Output ONLY valid JSON array in this exact format:
[
  {
    "index": 0,
    "category": "User Authentication",
    "confidence": "high",
    "reasoning": "Login endpoint with credentials",
    "icon": "🔐"
  }
]`;

    return prompt;
}

/**
 * Parse LLM response into categories
 * @param {string} response - LLM response text
 * @returns {Array} - Parsed categories
 */
export function parseCategories(response) {
    try {
        // Extract JSON from markdown code blocks if present
        let jsonText = response.trim();
        const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            jsonText = jsonMatch[1];
        }

        const categories = JSON.parse(jsonText);

        // Validate structure
        if (!Array.isArray(categories)) {
            throw new Error('Response is not an array');
        }

        return categories.map(cat => ({
            index: cat.index,
            category: cat.category || 'Uncategorized',
            confidence: cat.confidence || 'low',
            reasoning: cat.reasoning || 'No reasoning provided',
            icon: cat.icon || '❓'
        }));
    } catch (error) {
        console.error('Failed to parse LLM response:', error);
        return [];
    }
}

/**
 * Analyze attack surface using LLM
 * @param {Array} requests - Array of request objects
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>} - Categories mapped by request index
 */
export async function analyzeAttackSurface(requests, onProgress) {
    const { provider, apiKey, model } = getAISettings();

    if (!apiKey) {
        throw new Error('AI API key not configured. Please set it in Settings.');
    }

    // Limit batch size to control costs
    const batchSize = 50;
    const requestBatch = requests.slice(0, batchSize);

    if (onProgress) {
        onProgress({ status: 'building_prompt', count: requestBatch.length });
    }

    const prompt = buildAnalysisPrompt(requestBatch);

    if (onProgress) {
        onProgress({ status: 'analyzing', count: requestBatch.length });
    }

    const systemPrompt = `You are a security expert analyzing web application attack surfaces. 
Categorize HTTP requests based on their functionality and security implications.
Be precise and consistent. Output ONLY valid JSON.`;

    let fullResponse = '';

    await streamExplanationWithSystem(
        apiKey,
        model,
        systemPrompt,
        prompt,
        (text) => {
            fullResponse = text;
            if (onProgress) {
                onProgress({ status: 'streaming', text: text });
            }
        },
        provider
    );

    if (onProgress) {
        onProgress({ status: 'parsing', text: fullResponse });
    }

    const categories = parseCategories(fullResponse);

    // Map to object for easy lookup
    const categoryMap = {};
    categories.forEach(cat => {
        categoryMap[cat.index] = {
            category: cat.category,
            confidence: cat.confidence,
            reasoning: cat.reasoning,
            icon: cat.icon
        };
    });

    if (onProgress) {
        onProgress({ status: 'complete', categories: categoryMap });
    }

    return categoryMap;
}

/**
 * Cache categories to localStorage
 * @param {Object} categories - Categories mapped by request index
 */
export function cacheCategories(categories) {
    try {
        localStorage.setItem('repPlusAttackSurfaceCache', JSON.stringify(categories));
    } catch (error) {
        console.error('Failed to cache categories:', error);
    }
}

/**
 * Load cached categories from localStorage
 * @returns {Object} - Cached categories or empty object
 */
export function loadCachedCategories() {
    try {
        const cached = localStorage.getItem('repPlusAttackSurfaceCache');
        return cached ? JSON.parse(cached) : {};
    } catch (error) {
        console.error('Failed to load cached categories:', error);
        return {};
    }
}

/**
 * Clear category cache
 */
export function clearCategoryCache() {
    localStorage.removeItem('repPlusAttackSurfaceCache');
}
