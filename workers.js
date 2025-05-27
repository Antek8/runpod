// Define the RunPod host template and chat endpoint.
// Ensure '11434' is the correct port for your RunPod LLM service.
const HOST_TEMPLATE = "https://{podId}-11434.proxy.runpod.net";
const CHAT_ENDPOINT = "/api/chat";

// --- CORS Configuration ---
// IMPORTANT: For better security, replace '*' with your actual Cloudflare Pages URL
// once it's deployed (e.g., 'https://your-chat-app.pages.dev').
const ALLOWED_ORIGINS = ['*'];

export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight (OPTIONS) requests. Browsers send these first.
        if (request.method === 'OPTIONS') {
            return handleOptions(request);
        }

        // We only want POST requests for the chat API.
        if (request.method !== 'POST') {
            return new Response('Expected POST', { status: 405 });
        }

        // Get secrets from Cloudflare environment variables.
        // These MUST be set in your Worker's settings in the Cloudflare dashboard.
        const podId = env.RUNPOD_POD_ID;
        const apiKey = env.RUNPOD_API_KEY;

        // Check if secrets are configured.
        if (!podId || !apiKey) {
            console.error("Secrets not configured in Cloudflare Worker environment.");
            return new Response('Backend secrets (RUNPOD_POD_ID, RUNPOD_API_KEY) must be configured.', {
                status: 500,
                headers: createCorsHeaders(request.headers.get("Origin"))
            });
        }

        try {
            // Get the JSON payload (model, messages) sent from the frontend.
            const requestBody = await request.json();
            const runpodUrl = HOST_TEMPLATE.replace("{podId}", podId) + CHAT_ENDPOINT;

            // Make the actual call to the RunPod API.
            const runpodResponse = await fetch(runpodUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(requestBody) // Pass the original body through.
            });

            // Get the response body as text to handle both success and error JSON/text.
            const responseBodyText = await runpodResponse.text();
            const corsHeaders = createCorsHeaders(request.headers.get("Origin"));

            // Check if the RunPod call was successful.
            if (!runpodResponse.ok) {
                console.error("RunPod API Error:", runpodResponse.status, responseBodyText);
                // Try to return the error from RunPod if possible, otherwise a generic error.
                return new Response(JSON.stringify({ error: `RunPod API Error (${runpodResponse.status}): ${responseBodyText}` }), {
                    status: runpodResponse.status > 0 ? runpodResponse.status : 500, // Ensure valid status
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // If successful, return the RunPod response (as text) back to the frontend.
            // The frontend expects JSON, so ensure we set the content type.
            return new Response(responseBodyText, {
                status: 200,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json'
                }
            });

        } catch (error) {
            console.error("Worker Error:", error);
            return new Response(JSON.stringify({ error: `Internal Server Error: ${error.message}` }), {
                status: 500,
                headers: {
                    ...createCorsHeaders(request.headers.get("Origin")),
                    'Content-Type': 'application/json'
                }
            });
        }
    },
};

// --- CORS Helper Functions ---

// Creates appropriate CORS headers.
function createCorsHeaders(origin) {
    const headers = {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type", // Add any other headers your frontend might send.
        "Access-Control-Max-Age": "86400", // Cache preflight response for a day.
    };
    // Check if the request's origin is allowed.
    if (ALLOWED_ORIGINS.includes('*') || (origin && ALLOWED_ORIGINS.includes(origin))) {
        headers["Access-Control-Allow-Origin"] = origin || '*';
    } else {
        // If not allowed, don't set the ACAO header or set it to a specific allowed origin.
        // For simplicity here, we'll allow * if set, otherwise deny (implicitly).
        // In production, you'd set it to your specific Pages URL.
        if (ALLOWED_ORIGINS.includes('*')) {
             headers["Access-Control-Allow-Origin"] = '*';
        }
    }
    return headers;
}

// Handles the OPTIONS preflight request.
function handleOptions(request) {
    const origin = request.headers.get("Origin");
    const headers = createCorsHeaders(origin);
    return new Response(null, { headers });
}
