import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createCors } from "https://deno.land/x/cors@v1.2.2/mod.ts";

const { cors, handleCors } = createCors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 100,
};

const rateLimitStore: Map<string, RateLimitEntry> = new Map();

function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime <= now) {
      rateLimitStore.delete(key);
    }
  }
}

function getRateLimitKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  return `rate_limit:${ip}`;
}

function checkRateLimit(request: Request): { allowed: boolean; remaining: number; resetIn: number } {
  cleanupExpiredEntries();
  
  const key = getRateLimitKey(request);
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  
  if (!entry || entry.resetTime <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + RATE_LIMIT_CONFIG.windowMs,
    });
    return { allowed: true, remaining: RATE_LIMIT_CONFIG.maxRequests - 1, resetIn: RATE_LIMIT_CONFIG.windowMs };
  }
  
  if (entry.count >= RATE_LIMIT_CONFIG.maxRequests) {
    return { allowed: false, remaining: 0, resetIn: entry.resetTime - now };
  }
  
  entry.count++;
  return { 
    allowed: true, 
    remaining: RATE_LIMIT_CONFIG.maxRequests - entry.count, 
    resetIn: entry.resetTime - now 
  };
}

interface ConversionRequest {
  input: string;
  inputFormat: "json" | "yaml";
  options?: {
    indentSize?: number;
    indentWithTabs?: boolean;
    sortKeys?: boolean;
    minify?: boolean;
  };
}

interface ConversionResponse {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: {
    inputLines: number;
    outputLines: number;
    inputSize: number;
    outputSize: number;
  };
}

function validateJson(input: string): { valid: boolean; error?: string } {
  try {
    JSON.parse(input);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
}

function validateYaml(input: string): { valid: boolean; error?: string } {
  try {
    const yaml = parseYaml(input);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Invalid YAML: ${(e as Error).message}` };
  }
}

function parseYaml(input: string): unknown {
  const lines = input.split("\n");
  const result: unknown = {};
  const stack: { obj: Record<string, unknown>; indent: number }[] = [{ obj: result as Record<string, unknown>, indent: -1 }];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    
    if (trimmed.startsWith("-")) {
      const value = trimmed.substring(1).trim();
      const current = stack[stack.length - 1];
      
      if (Array.isArray(current.obj)) {
        if (value.includes(":")) {
          const [key, ...valParts] = value.split(":");
          const nested: Record<string, unknown> = {};
          current.obj.push(nested);
          stack.push({ obj: nested, indent });
        } else {
          current.obj.push(value || "");
        }
      } else {
        if (value.includes(":")) {
          const [key, ...valParts] = value.split(":");
          const nested: Record<string, unknown> = {};
          const arr: unknown[] = [];
          nested[key.trim()] = arr;
          current.obj[key.trim()] = arr;
          stack.push({ obj: nested, indent });
        } else {
          current.obj[value] = "";
        }
      }
    } else if (trimmed.includes(":")) {
      const colonIndex = trimmed.indexOf(":");
      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();
      
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }
      
      const current = stack[stack.length - 1].obj;
      
      if (value) {
        current[key] = value.replace(/^["']|["']$/g, "");
      } else {
        current[key] = {};
        stack.push({ obj: current[key] as Record<string, unknown>, indent });
      }
    }
  }
  
  return Object.keys(result).length === 1 ? Object.values(result)[0] : result;
}

function stringifyYaml(data: unknown, indent: number = 0): string {
  const indentStr = "  ".repeat(indent);
  
  if (data === null || data === undefined) return "null\n";
  if (typeof data === "boolean") return String(data) + "\n";
  if (typeof data === "number") return String(data) + "\n";
  if (typeof data === "string") {
    if (data.includes("\n") || data.includes(":") || data.includes("#")) {
      return `"|\n${data.split("\n").map((l: string) => indentStr + "  " + l).join("\n")}\n`;
    }
    return data + "\n";
  }
  
  if (Array.isArray(data)) {
    if (data.length === 0) return "[]\n";
    return data.map((item) => {
      if (typeof item === "object" && item !== null) {
        const nested = stringifyYaml(item, indent + 1);
        return `${indentStr}- ${nested.substring(indentStr.length + 2)}`;
      }
      return `${indentStr}- ${stringifyYaml(item, indent + 1).trim()}`;
    }).join("");
  }
  
  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return "{}\n";
    return entries.map(([key, value]) => {
      const valueStr = stringifyYaml(value, indent + 1);
      if (valueStr.includes("\n") && !valueStr.startsWith("[")) {
        return `${indentStr}${key}:\n${valueStr}`;
      }
      return `${indentStr}${key}: ${valueStr.trim()}`;
    }).join("");
  }
  
  return String(data) + "\n";
}

