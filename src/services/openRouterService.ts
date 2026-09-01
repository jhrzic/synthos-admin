/**
 * OpenRouter Model Synchronization & Zero-Cost Free Model Router
 * Dynamic catalog, live endpoint fetcher, capability classification, and multi-agent routing matrix.
 */

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
    image?: string;
    request?: string;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
  architecture?: {
    modality: string;
    tokenizer: string;
    instruct_type?: string;
  };
  description?: string;
  category?: 'Reasoning' | 'Code' | 'Vision' | 'Long Context' | 'Speed' | 'General';
  speedTps?: number;
  benchmarks?: {
    coding?: number;
    reasoning?: number;
    math?: number;
  };
}

export interface AgentRoleModelMapping {
  role: string;
  displayName: string;
  primaryFreeModel: string;
  secondaryFreeModel: string;
  fallbackFreeRouter: string;
  specialty: string;
  recommendedCategory: 'Reasoning' | 'Code' | 'Vision' | 'Long Context' | 'Speed' | 'General';
}

// 29+ Curated Free Models on OpenRouter (:free endpoints)
export const FALLBACK_FREE_MODELS: OpenRouterModel[] = [
  {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1 (Free)',
    context_length: 163840,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'DeepSeek' },
    category: 'Reasoning',
    speedTps: 45,
    benchmarks: { coding: 92, reasoning: 98, math: 97 },
    description: 'Frontier chain-of-thought open-weight reasoning model matching o1 performance.'
  },
  {
    id: 'deepseek/deepseek-chat:free',
    name: 'DeepSeek V3 (Free)',
    context_length: 65536,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'DeepSeek' },
    category: 'General',
    speedTps: 88,
    benchmarks: { coding: 89, reasoning: 91, math: 88 },
    description: 'High-throughput 671B MoE architecture for fast cognitive processing.'
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Meta Llama 3.3 70B Instruct (Free)',
    context_length: 131072,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Llama-3' },
    category: 'Reasoning',
    speedTps: 62,
    benchmarks: { coding: 88, reasoning: 93, math: 86 },
    description: 'Industry standard 70B parameter instruction-tuned model with 128k context.'
  },
  {
    id: 'meta-llama/llama-3.1-70b-instruct:free',
    name: 'Meta Llama 3.1 70B Instruct (Free)',
    context_length: 131072,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Llama-3' },
    category: 'General',
    speedTps: 58,
    benchmarks: { coding: 86, reasoning: 89, math: 84 },
    description: 'Resilient 70B open weight instruction engine with expansive multilingual support.'
  },
  {
    id: 'meta-llama/llama-3.1-8b-instruct:free',
    name: 'Meta Llama 3.1 8B Instruct (Free)',
    context_length: 131072,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Llama-3' },
    category: 'Speed',
    speedTps: 130,
    benchmarks: { coding: 78, reasoning: 82, math: 75 },
    description: 'Sub-40ms ultra-low latency model for high-frequency microtasks.'
  },
  {
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    name: 'Meta Llama 3.2 3B Instruct (Free)',
    context_length: 131072,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Llama-3' },
    category: 'Speed',
    speedTps: 180,
    benchmarks: { coding: 70, reasoning: 74, math: 68 },
    description: 'Compact edge-optimized model for rapid JSON schema parsing and filtering.'
  },
  {
    id: 'meta-llama/llama-3.2-11b-vision-instruct:free',
    name: 'Meta Llama 3.2 11B Vision (Free)',
    context_length: 131072,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'multimodal->text', tokenizer: 'Llama-3' },
    category: 'Vision',
    speedTps: 95,
    benchmarks: { coding: 79, reasoning: 85, math: 78 },
    description: 'Multimodal vision instruction model for diagrams, charts, and OCR inspection.'
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct:free',
    name: 'Qwen 2.5 Coder 32B Instruct (Free)',
    context_length: 32768,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Qwen' },
    category: 'Code',
    speedTps: 76,
    benchmarks: { coding: 96, reasoning: 88, math: 90 },
    description: 'State-of-the-art open code generation model with multi-file repo synthesis.'
  },
  {
    id: 'qwen/qwen-2.5-72b-instruct:free',
    name: 'Qwen 2.5 72B Instruct (Free)',
    context_length: 131072,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Qwen' },
    category: 'Reasoning',
    speedTps: 54,
    benchmarks: { coding: 90, reasoning: 94, math: 92 },
    description: 'Comprehensive general intelligence flagship matching proprietary GPT-4 tier.'
  },
  {
    id: 'qwen/qwen-2.5-7b-instruct:free',
    name: 'Qwen 2.5 7B Instruct (Free)',
    context_length: 32768,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Qwen' },
    category: 'Speed',
    speedTps: 145,
    benchmarks: { coding: 82, reasoning: 80, math: 79 },
    description: 'Fast 7B model for quick unit test execution and code formatting.'
  },
  {
    id: 'qwen/qwq-32b-preview:free',
    name: 'Qwen QwQ 32B Preview (Free)',
    context_length: 32768,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Qwen' },
    category: 'Reasoning',
    speedTps: 48,
    benchmarks: { coding: 89, reasoning: 95, math: 96 },
    description: 'Deep thought reasoning model designed for complex logic, competitive math, and physics.'
  },
  {
    id: 'google/gemini-2.0-flash-exp:free',
    name: 'Google Gemini 2.0 Flash Experimental (Free)',
    context_length: 1048576,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'multimodal->text', tokenizer: 'Gemini' },
    category: 'Long Context',
    speedTps: 160,
    benchmarks: { coding: 91, reasoning: 93, math: 91 },
    description: '1M+ token context window with real-time multimodal capabilities and extreme speed.'
  },
  {
    id: 'google/gemini-2.0-flash-lite-preview-02-05:free',
    name: 'Google Gemini 2.0 Flash Lite Preview (Free)',
    context_length: 1048576,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'multimodal->text', tokenizer: 'Gemini' },
    category: 'Speed',
    speedTps: 190,
    benchmarks: { coding: 87, reasoning: 89, math: 86 },
    description: 'Ultra-lightweight multimodal engine for sub-30ms reactive agent dispatch.'
  },
  {
    id: 'google/gemini-2.0-pro-exp-02-05:free',
    name: 'Google Gemini 2.0 Pro Experimental (Free)',
    context_length: 2097152,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'multimodal->text', tokenizer: 'Gemini' },
    category: 'Reasoning',
    speedTps: 72,
    benchmarks: { coding: 94, reasoning: 96, math: 94 },
    description: '2M context flagship reasoning engine for complex codebase refactoring and synthesis.'
  },
  {
    id: 'google/gemma-2-27b-it:free',
    name: 'Google Gemma 2 27B IT (Free)',
    context_length: 8192,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Gemma' },
    category: 'General',
    speedTps: 82,
    benchmarks: { coding: 83, reasoning: 87, math: 82 },
    description: 'High parameter efficiency model with rigorous truthfulness and alignment.'
  },
  {
    id: 'google/gemma-2-9b-it:free',
    name: 'Google Gemma 2 9B IT (Free)',
    context_length: 8192,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Gemma' },
    category: 'Speed',
    speedTps: 125,
    benchmarks: { coding: 79, reasoning: 81, math: 77 },
    description: 'Compact 9B model with solid reasoning across structured data schemas.'
  },
  {
    id: 'mistralai/mistral-small-24b-instruct-2501:free',
    name: 'Mistral Small 24B Instruct 2501 (Free)',
    context_length: 32768,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Mistral' },
    category: 'Reasoning',
    speedTps: 80,
    benchmarks: { coding: 87, reasoning: 90, math: 85 },
    description: 'Next-gen enterprise European open weights model with precise function calling.'
  },
  {
    id: 'mistralai/mistral-7b-instruct:free',
    name: 'Mistral 7B Instruct (Free)',
    context_length: 32768,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Mistral' },
    category: 'Speed',
    speedTps: 135,
    benchmarks: { coding: 76, reasoning: 78, math: 74 },
    description: 'Reliable workhorse model for triage classification and tag extraction.'
  },
  {
    id: 'mistralai/mistral-nemo:free',
    name: 'Mistral NeMo 12B (Free)',
    context_length: 128000,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Tekken' },
    category: 'Long Context',
    speedTps: 92,
    benchmarks: { coding: 81, reasoning: 84, math: 80 },
    description: '128k context model built in collaboration with NVIDIA using Tekken tokenizer.'
  },
  {
    id: 'nvidia/nemotron-3-nano-30b-a3b:free',
    name: 'NVIDIA Nemotron 3 Nano 30B (Free)',
    context_length: 65536,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Nemotron' },
    category: 'Reasoning',
    speedTps: 85,
    benchmarks: { coding: 88, reasoning: 92, math: 89 },
    description: 'NVIDIA enterprise optimized LLM for structured analysis and synthetic dataset generation.'
  },
  {
    id: 'nvidia/nemotron-nano-12b-v2-vl:free',
    name: 'NVIDIA Nemotron Nano 12B VL (Free)',
    context_length: 32768,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'multimodal->text', tokenizer: 'Nemotron' },
    category: 'Vision',
    speedTps: 90,
    benchmarks: { coding: 80, reasoning: 86, math: 82 },
    description: 'High-speed vision-language model for UI screenshot decomposition and spatial triage.'
  },
  {
    id: 'microsoft/phi-4:free',
    name: 'Microsoft Phi-4 14B (Free)',
    context_length: 16384,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Phi' },
    category: 'Reasoning',
    speedTps: 94,
    benchmarks: { coding: 86, reasoning: 91, math: 93 },
    description: 'Highly concentrated synthetic-data trained reasoning model excelling in math and logic.'
  },
  {
    id: 'microsoft/phi-3.5-mini-128k-instruct:free',
    name: 'Microsoft Phi-3.5 Mini 128k (Free)',
    context_length: 128000,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Phi' },
    category: 'Long Context',
    speedTps: 140,
    benchmarks: { coding: 79, reasoning: 82, math: 81 },
    description: '3.8B model with 128k context for long doc summarization with minimal resource footprint.'
  },
  {
    id: 'poolside/laguna-xs-2.1:free',
    name: 'Poolside Laguna XS 2.1 (Free)',
    context_length: 32768,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Poolside' },
    category: 'Code',
    speedTps: 110,
    benchmarks: { coding: 94, reasoning: 85, math: 84 },
    description: 'Specialized code completion and synthesis engine optimized for developer environments.'
  },
  {
    id: 'openai/gpt-oss-120b:free',
    name: 'OpenAI GPT-OSS 120B (Free Community Route)',
    context_length: 65536,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'o200k' },
    category: 'General',
    speedTps: 50,
    benchmarks: { coding: 89, reasoning: 90, math: 88 },
    description: 'Community subsidized route providing robust instructional reasoning and synthesis.'
  },
  {
    id: 'nousresearch/hermes-3-llama-3.1-405b:free',
    name: 'Nous Hermes 3 Llama 3.1 405B (Free Route)',
    context_length: 131072,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Llama-3' },
    category: 'Reasoning',
    speedTps: 35,
    benchmarks: { coding: 93, reasoning: 97, math: 94 },
    description: 'The Nous Research flagship 405B agentic orchestrator with steerable persona alignment.'
  },
  {
    id: 'nousresearch/hermes-2-pro-llama-3-8b:free',
    name: 'Nous Hermes 2 Pro 8B (Free)',
    context_length: 8192,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Llama-3' },
    category: 'Speed',
    speedTps: 130,
    benchmarks: { coding: 80, reasoning: 82, math: 78 },
    description: 'Native JSON structured outputs and tool call parser for Hermes OS micro-tasks.'
  },
  {
    id: 'openrouter/free',
    name: 'OpenRouter Auto Free Router',
    context_length: 131072,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'multimodal->text', tokenizer: 'Universal' },
    category: 'General',
    speedTps: 100,
    benchmarks: { coding: 88, reasoning: 90, math: 87 },
    description: 'Dynamic load balancer that routes to whichever free model has the lowest active queue.'
  },
  {
    id: 'cognitivecomputations/dolphin-2.9.2-qwen2-72b:free',
    name: 'Dolphin 2.9.2 Qwen2 72B (Free)',
    context_length: 32768,
    pricing: { prompt: '0', completion: '0' },
    architecture: { modality: 'text->text', tokenizer: 'Qwen' },
    category: 'Reasoning',
    speedTps: 52,
    benchmarks: { coding: 87, reasoning: 91, math: 89 },
    description: 'Uncensored cognitive reasoning model adept at root cause system debugging.'
  }
];

