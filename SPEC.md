# JSON-YAML Converter - Technical Specification

## 1. Product Definition

### Problem

Developers and data engineers frequently need to convert data between JSON and YAML formats. Existing online tools are cluttered with ads, lack API access, or require server-side processing which introduces latency and privacy concerns for sensitive data.

### Solution

A lightweight, privacy-focused web application that performs JSON-to-YAML and YAML-to-JSON conversion entirely in the browser. The tool provides both an intuitive graphical interface for manual conversion and a REST API accessible via HTTP requests for programmatic use.

### Target Users

- Software developers working with configuration files
- DevOps engineers managing deployment manifests
- Data engineers exchanging data between systems
- Technical writers documenting APIs and configurations
- Students learning data serialization formats

---

## 2. MVP Scope

### Included in MVP

- JSON to YAML conversion with proper formatting
- YAML to JSON conversion with proper formatting
- Syntax validation with clear error messages
- Copy to clipboard functionality
- Download converted result as file
- Clear/reset functionality
- Responsive design for desktop and mobile
- REST API endpoint for external conversions
- Error handling for invalid input
- Rate limiting on API endpoint

### Excluded from MVP

- Batch file conversion
- Conversion history
- User accounts/authentication
- Custom indentation settings (advanced)
- Dark/light theme toggle
- File upload (drag-and-drop)
- Cloud storage/sync

---

## 3. Technical Design

### Tech Stack

**Frontend:**
- Framework: Vanilla JavaScript (ES6+) with Vue 3
- Styling: Tailwind CSS via CDN
- JSON Parsing: Native JSON.parse/stringify
- YAML Parsing: js-yaml library (client-side CDN)
- Build: None required (single HTML file deployment)

**API Service:**
- Runtime: Deno Deploy
- Language: TypeScript
- Purpose: Enable external API calls that bypass CORS restrictions

**Deployment:**
- Frontend: GitHub Pages
- API: Deno Deploy

### File Structure

```
json-yaml-converter/
├── index.html              # Main SPA with Vue 3 and Tailwind CSS
├── api/
│   ├── convert.ts          # Vercel Edge Function handler
│   ├── deploy.ts           # Deno Deploy handler
│   └── package.json        # API dependencies
├── deno.json               # Deno configuration
├── deploy.sh               # Deno Deploy deployment script
├── tsconfig.json           # TypeScript configuration
├── SPEC.md                 # This specification
├── README.md               # English documentation
├── README_CN.md            # Chinese documentation
└── .gitignore              # Git ignore rules
```

### File Responsibilities

**index.html**
- Single-page application with Vue 3 reactive framework
- Two editor panels: JSON and YAML with line numbers
- Conversion buttons for both directions
- Settings panel for customization options
- Utility buttons: copy, download, swap, clear
- Error and success toast notifications
- Responsive layout for desktop and mobile
- Client-side validation and error display

**api/convert.ts**
- Vercel Edge Function handler
- CORS headers for cross-origin requests
- Input validation (JSON and YAML syntax checking)
- JSON to YAML and YAML to JSON conversion
- Rate limiting (100 requests per minute per IP)
- Metadata generation (line counts, sizes)

**api/deploy.ts**
- Deno Deploy serverless function
- Same functionality as convert.ts for Deno runtime
- Native Deno HTTP server API

---

## 4. API Design

### Endpoint

```
POST /api/convert
```

### Request Body

```json
{
  "input": "{ \"name\": \"example\", \"version\": \"1.0.0\" }",
  "inputFormat": "json",
  "options": {
    "indentSize": 2,
    "sortKeys": false,
    "minify": false
  }
}
```

### Response (Success)

```json
{
  "success": true,
  "output": "name: example\nversion: \"1.0.0\"\n",
  "metadata": {
    "inputLines": 1,
    "outputLines": 2,
    "inputSize": 42,
    "outputSize": 28
  }
}
```

### Response (Error)

```json
{
  "success": false,
  "error": "Invalid JSON: Unexpected token at position 15"
}
```

### Rate Limiting Headers

- `X-RateLimit-Limit`: Maximum requests per window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Timestamp when the window resets

### Error Codes

| Status | Description |
|--------|-------------|
| 200 | Success |
| 400 | Bad Request (invalid input) |
| 405 | Method Not Allowed |
| 422 | Unprocessable Entity (invalid syntax) |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

---

## 5. Deployment Strategy

### Frontend (GitHub Pages)

1. Push code to GitHub repository
2. Enable GitHub Pages in repository settings
3. Select `main` branch as source
4. Access at: `https://username.github.io/json-yaml-converter/`

### API (Deno Deploy)

1. Install `deployctl`: `deno install -A -r https://deno.land/x/deploy/deployctl.ts`
2. Run deployment: `deno task deploy` or `./deploy.sh`
3. API endpoint: `https://project-name.deno.dev/api/convert`

### API (Vercel)

1. Import project to Vercel
2. Configure build command (if needed)
3. Deploy automatically on push to main branch
4. API endpoint: `https://project.vercel.app/api/convert`

---

## 6. Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| indentSize | number | 2 | Spaces per indentation level |
| indentWithTabs | boolean | false | Use tabs instead of spaces |
| sortKeys | boolean | false | Sort object keys alphabetically |
| minify | boolean | false | Minify JSON output |
| arrayInlineLimit | number | 2 | Max array items before wrapping |
| trimLines | boolean | false | Remove trailing whitespace |
| validateYaml | boolean | true | Enable YAML syntax validation |
