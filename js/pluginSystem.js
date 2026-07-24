'use strict';
const PLUGINS_REGISTRY = [
  {
    id: 'languagetool',
    name: '🔤 LanguageTool',
    description: 'Correction grammaticale et orthographique (API gratuite).',
    remote: true,
    run: async (text) => {
      if (!text || text.length < 10) return 'Pas de texte à analyser.';
      try {
        const params = new URLSearchParams({ text: text.substring(0, 1500), language: 'fr' });
        const resp = await fetch('https://api.languagetool.org/v2/check', { method:'POST', body:params });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data.matches.length) return '✅ Aucune erreur détectée.';
        return data.matches.slice(0,8).map(m =>
          `• <strong>${DOMPurify.sanitize(m.context.text.substring(m.context.offset,m.context.offset+m.context.length)||'?')}</strong>: ${DOMPurify.sanitize(m.message)}${m.replacements.length?' → '+DOMPurify.sanitize(m.replacements.slice(0,2).map(r=>r.value).join(', ')):''}`
        ).join('<br>');
      } catch(e) { return '❌ Erreur API: '+e.message; }
    }
  },
  {
    id: 'readingtime',
    name: '⏱️ Temps de lecture',
    description: 'Estime le temps de lecture du roman entier.',
    run: async () => {
      const totalW = db.chapters.reduce((s,c)=>s+getWordCount(c.content),0);
      const minSlow=Math.ceil(totalW/150), minFast=Math.ceil(totalW/250);
      return `📖 <strong>${totalW} mots</strong><br>Lecture lente (~150 mpm) : <strong>${Math.floor(minSlow/60)}h${minSlow%60}min</strong><br>Lecture rapide (~250 mpm) : <strong>${Math.floor(minFast/60)}h${minFast%60}min</strong>`;
    }
  },
  {
    id: 'repetitions',
    name: '🔁 Détecteur de répétitions',
    description: 'Trouve les mots répétés dans un rayon de 5 phrases.',
    run: async () => {
      flushCurrentChapter();
      const text = getPlainText(db.chapters[cur].content);
      const sentences = text.split(/[.!?]+/).filter(s=>s.trim().length>5);
      const issues = [];
      sentences.forEach((sent, i) => {
        const window5 = sentences.slice(Math.max(0,i-4),i+1).join(' ');
        const words = sent.toLowerCase().match(/[a-zA-ZÀ-ÿ]{4,}/g)||[];
        words.forEach(w => {
          if (STOP_WORDS.has(w)) return;
          const count = (window5.toLowerCase().match(new RegExp(`\\b${w}\\b`,'g'))||[]).length;
          if (count>=3) issues.push(`"${DOMPurify.sanitize(w)}" (×${count} dans 5 phrases)`);
        });
      });
      const unique = [...new Set(issues)].slice(0,10);
      return unique.length ? unique.join('<br>') : '✅ Aucune répétition problématique détectée.';
    }
  },
  {
    id: 'synopsis',
    name: '📝 Générateur de synopsis',
    description: 'Génère un synopsis complet via l\'IA.',
    remote: true,
    run: async () => {
      flushCurrentChapter();
      const summaries = db.chapters.map((c,i)=>`Ch.${i+1} ${c.title}: ${c.summary||getPlainText(c.content).substring(0,200)}`).join('\n');
      return await callClaude(`Génère un synopsis littéraire professionnel de 3 paragraphes en français, à partir de ces chapitres:\n${summaries.substring(0,3000)}`, 600);
    }
  }
];

function renderPlugins() {
  const grid = document.getElementById('plugins-grid');
  grid.innerHTML = '';
  PLUGINS_REGISTRY.forEach(plugin => {
    const card = document.createElement('div'); card.className='plugin-card';
    const enabled = db.plugins[plugin.id] !== false;
    card.innerHTML = `
      <h4>${plugin.name}
        <label class="plugin-toggle u-ml-auto">
          <input type="checkbox" ${enabled?'checked':''} data-plugin="${plugin.id}">
          <span class="plugin-slider"></span>
        </label>
      </h4>
      <div class="u-fs-_74rem u-op-_7">${plugin.description}</div>`;
    const runBtn = document.createElement('button'); runBtn.className='action-btn btn-sm'; runBtn.textContent='▶ Exécuter';
    const resultDiv = document.createElement('div'); resultDiv.className='plugin-result';
    runBtn.addEventListener('click', async () => {
      if (!enabled) { toast('Plugin désactivé','error'); return; }
      if (plugin.remote) await notifyThirdPartyDataUseOnce();
      resultDiv.innerHTML = '<div class="ai-loader"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div></div>';
      resultDiv.classList.add('active');
      try {
        const text = getPlainText(db.chapters[cur].content);
        const result = await plugin.run(text);
        const asHtml = result && result.replace ? result.replace(/\n/g,'<br>') : String(result);
        // Correction (audit) : les autres plugins passent déjà leur texte par
        // DOMPurify avant de le renvoyer, mais le plugin "Générateur de
        // synopsis" renvoyait la réponse IA brute. Sanitisation systématique
        // ici, une fois pour tous les plugins présents et futurs — défense
        // en profondeur, au cas où une réponse IA contiendrait du HTML.
        resultDiv.innerHTML = DOMPurify.sanitize(asHtml);
      } catch(e) { resultDiv.innerHTML = `<span class="u-c-v-danger">❌ ${e.message}</span>`; }
    });
    card.querySelector(`input[data-plugin="${plugin.id}"]`).addEventListener('change', e => {
      db.plugins[plugin.id] = e.target.checked; debouncedSave();
    });
    card.appendChild(runBtn); card.appendChild(resultDiv);
    grid.appendChild(card);
  });
}
