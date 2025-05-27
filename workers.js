// Define the RunPod host template and chat endpoint.
// Ensure '11434' is the correct port for your RunPod LLM service.
const HOST_TEMPLATE = "https://{podId}-11434.proxy.runpod.net";
const CHAT_ENDPOINT = "/api/chat";

// --- CORS Configuration ---
// IMPORTANT: For production, replace '*' with your actual Cloudflare Pages URL:
// const ALLOWED_ORIGINS = ['https://runllm.pages.dev'];
const ALLOWED_ORIGINS = ['*']; // Using '*' makes setup/debugging easier initially.

/**
 * Main fetch event handler for the Cloudflare Worker.
 */
export default {
    async fetch(request, env, ctx) {
        const origin = request.headers.get("Origin");
        console.log(`WORKER_LOG: Request received. Method: ${request.method}, Origin: ${origin}, URL: ${request.url}`);

        // Handle CORS Preflight (OPTIONS) requests first.
        if (request.method === 'OPTIONS') {
            console.log("WORKER_LOG: Handling OPTIONS preflight request.");
            return handleOptions(request, origin);
        }

        // Handle the actual API (POST) requests.
        if (request.method === 'POST') {
            console.log("WORKER_LOG: Handling POST request.");
            return handlePost(request, env, origin);
        }

        // If the method is neither OPTIONS nor POST, return 405 Method Not Allowed.
        console.warn(`WORKER_WARN: Method ${request.method} not allowed. Returning 405.`);
        return new Response(JSON.stringify({ error: `Method ${request.method} Not Allowed` }), {
            status: 405,
            headers: {
                ...createCorsHeaders(origin), // Include CORS headers even on errors
                'Content-Type': 'application/json',
                'Allow': 'POST, OPTIONS' // Inform client which methods *are* allowed
            }
        });
    },
};

/**
 * Handles the main POST request logic: checking secrets, calling RunPod, returning response.
 * @param {Request} request - The incoming request object.
 * @param {object} env - The environment object containing secrets.
 * @param {string | null} origin - The request origin for CORS.
 * @returns {Response} The response to send back to the client.
 */
async function handlePost(request, env, origin) {
    const corsHeadersWithContentType = {
        ...createCorsHeaders(origin),
        'Content-Type': 'application/json'
    };

    // Check if secrets are set in the Cloudflare Worker environment.
    const podId = env.RUNPOD_POD_ID;
    const apiKey = env.RUNPOD_API_KEY;
    if (!podId || !apiKey) {
        console.error("WORKER_ERROR: Secrets (RUNPOD_POD_ID or RUNPOD_API_KEY) not configured.");
        return new Response(JSON.stringify({ error: 'Backend secrets not configured.' }), {
            status: 500,
            headers: corsHeadersWithContentType
        });
    }

    try {
        // Parse the JSON body from the frontend request.
        const requestBody = await request.json();
        const runpodUrl = HOST_TEMPLATE.replace("{podId}", podId) + CHAT_ENDPOINT;
        console.log(`WORKER_LOG: Proxying POST to ${runpodUrl}`);

        // Call the RunPod API.
        const runpodResponse = await fetch(runpodUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        // Get the response body as text to handle both success and error.
        const responseBodyText = await runpodResponse.text();
        console.log(`WORKER_LOG: RunPod Status: ${runpodResponse.status}`);
        // For deep debugging, uncomment the next line:
        // console.log(`WORKER_LOG: RunPod Raw Body: ${responseBodyText}`);

        // Handle non-successful responses from RunPod.
        if (!runpodResponse.ok) {
            console.error(`WORKER_ERROR: RunPod API Error. Status: ${runpodResponse.status}, Body: ${responseBodyText}`);
            return new Response(JSON.stringify({
                error: `RunPod API Error (${runpodResponse.status})`,
                details: responseBodyText
            }), {
                status: runpodResponse.status > 0 ? runpodResponse.status : 502, // Use RunPod status or 502
                headers: corsHeadersWithContentType
            });
        }

        // Handle successful but potentially empty or malformed responses.
        if (!responseBodyText) {
             console.error("WORKER_ERROR: RunPod returned 200 OK but empty body.");
             return new Response(JSON.stringify({ error: 'RunPod returned an empty successful response.' }), {
                status: 502, // Bad Gateway
                headers: corsHeadersWithContentType
            });
        }
        try {
            JSON.parse(responseBodyText); // Test if it's valid JSON.
            console.log("WORKER_LOG: RunPod response is valid JSON. Returning to client.");
            // If valid, send the original text (which is JSON) back to the client.
            return new Response(responseBodyText, {
                status: 200,
                headers: corsHeadersWithContentType
            });
        } catch (parseError) {
             console.error(`WORKER_ERROR: Failed to parse RunPod 200 OK response as JSON: ${parseError}. Body: ${responseBodyText}`);
             return new Response(JSON.stringify({ error: 'Received malformed JSON from RunPod.', details: responseBodyText.substring(0, 500) }), {
                status: 502, // Bad Gateway
                headers: corsHeadersWithContentType
            });
        }

    } catch (error) {
         console.error(`WORKER_CRITICAL_ERROR: Error during POST handling: ${error}`, error.stack);
         // Check if it's a JSON parsing error from the *incoming* request.
         if (error instanceof SyntaxError) {
             return new Response(JSON.stringify({ error: `Invalid JSON in request body: ${error.message}` }), {
                status: 400, // Bad Request
                headers: corsHeadersWithContentType
            });
         }
         // Return a generic 500 for other unexpected errors.
         return new Response(JSON.stringify({ error: `Internal Server Error: ${error.message}` }), {
            status: 500,
            headers: corsHeadersWithContentType
        });
    }
}

/**
 * Creates the necessary CORS headers for responses.
 * @param {string | null} origin - The request origin.
 * @returns {object} CORS headers.
 */
function createCorsHeaders(origin) {
    const headers = {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400", // Cache preflight for 1 day.
    };
    // Dynamically set Allow-Origin based on configuration.
    if (ALLOWED_ORIGINS.includes('*') || (origin && ALLOWED_ORIGINS.includes(origin))) {
        headers["Access-Control-Allow-Origin"] = origin || '*';
    } else if (ALLOWED_ORIGINS.length > 0) {
       headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGINS[0]; // Or don't set if origin not allowed.
    }
    return headers;
}

/**
 * Handles OPTIONS (preflight) requests by returning appropriate CORS headers.
 * @param {Request} request - The incoming request object.
 * @param {string | null} origin - The request origin.
 * @returns {Response} A 204 No Content response with CORS headers.
 */
function handleOptions(request, origin) {
    return new Response(null, {
        status: 204, // No Content - standard for successful preflights.
        headers: createCorsHeaders(origin)
    });
}