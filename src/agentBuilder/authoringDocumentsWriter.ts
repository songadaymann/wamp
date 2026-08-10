import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderAuthoringDocuments } from './authoringCatalog';

export function writeAuthoringDocuments(outputDirectory: string): void {
  mkdirSync(outputDirectory, { recursive: true });
  for (const [filename, contents] of Object.entries(renderAuthoringDocuments())) {
    writeFileSync(resolve(outputDirectory, filename), contents, 'utf8');
  }
}
