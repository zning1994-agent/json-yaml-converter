import { VercelRequest, VercelResponse } from '@vercel/node';
import Cors from 'cors';

const corsMiddleware = Cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

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