function jsonToYaml(
  input: string,
  options: ConversionRequest["options"] = {}
): { output: string; metadata: ConversionResponse["metadata"] } {
  const data = JSON.parse(input);
  const indentSize = options.indentSize || 2;
  const yamlOutput = stringifyYaml(data);
  
  return {
    output: yamlOutput,
    metadata: {
      inputLines: input.split("\n").length,
      outputLines: yamlOutput.split("\n").length,
      inputSize: new TextEncoder().encode(input).length,
      outputSize: new TextEncoder().encode(yamlOutput).length,
    },
  };
}

function yamlToJson(
  input: string,
  options: ConversionRequest["options"] = {}
): { output: string; metadata: ConversionResponse["metadata"] } {
  const data = parseYaml(input);
  const indentSize = options.indentSize || 2;
  const indent = options.indentWithTabs ? "\t" : " ".repeat(indentSize);
  const minify = options.minify || false;
  const jsonOutput = minify ? JSON.stringify(data) : JSON.stringify(data, null, indent);
  
  return {
    output: jsonOutput,
    metadata: {
      inputLines: input.split("\n").length,
      outputLines: jsonOutput.split("\n").length,
      inputSize: new TextEncoder().encode(input).length,
      outputSize: new TextEncoder().encode(jsonOutput).length,
    },
  };
}

serve(async (req: Request): Promise<Response> => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  
  const rateLimitResult = checkRateLimit(req);
  
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "X-RateLimit-Limit": RATE_LIMIT_CONFIG.maxRequests.toString(),
        "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
        "X-RateLimit-Reset": (Date.now() + rateLimitResult.resetIn).toString(),
      },
    });
  }
  
  if (!rateLimitResult.allowed) {
    return new Response(JSON.stringify({
      success: false,
      error: "Too many requests. Please try again later.",
      retryAfter: Math.ceil(rateLimitResult.resetIn / 1000),
    }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Limit": RATE_LIMIT_CONFIG.maxRequests.toString(),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": (Date.now() + rateLimitResult.resetIn).toString(),
      },
    });
  }
  
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      success: false,
      error: "Method not allowed. Use POST.",
    }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  
  try {
    const body: ConversionRequest = await req.json();
    const { input, inputFormat, options } = body;
    
    if (!input || typeof input !== "string") {
      return new Response(JSON.stringify({
        success: false,
        error: "Input is required and must be a string.",
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    if (!input.trim()) {
      return new Response(JSON.stringify({
        success: false,
        error: "Input cannot be empty.",
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    if (inputFormat !== "json" && inputFormat !== "yaml") {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid inputFormat. Must be "json" or "yaml".',
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    let response: Response;
    
    if (inputFormat === "json") {
      const validation = validateJson(input);
      if (!validation.valid) {
        return new Response(JSON.stringify({ success: false, error: validation.error }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        });
      }
      const { output, metadata } = jsonToYaml(input, options);
      response = new Response(JSON.stringify({ success: true, output, metadata }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else {
      const validation = validateYaml(input);
      if (!validation.valid) {
        return new Response(JSON.stringify({ success: false, error: validation.error }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        });
      }
      const { output, metadata } = yamlToJson(input, options);
      response = new Response(JSON.stringify({ success: true, output, metadata }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    response.headers.set("X-RateLimit-Limit", RATE_LIMIT_CONFIG.maxRequests.toString());
    response.headers.set("X-RateLimit-Remaining", rateLimitResult.remaining.toString());
    response.headers.set("X-RateLimit-Reset", (Date.now() + rateLimitResult.resetIn).toString());
    
    return response;
  } catch (error) {
    console.error("Conversion error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: "Internal server error. Please try again.",
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
