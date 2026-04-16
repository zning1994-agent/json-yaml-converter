#!/bin/bash

echo "Deploying JSON-YAML Converter API to Deno Deploy..."

if ! command -v deployctl &> /dev/null; then
    echo "Installing deployctl..."
    deno install -A -r https://deno.land/x/deploy/deployctl.ts
fi

deployctl deploy \
    --project=json-yaml-converter \
    --include=api/ \
    api/deploy.ts

echo "Deployment complete!"
