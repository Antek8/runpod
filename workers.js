const HOST_TEMPLATE = "https://{podId}-11434.proxy.runpod.net";
const CHAT_ENDPOINT = "/api/chat";

// --- CORS Configuration ---
// IMPORTANT: For better security, replace '*' with your actual Cloudflare Pages URL
// once it's deployed (e.g., 'https://your-chat-app.pages.dev').
const ALLOWED_ORIGINS = ['*']; // Or specify your frontend's origin

export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight (OPTIONS) requests. Browsers send these first.
        if (request.method === 'OPTIONS') {
            return handleOptions(request);
        }

        // We only want POST requests for the chat API.
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Expected POST request' }), {
                status: 405,
                headers: { ...createCorsHeaders(request.headers.get("Origin")), 'Content-Type': 'application/json' }
            });
        }

        // Get secrets from Cloudflare environment variables.
        const podId = env.RUNPOD_POD_ID;
        const apiKey = env.RUNPOD_API_KEY;

        if (!podId || !apiKey) {
            console.error("WORKER_ERROR: Secrets (RUNPOD_POD_ID or RUNPOD_API_KEY) not configured in Cloudflare Worker environment.");
            return new Response(JSON.stringify({ error: 'Backend secrets not configured.' }), {
                status: 500,
                headers: { ...createCorsHeaders(request.headers.get("Origin")), 'Content-Type': 'application/json' }
            });
        }

        try {
            const requestBody = await request.json();
            const runpodUrl = HOST_TEMPLATE.replace("{podId}", podId) + CHAT_ENDPOINT;

            console.log(`WORKER_INFO: Sending request to RunPod URL: ${runpodUrl}`);
            // console.log(`WORKER_INFO: Request body to RunPod: ${JSON.stringify(requestBody)}`); // Be careful logging sensitive data

            const runpodResponse = await fetch(runpodUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            const responseBodyText = await runpodResponse.text();
            const corsHeadersWithContentType = {
                ...createCorsHeaders(request.headers.get("Origin")),
                'Content-Type': 'application/json'
            };

            console.log(`WORKER_INFO: Received status from RunPod: ${runpodResponse.status}`);
            // console.log(`WORKER_INFO: Received raw text from RunPod: ${responseBodyText}`); // Log raw response for debugging

            if (!runpodResponse.ok) {
                console.error(`WORKER_ERROR: RunPod API Error. Status: ${runpodResponse.status}, Body: ${responseBodyText}`);
                return new Response(JSON.stringify({
                    error: `RunPod API Error (${runpodResponse.status})`,
                    details: responseBodyText // Send RunPod's error text if available
                }), {
                    status: runpodResponse.status > 0 ? runpodResponse.status : 500,
                    headers: corsHeadersWithContentType
                });
            }

            // If RunPod response is OK, try to parse it as JSON.
            // This helps catch cases where RunPod sends 200 OK but an empty or malformed body.
            try {
                if (!responseBodyText) {
                    console.error("WORKER_ERROR: RunPod returned 200 OK but with an empty response body.");
                    return new Response(JSON.stringify({ error: 'RunPod returned an empty successful response.' }), {
                        status: 502, // Bad Gateway - upstream sent empty response
                        headers: corsHeadersWithContentType
                    });
                }
                // Attempt to parse to ensure it's valid JSON before sending to client.
                // The actual response from RunPod is already in responseBodyText.
                // We don't need to re-parse and re-stringify if it's already good.
                // The main thing is that the frontend will parse it.
                // However, logging it parsed can be useful.
                JSON.parse(responseBodyText); // This will throw if not valid JSON
                console.log("WORKER_INFO: Successfully received and validated JSON from RunPod.");

                return new Response(responseBodyText, {
                    status: 200,
                    headers: corsHeadersWithContentType
                });
            } catch (parseError) {
                console.error(`WORKER_ERROR: Failed to parse successful RunPod response as JSON. Error: ${parseError.message}. Raw response: ${responseBodyText}`);
                return new Response(JSON.stringify({
                    error: 'Received malformed JSON response from RunPod.',
                    details: parseError.message,
                    rawResponse: responseBodyText.substring(0, 500) // Send a snippet of the raw response
                }), {
                    status: 502, // Bad Gateway
                    headers: corsHeadersWithContentType
                });
            }

        } catch (error) {
            console.error(`WORKER_CRITICAL_ERROR: An unexpected error occurred in the worker. Error: ${error.message}`, error.stack);
            // Check if the error is due to request.json() failing (e.g., empty or non-JSON request body from client)
            if (error instanceof SyntaxError && error.message.includes("JSON")) {
                 return new Response(JSON.stringify({ error: `Invalid JSON in request body: ${error.message}` }), {
                    status: 400, // Bad Request
                    headers: { ...createCorsHeaders(request.headers.get("Origin")), 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify({ error: `Internal Server Error in Worker: ${error.message}` }), {
                status: 500,
                headers: { ...createCorsHeaders(request.headers.get("Origin")), 'Content-Type': 'application/json' }
            });
        }
    },
};

// --- CORS Helper Functions ---
function createCorsHeaders(origin) {
    const headers = {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization", // Added Authorization as an example if needed
        "Access-Control-Max-Age": "86400",
    };
    const requestOrigin = origin || (request.headers ? request.headers.get("Origin") : null);

    if (ALLOWED_ORIGINS.includes('*') || (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin))) {
        headers["Access-Control-Allow-Origin"] = requestOrigin || '*';
    } else if (ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes('*')) {
        // If specific origins are listed and '*' is not one of them,
        // and the request's origin doesn't match, don't set ACAO.
        // Or, set it to the first allowed origin as a default (less common).
        // For now, if not a match and not '*', no ACAO is set, relying on browser default.
        // A better approach for production is to explicitly list allowed origins.
        // If ALLOWED_ORIGINS is ['https://my.site.com'], then only that origin gets the header.
    }
    return headers;
}

function handleOptions(request) {
    const origin = request.headers.get("Origin");
    const headers = createCorsHeaders(origin);
    // Ensure the response to an OPTIONS request has a 204 No Content status if successful
    // or 200 OK. 204 is often preferred.
    return new Response(null, { status: 204, headers });
}