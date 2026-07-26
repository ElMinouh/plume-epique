// Worker Cloudflare de synchronisation multi-appareils — Plume Épique (v7.22.0)
//
// Rôle : stocker/renvoyer des blobs opaques (déjà chiffrés côté client) par
// clé, pour que plusieurs appareils partagent le même profil et les mêmes
// manuscrits. Ce Worker ne déchiffre jamais rien et ne voit jamais de
// contenu en clair — il se contente de faire lire/écrire une base KV.
//
// ─────────────────────────────────────────────────────────────────────────
// DÉPLOIEMENT (à faire une seule fois, dans le dashboard Cloudflare) :
//   1. Workers & Pages → Create → Create Worker. Collez ce fichier comme code.
//   2. Storage & Databases → KV → créez un namespace (ex. "plume-sync").
//   3. Dans les paramètres de CE Worker → Bindings → ajoutez ce namespace KV
//      sous le nom exact "PLUME_SYNC" (obligatoire, c'est ce nom que le code
//      utilise ci-dessous).
//   4. Dans les paramètres de CE Worker → Variables and Secrets → ajoutez un
//      secret nommé "SYNC_KEY" : c'est VOUS qui choisissez sa valeur (une
//      phrase longue et unique, ex. générée par un gestionnaire de mots de
//      passe). C'est LA clé à taper une fois sur chaque appareil.
//   5. Notez l'URL du Worker (ex. https://plume-epique-sync.VOTRE-SOUS-DOMAINE.workers.dev)
//      et reportez-la à 2 endroits dans le projet principal :
//        - js/router.js, constante SYNC_WORKER_URL
//        - _headers, dans connect-src
// ─────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // Authentification : une seule clé partagée pour tout le foyer/compte,
    // choisie par vous à l'étape 4 ci-dessus — jamais le mot de passe d'un
    // profil individuel.
    const auth = request.headers.get('Authorization') || '';
    const providedKey = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!providedKey || providedKey !== env.SYNC_KEY) {
      return new Response(JSON.stringify({ error: { message: 'Clé de synchronisation invalide.' } }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    if (!key) {
      return new Response(JSON.stringify({ error: { message: 'Paramètre "key" manquant.' } }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Clé technique réservée, utilisée uniquement par le bouton "Vérifier"
    // de l'app (ne lit ni n'écrit rien de réel — sert juste à confirmer que
    // la clé fournie est acceptée).
    if (key === '__ping__') {
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (request.method === 'GET') {
      const value = await env.PLUME_SYNC.get(key);
      // `null` (chaîne JSON) si cette clé n'a encore jamais été synchronisée
      // par aucun appareil — l'app le traite comme "pas encore de donnée ici".
      return new Response(value ?? 'null', { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      const body = await request.text();
      await env.PLUME_SYNC.put(key, body);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: { message: 'Méthode non supportée.' } }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
};
