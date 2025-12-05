// AI Integration Module (Anthropic & Gemini)

/**
 * Retrieves all AI settings from localStorage.
 * Includes the active vendor, and settings for both Anthropic and Gemini.
 */
export function getAISettings() {
    return {
        // Global setting to determine which AI to use
        vendor: localStorage.getItem('ai_vendor') || 'anthropic',

        // Anthropic Settings
        anthropic: {
            apiKey: localStorage.getItem('anthropic_api_key') || '',
            model: localStorage.getItem('anthropic_model') || 'claude-3-5-sonnet-20241022'
        },

        // Gemini Settings
        gemini: {
            apiKey: localStorage.getItem('gemini_api_key') || '',
            model: localStorage.getItem('gemini_model') || 'gemini-2.5-flash'
        }
    };
}

/**
 * Saves all AI settings to localStorage.
 * @param {string} vendor The currently selected vendor ('anthropic' or 'gemini').
 * @param {string} anthropicApiKey The Anthropic API key.
 * @param {string} anthropicModel The Anthropic model name.
 * @param {string} geminiApiKey The Gemini API key.
 * @param {string} geminiModel The Gemini model name.
 */
export function saveAISettings(vendor, anthropicApiKey, anthropicModel, geminiApiKey, geminiModel) {
    localStorage.setItem('ai_vendor', vendor);
    localStorage.setItem('anthropic_api_key', anthropicApiKey);
    localStorage.setItem('anthropic_model', anthropicModel);
    localStorage.setItem('gemini_api_key', geminiApiKey);
    localStorage.setItem('gemini_model', geminiModel);
}


/**
 * Streams explanation from the Anthropic Claude API.
 * (Original function, no logic changes needed.)
 */
export async function streamExplanationFromClaude(apiKey, model, request, onUpdate) {
    const systemPrompt = "You are an expert security researcher and web developer. Explain the following HTTP request in detail, highlighting interesting parameters, potential security implications, and what this request is likely doing. Be concise but thorough.";

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: model,
            max_tokens: 1024,
            system: systemPrompt,
            stream: true,
            messages: [
                { role: 'user', content: `Explain this HTTP request:\n\n${request}` }
            ]
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to communicate with Anthropic API');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const dataStr = line.slice(6);
                if (dataStr === '[DONE]') continue;

                try {
                    const data = JSON.parse(dataStr);
                    if (data.type === 'content_block_delta' && data.delta.text) {
                        fullText += data.delta.text;
                        onUpdate(fullText);
                    }
                } catch (e) {
                    // Ignore parse errors for incomplete chunks
                }
            }
        }
    }

    return fullText;
}

export async function streamExplanationFromClaudeWithSystem(apiKey, model, systemPrompt, userPrompt, onUpdate) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: model,
            max_tokens: 2048,
            system: systemPrompt,
            stream: true,
            messages: [
                { role: 'user', content: userPrompt }
            ]
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to communicate with Anthropic API');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const dataStr = line.slice(6);
                if (dataStr === '[DONE]') continue;

                try {
                    const data = JSON.parse(dataStr);
                    if (data.type === 'content_block_delta' && data.delta.text) {
                        fullText += data.delta.text;
                        onUpdate(fullText);
                    }
                } catch (e) {
                    // Ignore parse errors for incomplete chunks
                }
            }
        }
    }

    return fullText;
}

export async function streamExplanationFromGemini(apiKey, model, request, onUpdate) {
    const systemInstruction = "You are an expert security researcher and web developer. Explain the following HTTP request in detail, highlighting interesting parameters, potential security implications, and what this request is likely doing. Be concise but thorough.";
    
    // Using the public Generative Language API streaming endpoint
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            contents: [{
                role: 'user',
                parts: [{ text: `${systemInstruction}\n\n${request}` }]
            }],
            
        }),
    });

    if (!response.ok) {
        // Standard error handling for non-200 status codes
        const error = await response.json().catch(() => ({}));
        throw new Error(`Gemini API error: ${response.status} ${response.statusText} ${JSON.stringify(error)}`);
    }

    // Read the entire body and parse it as a single JSON array (or object, depending on the endpoint)
    const responseArray = await response.json(); 

    let fullText = '';

    // Check if the response is an array or a single object.
    // The /v1/models/{model}:generateContent endpoint returns a single object.
    // The content you provided was an array, so we'll assume it's an array of chunks.

    const chunks = Array.isArray(responseArray) ? responseArray : [responseArray];

    // Loop through each chunk object (data)
    for (const data of chunks) {
        
        // CRITICAL SAFETY CHECK: Handle cases where content is blocked
        if (data.promptFeedback && data.promptFeedback.blockReason) {
            throw new Error(`Gemini API Content Blocked: ${data.promptFeedback.blockReason}`);
        }

        // Extract the text chunk
        const chunkText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        if (chunkText) {
            fullText += chunkText;
            
            // Use the onUpdate callback if it exists (for a batch job, this is less useful, 
            // but it maintains the pattern from your original code)
            if (typeof onUpdate === 'function') {
                onUpdate(fullText); 
            }
        }
    }

    // The function returns the final concatenated result
    return fullText;
}