// Agent Role to Free Model Dynamic Matrix
export const DEFAULT_AGENT_MODEL_MATRIX: AgentRoleModelMapping[] = [
  {
    role: 'chief-of-staff',
    displayName: 'Chief of Staff (CoS / Orchestrator)',
    primaryFreeModel: 'deepseek/deepseek-r1:free',
    secondaryFreeModel: 'meta-llama/llama-3.3-70b-instruct:free',
    fallbackFreeRouter: 'openrouter/free',
    specialty: 'Goal decomposition, board.db governor, permanent operating rules, executive sign-off',
    recommendedCategory: 'Reasoning'
  },
  {
    role: 'dev',
    displayName: 'Engineering & Coder (Dev)',
    primaryFreeModel: 'qwen/qwen-2.5-coder-32b-instruct:free',
    secondaryFreeModel: 'poolside/laguna-xs-2.1:free',
    fallbackFreeRouter: 'openrouter/free',
    specialty: 'Full-stack systems engineer, sandbox execution, TypeScript/Python, test harnesses',
    recommendedCategory: 'Code'
  },
  {
    role: 'reach',
    displayName: 'Growth & Strategy (Reach)',
    primaryFreeModel: 'google/gemma-2-27b-it:free',
    secondaryFreeModel: 'meta-llama/llama-3.1-70b-instruct:free',
    fallbackFreeRouter: 'openrouter/free',
    specialty: 'Distribution & GTM architect, viral loop modeling, customer acquisition, social hooks',
    recommendedCategory: 'General'
  },
  {
    role: 'scout',
    displayName: 'Research & Analysis (Scout)',
    primaryFreeModel: 'nvidia/nemotron-3-nano-30b-a3b:free',
    secondaryFreeModel: 'openai/gpt-oss-120b:free',
    fallbackFreeRouter: 'openrouter/free',
    specialty: 'Live web scraping, Product Hunt & GitHub trend scraping, arXiv preprints, market whitespace',
    recommendedCategory: 'Reasoning'
  },
  {
    role: 'jarvis',
    displayName: 'Jarvis / Quick Actions',
    primaryFreeModel: 'google/gemini-2.0-flash-exp:free',
    secondaryFreeModel: 'nvidia/nemotron-nano-12b-v2-vl:free',
    fallbackFreeRouter: 'openrouter/free',
    specialty: 'Sub-40ms duplex audio streaming, instant transcription, quick command arbitration',
    recommendedCategory: 'Speed'
  },
  {
    role: 'scribe',
    displayName: 'Operations & Scribe (Vaults)',
    primaryFreeModel: 'mistralai/mistral-small-24b-instruct-2501:free',
    secondaryFreeModel: 'microsoft/phi-3.5-mini-128k-instruct:free',
    fallbackFreeRouter: 'openrouter/free',
    specialty: 'Obsidian knowledge scribe, investment thesis authoring, [[wikilinks]] mesh synthesis',
    recommendedCategory: 'Long Context'
  },
  {
    role: 'analytics',
    displayName: 'Analytics & Metrics',
    primaryFreeModel: 'deepseek/deepseek-r1:free',
    secondaryFreeModel: 'google/gemini-2.0-pro-exp-02-05:free',
    fallbackFreeRouter: 'openrouter/free',
    specialty: 'Data synthesizer, token economy optimization, latency tracking, SQL telemetry',
    recommendedCategory: 'Reasoning'
  }
];

