import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readOllamaSubstance, ollamaManifestPath, type LocalSubstance } from '../../lib/registry/substance';

// ---------------------------------------------------------------------------
// A real Ollama-layout models directory for tests: manifest + content-
// addressed config and weights blobs, exactly as `ollama pull` lays them out.
// Points SYNTHOS_OLLAMA_MODELS_DIR at it. Tiny "weights" — the verifier checks
// the content address and size, never the weights themselves.
// ---------------------------------------------------------------------------

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

export function ollamaModelsFixtureDir(): string {
  if (!process.env.SYNTHOS_OLLAMA_MODELS_DIR || !process.env.SYNTHOS_OLLAMA_MODELS_DIR.includes('synthos-ollama-fixture')) {
    process.env.SYNTHOS_OLLAMA_MODELS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'synthos-ollama-fixture-'));
  }
  return process.env.SYNTHOS_OLLAMA_MODELS_DIR;
}

export interface FixtureModel {
  weights?: string;
  format?: string;
  family?: string;
  parameterSize?: string;
  quantization?: string;
}

/** Write (or overwrite) a tag's manifest, config and weights; return its substance as the verifier reads it. */
export function writeOllamaModel(tag: string, m: FixtureModel = {}): LocalSubstance {
  const dir = ollamaModelsFixtureDir();
  fs.mkdirSync(path.join(dir, 'blobs'), { recursive: true });
  const weights = Buffer.from(m.weights ?? `weights-for-${tag}`);
  const cfg = Buffer.from(JSON.stringify({ model_format: m.format ?? 'gguf', model_family: m.family ?? 'qwen2', model_families: [m.family ?? 'qwen2'], model_type: m.parameterSize ?? '14.8B', file_type: m.quantization ?? 'Q4_K_M' }));
  const wd = `sha256:${sha(weights)}`; const cd = `sha256:${sha(cfg)}`;
  fs.writeFileSync(path.join(dir, 'blobs', wd.replace(':', '-')), weights);
  fs.writeFileSync(path.join(dir, 'blobs', cd.replace(':', '-')), cfg);
  const manifest = { schemaVersion: 2, mediaType: 'application/vnd.docker.distribution.manifest.v2+json', config: { mediaType: 'application/vnd.docker.container.image.v1+json', digest: cd, size: cfg.length }, layers: [{ mediaType: 'application/vnd.ollama.image.model', digest: wd, size: weights.length }] };
  const mp = ollamaManifestPath(tag, dir)!;
  fs.mkdirSync(path.dirname(mp), { recursive: true });
  fs.writeFileSync(mp, JSON.stringify(manifest));
  const r = readOllamaSubstance(tag, dir);
  if (!r.ok) throw new Error(`fixture unreadable: ${r.reason}`);
  return r.substance;
}

/** GET /api/tags body as Ollama answers it, from the models on disk. */
export function ollamaTagsBody(tags: string[]): string {
  const dir = ollamaModelsFixtureDir();
  return JSON.stringify({
    models: tags.map((t) => {
      const raw = fs.readFileSync(ollamaManifestPath(t, dir)!);
      return { name: t, model: t, digest: sha(raw) };
    }),
  });
}
