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
      // Correctif (dette repérée le 27/07/2026) : ai.js envoie un champ nommé
      // `maxTokens` (camelCase) ; ce Worker lisait jusqu'ici `max_tokens`
      // (snake_case) — un nom différent, donc toujours `undefined` côté
      // Worker, qui retombait systématiquement sur le plafond par défaut de
      // 1000, quelle que soit la valeur réellement demandée par chaque
      // fonction IA (600 à 800 selon les cas). Mistral, lui, attend bien
      // `max_tokens` (snake_case) dans SA propre requête — seul le nom lu
      // depuis le corps envoyé par ai.js change ici, pas celui envoyé à Mistral.
      const { prompt, maxTokens } = await request.json();
      if (!prompt) {
        return new Response(JSON.stringify({ error: { message: 'prompt manquant' } }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // v8.0.3 — Affichage progressif : on demande désormais à Mistral une
      // réponse en flux (Server-Sent Events, `stream:true`), et on relaie ce
      // flux tel quel au navigateur (voir ai.js, callClaude()) au lieu
      // d'attendre la réponse complète avant de répondre. Le texte apparaît
      // ainsi mot par mot côté utilisateur, plutôt que d'un bloc à la fin.
      const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'mistral-large-latest',
          max_tokens: maxTokens || 1000,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        }),
      });

      if (!resp.ok) {
        // Erreur : pas de flux à relayer, on lit le corps normalement (comme avant).
        let message = `Erreur Mistral (${resp.status})`;
        try { const data = await resp.json(); if (data.message) message = data.message; } catch(e) {}
        return new Response(JSON.stringify({ error: { message } }), {
          status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Succès : on relaie le flux SSE de Mistral tel quel — ai.js sait
      // désormais le lire directement (format standard `data: {...}\n\n`,
      // `delta.content` à chaque morceau, `data: [DONE]` à la fin).
      return new Response(resp.body, {
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
