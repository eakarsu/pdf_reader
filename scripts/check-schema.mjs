import { readFileSync } from 'node:fs';

const schemaUrl = new URL('../schema/pdf-reader-output.schema.json', import.meta.url);
const schema = JSON.parse(readFileSync(schemaUrl, 'utf8'));

if (
  schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' ||
  schema.$id !== 'urn:local-pdf-reader:output:1.0.0' ||
  schema.properties?.schema_version?.const !== '1.0.0'
) {
  throw new Error('The output schema identity does not match version 1.0.0.');
}

console.log('Output schema 1.0.0 parsed and passed identity checks.');
