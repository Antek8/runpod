// Cloudflare Worker for proxying to RunPod and handling CORS

// Define the RunPod host template and chat endpoint.
const HOST_TEMPLATE = "https://{podId}-11434.proxy.runpod.net";
const CHAT_ENDPOINT = "/api/chat";

// Replace '*' with your actual frontend origin(s) in production.
const ALLOWED_ORIGINS = ['https://runllm.pages.dev', '*'];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    console.log(`WORKER_LOG: Request received. Method: ${request.method}, Origin: ${origin}`);

    if (request.method === 'OPTIONS') {
      return handleOptions(request, origin);
    }

    if (request.method === 'POST') {
      return handlePost(request, env, origin);
    }

    // Method not allowed
    return new Response(JSON.stringify({ error: `Method ${request.method} Not Allowed` }), {
      status: 405,
      headers: {
        ...createCorsHeaders(origin),
        'Content-Type': 'application/json',
        'Allow': 'POST, OPTIONS'
      }
    });
  }
};

function createCorsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };

  if (ALLOWED_ORIGINS.includes('*') || (origin && ALLOWED_ORIGINS.includes(origin))) {
    headers["Access-Control-Allow-Origin"] = origin || "*";
  } else if (ALLOWED_ORIGINS.length > 0) {
    headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGINS[0]; // fallback
  }

  return headers;
}

function handleOptions(request, origin) {
  return new Response(null, {
    status: 204,
    headers: {
      ...createCorsHeaders(origin),
      "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "Content-Type"
    }
  });
}

async function handlePost(request, env, origin) {
  const corsHeaders = {
    ...createCorsHeaders(origin),
    "Content-Type": "application/json"
  };

  const podId = env.RUNPOD_POD_ID;
  const apiKey = env.RUNPOD_API_KEY;
  if (!podId || !apiKey) {
    return new Response(JSON.stringify({ error: "RunPod credentials not configured." }), {
      status: 500,
      headers: corsHeaders
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
        headers: corsHeaders
      });
    }

    try {
      JSON.parse(responseText); // Validate JSON
      return new Response(responseText, {
        status: 200,
        headers: corsHeaders
      });
    } catch {
      return new Response(JSON.stringify({
        error: "Malformed JSON from RunPod",
        details: responseText
      }), {
        status: 502,
        headers: corsHeaders
      });
    }

  } catch (error) {
    const isJsonError = error instanceof SyntaxError;
    return new Response(JSON.stringify({
      error: isJsonError ? "Invalid JSON in request" : "Internal Server Error",
      details: error.message
    }), {
      status: isJsonError ? 400 : 500,
      headers: corsHeaders
    });
  }
}
