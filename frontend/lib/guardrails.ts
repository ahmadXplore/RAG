/**
 * Frontend Input Guardrail client.
 * Provides instant feedback before network submission for known jailbreak patterns.
 */

const JAILBREAK_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|rules?|prompts?)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|rules?|prompts?)/i,
  /forget\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|rules?|prompts?)/i,
  /override\s+(the\s+)?(system\s+)?(prompt|rules?|instructions?)/i,
  /\b(DAN\s+mode|do\s+anything\s+now|developer\s+mode\s+enabled|enable\s+developer\s+mode)\b/i,
  /\b(jailbreak|jailbroken|unrestricted\s+mode|no\s+restrictions?\s+mode)\b/i,
  /bypass\s+(all\s+)?(safety|restrictions?|filters?|guidelines?|policies?)/i,
  /you\s+are\s+now\s+(an?\s+)?(unrestricted|unfiltered|rogue|evil|uncensored)\s+(ai|assistant|model|bot)/i,
  /(reveal|print|output|show|repeat)\s+(your\s+)?(exact\s+)?(system\s+prompt|hidden\s+instructions?|internal\s+instructions?|system\s+instructions?)/i,
  /what\s+(is|are)\s+your\s+(exact\s+)?(system\s+prompt|internal\s+instructions?|system\s+instructions?)/i,
  /(?:\b|^)(format\s+c:|rm\s+-rf(\s+[\/~]|\s*$)|drop\s+table\s+users|union\s+select\s+.*\s+from)/i,
];

export function validatePrompt(input: string): { safe: boolean; error?: string } {
  if (!input || typeof input !== "string") return { safe: true };

  const trimmed = input.trim();
  for (const pattern of JAILBREAK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        safe: false,
        error:
          "Input blocked by security guardrails: prompt contains prohibited jailbreak or prompt manipulation keywords.",
      };
    }
  }

  return { safe: true };
}