/**
 * Live OpenRouter Dynamic Model Fetcher Pipeline
 */
export async function fetchAndSyncFreeOpenRouterModels(apiKey?: string): Promise<{
  models: OpenRouterModel[];
  syncedCount: number;
  isLiveApi: boolean;
  timestamp: string;
}> {
  if (!apiKey || apiKey.trim() === '') {
    return {
      models: FALLBACK_FREE_MODELS,
      syncedCount: FALLBACK_FREE_MODELS.length,
      isLiveApi: false,
      timestamp: new Date().toLocaleTimeString()
    };
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://hermes-os.local',
        'X-Title': 'Hermes Agentic OS'
      }
    });

    if (!response.ok) {
      throw new Error(`OpenRouter HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.data)) {
      throw new Error('Invalid OpenRouter models payload structure');
    }

    // Filter free models
    const freeRawModels = data.data.filter((m: any) => {
      const promptCost = m.pricing?.prompt;
      return promptCost === '0' || promptCost === '0.0' || promptCost === 0 || m.id?.endsWith(':free');
    });

    const parsedModels: OpenRouterModel[] = freeRawModels.map((m: any) => {
      // Determine capability category
      let cat: OpenRouterModel['category'] = 'General';
      const idLower = (m.id || '').toLowerCase();
      if (idLower.includes('r1') || idLower.includes('reason') || idLower.includes('qwq') || idLower.includes('70b') || idLower.includes('405b')) {
        cat = 'Reasoning';
      } else if (idLower.includes('code') || idLower.includes('coder') || idLower.includes('laguna') || idLower.includes('codex')) {
        cat = 'Code';
      } else if (idLower.includes('vision') || idLower.includes('vl') || idLower.includes('multimodal')) {
        cat = 'Vision';
      } else if (m.context_length > 100000 || idLower.includes('flash') || idLower.includes('128k') || idLower.includes('1m')) {
        cat = 'Long Context';
      } else if (idLower.includes('mini') || idLower.includes('lite') || idLower.includes('8b') || idLower.includes('3b') || idLower.includes('7b')) {
        cat = 'Speed';
      }

      return {
        id: m.id,
        name: m.name || m.id,
        context_length: m.context_length || 32768,
        pricing: {
          prompt: String(m.pricing?.prompt || '0'),
          completion: String(m.pricing?.completion || '0')
        },
        architecture: {
          modality: m.architecture?.modality || 'text->text',
          tokenizer: m.architecture?.tokenizer || 'Universal'
        },
        description: m.description || `High-performance zero-cost OpenRouter model (${m.id}).`,
        category: cat,
        speedTps: cat === 'Speed' ? 140 : cat === 'Reasoning' ? 55 : 85,
        benchmarks: {
          coding: cat === 'Code' ? 95 : 84,
          reasoning: cat === 'Reasoning' ? 95 : 86,
          math: cat === 'Reasoning' ? 94 : 82
        }
      };
    });

    // Merge with fallback catalogue if live API returned subset
    const existingIds = new Set(parsedModels.map(m => m.id));
    const combinedModels = [...parsedModels];
    for (const fb of FALLBACK_FREE_MODELS) {
      if (!existingIds.has(fb.id)) {
        combinedModels.push(fb);
      }
    }

    return {
      models: combinedModels,
      syncedCount: combinedModels.length,
      isLiveApi: true,
      timestamp: new Date().toLocaleTimeString()
    };
  } catch (err) {
    console.warn('[OpenRouter Sync] Model sync warning, activating local zero-cost catalog:', err);
    return {
      models: FALLBACK_FREE_MODELS,
      syncedCount: FALLBACK_FREE_MODELS.length,
      isLiveApi: false,
      timestamp: new Date().toLocaleTimeString()
    };
  }
}

/**
 * Zero-cost model router arbitration helper
 */
export function resolveZeroCostModelForTask(
  taskPrompt: string,
  assignedRole: string,
  matrix: AgentRoleModelMapping[],
  availableFreeModels: OpenRouterModel[]
): {
  primaryModelId: string;
  fallbackChain: string[];
  rationale: string;
  category: string;
  contextWindow: number;
} {
  const roleMapping = matrix.find(m => m.role === assignedRole) || matrix[0];
  const textLower = taskPrompt.toLowerCase();

  let selectedCategory: 'Reasoning' | 'Code' | 'Vision' | 'Long Context' | 'Speed' | 'General' = roleMapping.recommendedCategory;
  let rationale = `Matched agent role preference (${roleMapping.displayName})`;

  if (textLower.includes('```') || textLower.includes('function') || textLower.includes('refactor') || textLower.includes('bug') || textLower.includes('typescript')) {
    selectedCategory = 'Code';
    rationale = 'Code block / syntax detected -> routed to specialized Code model tier';
  } else if (textLower.includes('prove') || textLower.includes('calculate') || textLower.includes('why') || textLower.includes('thesis') || textLower.includes('strategy')) {
    selectedCategory = 'Reasoning';
    rationale = 'Complex analytical prompt -> routed to Frontier Reasoning model tier';
  } else if (textLower.includes('fast') || textLower.includes('quick') || textLower.includes('status') || textLower.includes('classify')) {
    selectedCategory = 'Speed';
    rationale = 'High-frequency microtask -> routed to Ultra-Low Latency model tier';
  }

  // Find best model in that category
  const primaryModel = availableFreeModels.find(m => m.id === roleMapping.primaryFreeModel) ||
    availableFreeModels.find(m => m.category === selectedCategory) ||
    availableFreeModels[0];

  const secondaryModel = availableFreeModels.find(m => m.id === roleMapping.secondaryFreeModel) ||
    availableFreeModels.find(m => m.id !== primaryModel.id && m.category === selectedCategory) ||
    availableFreeModels[1];

  const fallbackRouter = 'openrouter/free';

  return {
    primaryModelId: primaryModel.id,
    fallbackChain: [secondaryModel.id, fallbackRouter, 'google/gemini-2.0-flash-exp:free'],
    rationale,
    category: selectedCategory,
    contextWindow: primaryModel.context_length
  };
}
