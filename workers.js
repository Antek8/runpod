// Cloudflare Worker for proxying to RunPod and handling dynamic CORS

// Define the RunPod host template and chat endpoint.
const HOST_TEMPLATE = "https://{podId}-11434.proxy.runpod.net";
const CHAT_ENDPOINT = "/api/chat";

// Define your primary production origin and the suffix for preview domains.
const PRODUCTION_ORIGIN = 'https://4palollo.workers.dev';
const PREVIEW_SUFFIX = '.runllm.pages.dev';

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    console.log(`WORKER_LOG: Request received. Method: ${request.method}, Origin: ${origin}`);

    // Determine CORS headers based on the dynamic origin
    const corsHeaders = createCorsHeaders(origin);

    // If the origin is not allowed, block the request early (except OPTIONS)
    if (!corsHeaders["Access-Control-Allow-Origin"] && request.method !== 'OPTIONS' && origin) {
        console.log(`WORKER_LOG: Denying request from disallowed origin: ${origin}`);
        return new Response(JSON.stringify({ error: "Forbidden - CORS Origin Not Allowed" }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (request.method === 'OPTIONS') {
      return handleOptions(request, corsHeaders);
    }

    if (request.method === 'POST') {
      return handlePost(request, env, corsHeaders);
    }

    // Method not allowed - return with potential CORS headers
    return new Response(JSON.stringify({ error: `Method ${request.method} Not Allowed` }), {
      status: 405,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Allow': 'POST, OPTIONS'
      }
    });
  }
};

/**
 * Creates CORS headers, dynamically setting ACAO based on origin.
 * @param {string | null} origin The 'Origin' header from the request.
 * @returns {Object} A dictionary of CORS headers.
 */
function createCorsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // Be specific if possible, or use '*' if many headers are needed.
    // Ensure this includes 'Content-Type' and any others (like 'Authorization').
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };

  // Check if the origin is either the production one or a *.runllm.pages.dev
  if (origin) {
      if (origin === PRODUCTION_ORIGIN || (origin.startsWith('https://') && origin.endsWith(PREVIEW_SUFFIX))) {
          // It's an allowed origin! Reflect it back.
          headers["Access-Control-Allow-Origin"] = origin;
      }
  }
  // If the origin doesn't match, we simply don't add the ACAO header.
  // The browser will then block the request (unless it's OPTIONS).

  return headers;
}

/**
 * Handles OPTIONS preflight requests.
 * @param {Request} request The incoming request.
 * @param {Object} corsHeaders The pre-calculated CORS headers.
 * @returns {Response} A response for the preflight request.
 */
function handleOptions(request, corsHeaders) {
    // If the origin wasn't allowed (no ACAO header), return an error.
    if (!corsHeaders["Access-Control-Allow-Origin"]) {
        return new Response('Not Allowed', { status: 403 });
    }

    // Respond to valid preflight requests.
    // It's good practice to reflect back the requested headers if possible/safe.
    return new Response(null, {
        status: 204, // 204 No Content is standard for preflights.
        headers: {
            ...corsHeaders,
            // Allow the specific headers the client asked for in the preflight.
            "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || corsHeaders["Access-Control-Allow-Headers"]
        }
    });
}

/**
 * Handles POST requests, proxying to RunPod.
 * @param {Request} request The incoming request.
 * @param {Object} env Environment variables (secrets).
 * @param {Object} baseCorsHeaders The base CORS headers.
 * @returns {Promise<Response>} The proxied response.
 */
async function handlePost(request, env, baseCorsHeaders) {
  // Ensure the final response has the necessary ACAO header
  const responseHeaders = {
    ...baseCorsHeaders,
    "Content-Type": "application/json"
  };

  const podId = env.RUNPOD_POD_ID;
  const apiKey = env.RUNPOD_API_KEY;

  if (!podId || !apiKey) {
    return new Response(JSON.stringify({ error: "RunPod credentials not configured." }), {
      status: 500,
      headers: responseHeaders
    });
  }

  try {
    const requestBody = await request.json();
    const runpodUrl = HOST_TEMPLATE.replace("{podId}", podId) + CHAT_ENDPOINT;

    const runpodResponse = await fetch(runpodUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await runpodResponse.text();

    if (!runpodResponse.ok) {
      return new Response(JSON.stringify({
        error: `RunPod API Error (${runpodResponse.status})`,
        details: responseText
      }), {
        status: runpodResponse.status || 502,
        headers: responseHeaders
      });
    }

    // Validate and return JSON
    try {
      JSON.parse(responseText); // Validate JSON
      return new Response(responseText, {
        status: 200,
        headers: responseHeaders
      });
    } catch (jsonError) {
      return new Response(JSON.stringify({
        error: "Malformed JSON from RunPod",
        details: responseText
      }), {
        status: 502,
        headers: responseHeaders
      });
    }

  } catch (error) {
    const isJsonError = error instanceof SyntaxError;
    return new Response(JSON.stringify({
      error: isJsonError ? "Invalid JSON in request" : "Internal Server Error",
      details: error.message
    }), {
      status: isJsonError ? 400 : 500,
      headers: responseHeaders
    });
  }
}