export async function streamExplanationFromGeminiWithSystem(apiKey, model, systemPrompt, userPrompt, onUpdate) {
    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: combinedPrompt }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 4096
            }
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to communicate with Gemini API');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const dataStr = line.slice(6).trim();
                if (!dataStr) continue;

                try {
                    const data = JSON.parse(dataStr);
                    if (data.candidates && data.candidates[0]?.content?.parts) {
                        for (const part of data.candidates[0].content.parts) {
                            if (part.text) {
                                fullText += part.text;
                                onUpdate(fullText);
                            }
                        }
                    }
                } catch (e) {
                    // Ignore parse errors for incomplete chunks
                }
            }
        }
    }

    return fullText;
}


export function setupAIFeatures(elements) {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const saveSettingsBtn = document.getElementById('save-settings-btn');

    // New and updated references for settings
    const aiVendorSelect = document.getElementById('ai-vendor-select'); 
    
    const anthropicApiKeyInput = document.getElementById('anthropic-api-key');
    const anthropicModelSelect = document.getElementById('anthropic-model');
    const anthropicSettingGroup = document.getElementById('anthropic-settings-group');

    const geminiApiKeyInput = document.getElementById('gemini-api-key'); 
    const geminiModelSelect = document.getElementById('gemini-model');
    const geminiSettingGroup = document.getElementById('gemini-settings-group');

    const warnSelectAiVendor = document.getElementById('warn-select-ai-vendor');

    
    // Function to show/hide the correct settings group
    const updateVendorSettingsVisibility = () => {
        const selectedVendor = aiVendorSelect.value;
        
        // 1. Hide ALL groups first
        anthropicSettingGroup.classList.add('hidden');
        geminiSettingGroup.classList.add('hidden');
        warnSelectAiVendor.classList.add('hidden');

        // 2. Show the relevant group
        if (selectedVendor === 'gemini') {
            geminiSettingGroup.classList.remove('hidden');

        } else if (selectedVendor === 'anthropic') {
            anthropicSettingGroup.classList.remove('hidden');

        } else {
            // Default / 'Select a Vendor' state
            warnSelectAiVendor.classList.remove('hidden');
        }
    };

    // 1. Listen for the dropdown change (manual user interaction)
    aiVendorSelect.addEventListener('change', updateVendorSettingsVisibility);

    // 2. Listen for the settings modal being opened (THE FIX for saved settings)
    settingsBtn.addEventListener('click', () => {
        // Now, call the function to display the correct panel based on the current dropdown value
        aiVendorSelect.value = localStorage.getItem('ai_vendor');
        updateVendorSettingsVisibility();
    });

    // 3. (Optional but recommended) Run once on script load
    updateVendorSettingsVisibility();


    const aiMenuBtn = document.getElementById('ai-menu-btn');
    const aiMenuDropdown = document.getElementById('ai-menu-dropdown');
    const explainBtn = document.getElementById('explain-btn');
    const suggestAttackBtn = document.getElementById('suggest-attack-btn');
    const explanationModal = document.getElementById('explanation-modal');
    const explanationContent = document.getElementById('explanation-content');
    const ctxExplainAi = document.getElementById('ctx-explain-ai');

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            const settings = getAISettings();
            
            if (aiVendorSelect) aiVendorSelect.value = settings.vendor;
            
            anthropicApiKeyInput.value = settings.anthropic.apiKey;
            if (anthropicModelSelect) anthropicModelSelect.value = settings.anthropic.model;

            if (geminiApiKeyInput) geminiApiKeyInput.value = settings.gemini.apiKey;
            if (geminiModelSelect) geminiModelSelect.value = settings.gemini.model;


            settingsModal.style.display = 'block';
        });
    }

    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            const vendor = aiVendorSelect ? aiVendorSelect.value : 'anthropic';
            
            const anthropicKey = anthropicApiKeyInput.value.trim();
            const anthropicModel = anthropicModelSelect ? anthropicModelSelect.value : 'claude-3-5-sonnet-20241022';

            const geminiKey = geminiApiKeyInput ? geminiApiKeyInput.value.trim() : '';
            const geminiModel = geminiModelSelect ? geminiModelSelect.value : 'gemini-2.5-flash';


            if ((vendor === 'anthropic' && !anthropicKey) || (vendor === 'gemini' && !geminiKey)) {
                 alert(`Please enter a valid API Key for the selected vendor (${vendor}).`);
                 return;
            }
            
            saveAISettings(vendor, anthropicKey, anthropicModel, geminiKey, geminiModel);

            alert('AI Settings saved!');
            settingsModal.style.display = 'none';
        });
    }

    if (aiMenuBtn && aiMenuDropdown) {
        aiMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            aiMenuDropdown.classList.toggle('show');
        });
        window.addEventListener('click', () => {
            if (aiMenuDropdown.classList.contains('show')) {
                aiMenuDropdown.classList.remove('show');
            }
        });
    }

    const handleAIRequest = async (promptPrefix, content) => {
        const settings = getAISettings();
        const vendor = settings.vendor;
        let apiKey;
        let model;
        let streamFunction;

        if (vendor === 'gemini') {
            apiKey = settings.gemini.apiKey;
            model = settings.gemini.model;
            streamFunction = streamExplanationFromGemini;
        } else { // Default to Anthropic
            apiKey = settings.anthropic.apiKey;
            model = settings.anthropic.model;
            streamFunction = streamExplanationFromClaude;
        }

        if (!apiKey) {
            alert(`Please configure your ${vendor} API Key in Settings first.`);
            settingsModal.style.display = 'block';
            return;
        }

        // Update modal title
        const modalTitleElement = explanationModal.querySelector('.modal-header h3');
        if (modalTitleElement) {
            modalTitleElement.textContent = 'Request Explanation';
        }

        explanationModal.style.display = 'block';
        explanationContent.innerHTML = '<div class="loading-spinner">Generating...</div>';

        try {
            const finalPromptContent = promptPrefix + "\n\n" + content;

            // Call the selected stream function
            await streamFunction(apiKey, model, finalPromptContent, (text) => {
                if (typeof marked !== 'undefined') {
                    explanationContent.innerHTML = marked.parse(text);
                } else {
                    explanationContent.innerHTML = `<pre style="white-space: pre-wrap; font-family: sans-serif;">${text}</pre>`;
                }
            });
        } catch (error) {
            explanationContent.innerHTML = `<div style="color: var(--error-color); padding: 20px;">Error: ${error.message}</div>`;
        }
    };

        const handleAIRequestWithSystem = async (systemPrompt, userPrompt, modalTitle = 'AI Analysis') => {
        const { provider, apiKey, model } = getAISettings();
        if (!apiKey) {
            const providerName = provider === 'gemini' ? 'Gemini' : 'Anthropic';
            alert(`Please configure your ${providerName} API Key in Settings first.`);
            settingsModal.style.display = 'block';
            return;
        }

        // Update modal title
        const modalTitleElement = explanationModal.querySelector('.modal-header h3');
        if (modalTitleElement) {
            modalTitleElement.textContent = modalTitle;
        }

        explanationModal.style.display = 'block';
        explanationContent.innerHTML = '<div class="loading-spinner">Generating...</div>';

        try {
            await streamExplanationWithSystem(apiKey, model, systemPrompt, userPrompt, (text) => {
                if (typeof marked !== 'undefined') {
                    explanationContent.innerHTML = marked.parse(text);
                } else {
                    explanationContent.innerHTML = `<pre style="white-space: pre-wrap; font-family: sans-serif;">${text}</pre>`;
                }
            }, provider);
        } catch (error) {
            explanationContent.innerHTML = `<div style="color: var(--error-color); padding: 20px;">Error: ${error.message}</div>`;
        }
    };

    if (explainBtn) {
        explainBtn.addEventListener('click', () => {
            const content = elements.rawRequestInput.innerText;
            if (!content.trim()) {
                alert('Request is empty.');
                return;
            }
            handleAIRequest("Explain this HTTP request:", content);
        });
    }

    if (suggestAttackBtn) {
        suggestAttackBtn.addEventListener('click', async () => {
            const requestContent = elements.rawRequestInput.innerText;
            if (!requestContent.trim()) {
                alert('Request is empty.');
                return;
            }
            // Get response content
            let responseContent = elements.rawResponseDisplay.innerText || '';
            let hasResponse = responseContent.trim().length > 0;

            // If no response exists, auto-send the request first
            if (!hasResponse) {
                const shouldSend = confirm('No response available. Send the request first to get a response for analysis?');
                if (!shouldSend) {
                    // User declined, analyze request only
                    hasResponse = false;
                } else {
                    // Import handleSendRequest dynamically
                    try {
                        const { handleSendRequest } = await import('./request-handler.js');

                        // Show loading indicator
                        explanationModal.style.display = 'block';
                        explanationContent.innerHTML = '<div class="loading-spinner">Sending request and waiting for response...</div>';

                        // Send the request
                        await handleSendRequest();

                        // Wait a bit for UI to update
                        await new Promise(resolve => setTimeout(resolve, 500));

                        // Get the response that was just populated
                        responseContent = elements.rawResponseDisplay.innerText || '';
                        hasResponse = responseContent.trim().length > 0;

                        if (!hasResponse) {
                            explanationContent.innerHTML = '<div style="color: var(--error-color); padding: 20px;">Failed to get response. Analyzing request only.</div>';
                            await new Promise(resolve => setTimeout(resolve, 1500));
                        }
                    } catch (error) {
                        explanationContent.innerHTML = `<div style="color: var(--error-color); padding: 20px;">Error sending request: ${error.message}</div>`;
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        hasResponse = false;
                    }
                }
            }

            // Build the analysis prompt
            let analysisPrompt = `Analyze the following HTTP request${hasResponse ? ' and response' : ''} and produce:

1. A short summary of what this endpoint likely does.
2. The top 5 realistic attack vectors based on ${hasResponse ? 'BOTH the request and the response' : 'the request (note: response not available)'}.
3. For each attack vector:
   - Why this vector might work (based on ${hasResponse ? 'request/response evidence' : 'request evidence'})
   - 2–3 test payloads
4. Highlight reflected parameters, error messages, sensitive data, or unusual patterns.
5. If applicable, propose a multi-step chained attack.

REQUEST:
${requestContent}`;

            if (hasResponse) {
                analysisPrompt += `

RESPONSE:
${responseContent}`;
            } else {
                analysisPrompt += `

⚠️ NOTE: Response data is not available. Analysis will be limited to request-based insights only.`;
            }

            analysisPrompt += `

Output must stay concise, structured, and actionable. Format as clear Markdown.`;

            // Use the new system prompt for attack vector analysis
            handleAIRequestWithSystem(
                "You are an AI security assistant inside a web security testing tool. Your job is to analyze HTTP requests and responses to identify realistic attack vectors and generate payloads. Be precise and base everything strictly on what you see.",
                analysisPrompt,
                'Security Analysis'
            );
        });
    }

    if (ctxExplainAi) {
        ctxExplainAi.addEventListener('click', () => {
            // Hide context menu if open
            const contextMenu = document.getElementById('context-menu');
            if (contextMenu) {
                contextMenu.classList.remove('show');
                contextMenu.style.visibility = 'hidden';
            }

            const selection = window.getSelection().toString();
            if (!selection.trim()) {
                alert('Please select some text to explain.');
                return;
            }
            const prompt = `Explain this specific part of an HTTP request / response: \n\n"${selection}"\n\nProvide context on what it is, how it's used, and any security relevance.`;
            handleAIRequest(prompt, ""); // Content is in prompt
        });
    }

    // Close Modals
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal) modal.style.display = 'none';
        });
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    });
}

export async function streamExplanationWithSystem(apiKey, model, systemPrompt, userPrompt, onUpdate, provider = 'gemini') {
    if (provider === 'gemini') {
        return streamExplanationFromGeminiWithSystem(apiKey, model, systemPrompt, userPrompt, onUpdate);
    }
    return streamExplanationFromClaudeWithSystem(apiKey, model, systemPrompt, userPrompt, onUpdate);
}
