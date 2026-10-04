// ═══════════════════════════════════════════════════════
// v9.20.0 (audit AUD-01-004) — LE RELAIS N'EST PLUS OUVERT À TOUS.
// Avant, n'importe quel script connaissant l'adresse (visible dans le code de
// la page) pouvait envoyer ses propres demandes à Gemini avec NOTRE clé :
// quota gratuit vidé par un tiers, coût non plafonné si la facturation était
// activée un jour. Les en-têtes CORS ne protègent que les navigateurs, pas
// un appel direct (curl, script). Désormais :
//   1. même clé de synchronisation que le Worker de synchro (secret SYNC_KEY
//      à créer aussi sur CE Worker) en en-tête Authorization: Bearer ;
//   2. taille du prompt et longueur de réponse bornées ;
//   3. si un navigateur annonce une origine (Origin), elle doit être celle de
//      l'application.
// Fail-closed : sans secret SYNC_KEY configuré ici, tout appel est refusé.
// ═══════════════════════════════════════════════════════
const MAX_PROMPT_CHARS = 30000;   // l'app envoie au plus ~5 000 caractères aujourd'hui
const MAX_BODY_BYTES = 120000;    // 30 000 caractères UTF-8 = au plus ~120 Ko
const MAX_OUTPUT_TOKENS = 4000;   // les appels de l'app demandent au plus 3 000
const DEFAULT_OUTPUT_TOKENS = 1000;
const ALLOWED_ORIGIN = 'https://plume-epique.pages.dev';

