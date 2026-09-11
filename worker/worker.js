export default {
  async fetch(request, env) {
    const allowedOrigin = 'https://plume-epique.pages.dev';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    try {
      // Correctif (27/07/2026) : ai.js envoie un champ nommé `maxTokens`
      // (camelCase) ; le Worker doit relire ce même nom (pas `max_tokens`,
      // c'est le nom attendu par le fournisseur d'IA plus bas qui compte).
      const { prompt, maxTokens } = await request.json();
      if (!prompt) {
        return new Response(JSON.stringify({ error: { message: 'prompt manquant' } }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

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
            generationConfig: { maxOutputTokens: maxTokens || 1000 },
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
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
};
