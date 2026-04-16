import { VercelRequest, VercelResponse } from '@vercel/node';
import Cors from 'cors';

const corsMiddleware = Cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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

function getRateLimitKey(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' 
    ? forwarded.split(',')[0].trim() 
    : req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown';
  return `rate_limit:${ip}`;
}

function checkRateLimit(req: VercelRequest): { allowed: boolean; remaining: number; resetIn: number } {
  cleanupExpiredEntries();
  
  const key = getRateLimitKey(req);
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

function setRateLimitHeaders(
  res: VercelResponse,
  remaining: number,
  resetIn: number
): void {
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_CONFIG.maxRequests.toString());
  res.setHeader('X-RateLimit-Remaining', remaining.toString());
  res.setHeader('X-RateLimit-Reset', (Date.now() + resetIn).toString());
}

interface ConversionRequest {
  input: string;
  inputFormat: 'json' | 'yaml';
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

function runMiddleware(req: VercelRequest, res: VercelResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    corsMiddleware(req, res, (result: Error | void) => {
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve();
      }
    });
  });
}

function validateJson(input: string): { valid: boolean; error?: string } {
  try {
    JSON.parse(input);
    return { valid: true };
  } catch (e) {
    const error = e as SyntaxError;
    return { valid: false, error: `Invalid JSON: ${error.message}` };
  }
}

function validateYaml(input: string): { valid: boolean; error?: string } {
  try {
    const yaml = require('js-yaml');
    yaml.load(input);
    return { valid: true };
  } catch (e) {
    const error = e as Error;
    return { valid: false, error: `Invalid YAML: ${error.message}` };
  }
}

function jsonToYaml(
  input: string,
  options: ConversionRequest['options'] = {}
): { output: string; metadata: ConversionResponse['metadata'] } {
  const yaml = require('js-yaml');
  
  const data = JSON.parse(input);
  const indentSize = options.indentSize || 2;
  const sortKeys = options.sortKeys || false;

  const yamlOutput = yaml.dump(data, {
    indent: indentSize,
    lineWidth: -1,
    noRefs: true,
    sortKeys,
  });

  return {
    output: yamlOutput,
    metadata: {
      inputLines: input.split('\n').length,
      outputLines: yamlOutput.split('\n').length,
      inputSize: Buffer.byteLength(input, 'utf8'),
      outputSize: Buffer.byteLength(yamlOutput, 'utf8'),
    },
  };
}

function yamlToJson(
  input: string,
  options: ConversionRequest['options'] = {}
): { output: string; metadata: ConversionResponse['metadata'] } {
  const yaml = require('js-yaml');

  const data = yaml.load(input);
  const indentSize = options.indentSize || 2;
  const indent = options.indentWithTabs ? '\t' : ' '.repeat(indentSize);
  const minify = options.minify || false;

  const jsonOutput = minify
    ? JSON.stringify(data)
    : JSON.stringify(data, null, indent);

  return {
    output: jsonOutput,
    metadata: {
      inputLines: input.split('\n').length,
      outputLines: jsonOutput.split('\n').length,
      inputSize: Buffer.byteLength(input, 'utf8'),
      outputSize: Buffer.byteLength(jsonOutput, 'utf8'),
    },
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  try {
    await runMiddleware(req, res);

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    const rateLimitResult = checkRateLimit(req);
    setRateLimitHeaders(res, rateLimitResult.remaining, rateLimitResult.resetIn);

    if (!rateLimitResult.allowed) {
      res.status(429).json({
        success: false,
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil(rateLimitResult.resetIn / 1000),
      } as ConversionResponse & { retryAfter: number });
      return;
    }

    if (req.method !== 'POST') {
      const response: ConversionResponse = {
        success: false,
        error: 'Method not allowed. Use POST.',
      };
      res.status(405).json(response);
      return;
    }

    const { input, inputFormat, options } = req.body as ConversionRequest;

    if (!input || typeof input !== 'string') {
      const response: ConversionResponse = {
        success: false,
        error: 'Input is required and must be a string.',
      };
      res.status(400).json(response);
      return;
    }

    if (!input.trim()) {
      const response: ConversionResponse = {
        success: false,
        error: 'Input cannot be empty.',
      };
      res.status(400).json(response);
      return;
    }

    if (inputFormat !== 'json' && inputFormat !== 'yaml') {
      const response: ConversionResponse = {
        success: false,
        error: 'Invalid inputFormat. Must be "json" or "yaml".',
      };
      res.status(400).json(response);
      return;
    }

    if (inputFormat === 'json') {
      const validation = validateJson(input);
      if (!validation.valid) {
        const response: ConversionResponse = {
          success: false,
          error: validation.error,
        };
        res.status(422).json(response);
        return;
      }

      const { output, metadata } = jsonToYaml(input, options);
      const response: ConversionResponse = {
        success: true,
        output,
        metadata,
      };
      res.status(200).json(response);
    } else {
      const validation = validateYaml(input);
      if (!validation.valid) {
        const response: ConversionResponse = {
          success: false,
          error: validation.error,
        };
        res.status(422).json(response);
        return;
      }

      const { output, metadata } = yamlToJson(input, options);
      const response: ConversionResponse = {
        success: true,
        output,
        metadata,
      };
      res.status(200).json(response);
    }
  } catch (error) {
    console.error('Conversion error:', error);
    const response: ConversionResponse = {
      success: false,
      error: 'Internal server error. Please try again.',
    };
    res.status(500).json(response);
  }
}