function isAllowedOrigin(origin) {
  if (!origin) return true; // appel hors navigateur : l'authentification fait foi
  if (origin === ALLOWED_ORIGIN) return true;
  // Déploiements de prévisualisation Cloudflare Pages de ce même projet.
  return /^https:\/\/[a-z0-9-]+\.plume-epique\.pages\.dev$/.test(origin);
}
// Comparaison à temps constant (évite de deviner la clé caractère par caractère).
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
function jsonError(status, message, headers) {
  return new Response(JSON.stringify({ error: { message } }), {
    status, headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

async function handleRequest(request, env) {
    const requestOrigin = request.headers.get('Origin');
    const corsHeaders = {
      'Access-Control-Allow-Origin': isAllowedOrigin(requestOrigin) && requestOrigin ? requestOrigin : ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }
    if (!isAllowedOrigin(requestOrigin)) {
      return jsonError(403, 'Origine non autorisée.', corsHeaders);
    }

    const auth = request.headers.get('Authorization') || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!env.SYNC_KEY || !provided || !timingSafeEqual(provided, env.SYNC_KEY)) {
      return jsonError(401, "Clé de synchronisation requise pour utiliser l'IA.", corsHeaders);
    }

    const declaredLength = Number(request.headers.get('Content-Length') || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return jsonError(413, 'Demande trop volumineuse.', corsHeaders);
    }

    try {
      // Correctif (27/07/2026) : ai.js envoie un champ nommé `maxTokens`
      // (camelCase) ; le Worker doit relire ce même nom (pas `max_tokens`,
      // c'est le nom attendu par le fournisseur d'IA plus bas qui compte).
      const bodyText = await request.text();
      if (bodyText.length > MAX_BODY_BYTES) {
        return jsonError(413, 'Demande trop volumineuse.', corsHeaders);
      }
      let parsed;
      try { parsed = JSON.parse(bodyText); } catch (e) { return jsonError(400, 'Corps JSON invalide.', corsHeaders); }
      const { prompt } = parsed;
      if (!prompt || typeof prompt !== 'string') {
        return jsonError(400, 'prompt manquant', corsHeaders);
      }
      if (prompt.length > MAX_PROMPT_CHARS) {
        return jsonError(413, `prompt trop long (maximum ${MAX_PROMPT_CHARS} caractères).`, corsHeaders);
      }
      const requested = Math.floor(Number(parsed.maxTokens));
      const maxTokens = Number.isFinite(requested) && requested > 0
        ? Math.min(requested, MAX_OUTPUT_TOKENS)
        : DEFAULT_OUTPUT_TOKENS;

      // Correctif (11/09/2026) : bascule de Mistral vers Gemini (Google AI).
      // Mistral (mistral-small-latest) a un quota gratuit de seulement
      // 20 000 tokens/minute — vite épuisé par les prompts avec contexte
      // (chapitre, personnages, historique de chat), d'où un 429 "Rate
      // limit exceeded" systématique. Gemini offre 1 000 000 tokens/minute
      // en gratuit (15 requêtes/minute, 1500/jour), largement suffisant
      // pour un usage humain normal de l'app.
      // Correctif (11/09/2026, bis) : gemini-2.5-flash n'est plus proposé
      // aux nouvelles clés API ("no longer available to new users") —
      // gemini-3.6-flash est le modèle recommandé en remplacement.
      const model = 'gemini-3.6-flash';
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            // Correctif (11/09/2026, quater puis quinquies) : le mode
            // "réflexion" de gemini-3.6-flash consomme une partie du budget
            // maxOutputTokens pour son raisonnement interne avant même de
            // produire la réponse visible — avec un budget serré (600
            // tokens pour "10 noms"), la réflexion épuisait presque tout,
            // ne laissant qu'un résultat tronqué. Première tentative avec
            // `thinkingBudget` (paramètre Gemini 2.5) → rejetée par le
            // modèle ("Request contains an invalid argument") : les
            // modèles Gemini 3.x utilisent `thinkingLevel` à la place, les
            // deux ne sont pas compatibles ensemble. "minimal" réduit la
            // réflexion au strict minimum (Plume n'en a pas besoin).
            generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingLevel: 'minimal' } },
          }),
        }
      );

      if (!resp.ok) {
        let message = `Erreur Gemini (${resp.status})`;
        try {
          const raw = await resp.json();
          if (raw.error?.message) {
            message = raw.error.message + (raw.error.status ? ` (${raw.error.status})` : '');
          }
        } catch (e) {}
        return new Response(JSON.stringify({ error: { message } }), {
          status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Gemini renvoie son propre format de flux SSE (candidates[0].content.
      // parts[0].text par morceau). ai.js (callClaude, voir js/ai.js) attend
      // le format OpenAI-compatible utilisé par l'ancien relais Mistral
      // (choices[0].delta.content) — plutôt que de modifier ai.js (et donc
      // risquer de casser le chat/résumé/reformulation existants), on
      // traduit ici le flux Gemini vers ce même format au fil de l'eau.
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = '';
      const translate = new TransformStream({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          // Dernière ligne potentiellement incomplète : gardée pour le prochain morceau.
          buffer = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload) continue;
            try {
              const parsed = JSON.parse(payload);
              // Correctif (11/09/2026, ter) : gemini-3.6-flash a un mode
              // "réflexion" activé par défaut — le modèle envoie d'abord des
              // morceaux de raisonnement interne (part.thought === true,
              // ex: "(Wait, ...)") AVANT le texte de réponse final. On ne
              // relaie que les morceaux qui ne sont pas marqués "thought",
              // sinon ce raisonnement s'affichait à la place du résultat.
              const parts = parsed.candidates?.[0]?.content?.parts || [];
              let text = '';
              for (const part of parts) {
                if (part.thought) continue;
                if (part.text) text += part.text;
              }
              if (text) {
                const out = JSON.stringify({ choices: [{ delta: { content: text } }] });
                controller.enqueue(encoder.encode(`data: ${out}\n\n`));
              }
            } catch (e) { /* morceau JSON non exploitable (rare, coupure réseau) : ignoré */ }
          }
        },
        flush(controller) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        }
      });

      return new Response(resp.body.pipeThrough(translate), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: { message: e.message } }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
}

// v9.29.0 (audit AUD-01-016) — journal : code de réponse et durée seulement, jamais le texte envoyé à l'IA.
function logEvent(evt) { try { console.log(JSON.stringify(evt)); } catch (e) { /* sans effet */ } }
export default {
  async fetch(request, env) {
    const t0 = Date.now();
    try {
      const res = await handleRequest(request, env);
      logEvent({ evt: 'ai', m: request.method, st: res.status, ms: Date.now() - t0 });
      return res;
    } catch (e) {
      logEvent({ evt: 'ai', m: request.method, st: 'exception', ms: Date.now() - t0, err: String((e && e.message) || e).slice(0, 120) });
      throw e;
    }
  }
};
