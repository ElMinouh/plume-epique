// Projet d'exemple (v9.95.0, AUD-10-011). Module ESM chargé À LA DEMANDE depuis « Nouveau projet » (règle d'architecture AUD-09-011 :
// un nouveau module n'est jamais un script classique de plus). Il ne fait que construire des données : la création du projet reste dans
// library.js (createNewTextDocument), donc le projet d'exemple est un projet comme un autre (corbeille 30 jours, exports, synchro).
// Texte original, écrit pour l'occasion. Il contient volontairement de quoi essayer les outils : mots faibles (« très », « juste »),
// un mot répété, une remarque de relecture, des fiches et une intrigue.

export const TITRE_EXEMPLE = "Projet d'exemple — La lettre de Léa";

export function buildExample(genId, today) {
  const ch = [genId(), genId(), genId()];
  const p = t => '<p>' + t + '</p>';
  return {
    title: TITRE_EXEMPLE,
    projectType: 'contemporain',
    wordGoal: 3000,
    chapters: [
      { id: ch[0], title: 'La lettre', tension: 25, summary: 'Léa trouve une lettre sans signature dans la boîte du village.', status: 'draft', tags: [], wordGoal: 600,
        researchNotes: "PROJET D'EXEMPLE — à essayer : « Outils → Analyser le style » surligne les mots faibles ; le mode Lecture (Outils) permet de noter un passage ; « Notes » du chapitre 2 montre une remarque et les passes de relecture. Supprimez ce projet quand vous voulez (bibliothèque → corbeille).",
        content: p("Léa trouva la lettre un matin de novembre, glissée sous le grillage de la boîte aux lettres. L'enveloppe était très ancienne, le papier juste assez jaune pour qu'on le devine fragile.") +
          p("Elle la retourna deux fois. Aucun nom, aucune adresse, seulement une écriture penchée qu'elle crut reconnaître sans savoir d'où.") },
      { id: ch[1], title: 'Le village', tension: 45, summary: 'Léa interroge Armand sur la lettre et le village se referme.', status: 'review', tags: [], wordGoal: 600, researchNotes: '',
        content: p("Au village, tout le monde avait déjà tout vu. Léa marcha lentement vers la place, lentement vers le café, lentement vers la maison d'Armand.") +
          p("— Cette lettre, dit-elle, vous savez qui l'a écrite ?") +
          p("Armand posa sa tasse très doucement. Il regarda par la fenêtre, comme si la réponse se trouvait dehors.") +
          p("— Rentre chez toi, Léa. Certaines choses sont juste faites pour rester dans leur enveloppe."),
        remarks: [{ id: 'rexemple01', q: 'lentement vers la place', n: 'Le mot « lentement » revient trois fois : varier ou couper ?', done: false, at: today }],
        passes: { structure: today, continuite: null, style: null, langue: null } },
      { id: ch[2], title: 'Le retour', tension: 70, summary: 'À la gare, Léa reconnaît enfin l\'écriture.', status: 'draft', tags: [], wordGoal: 600, researchNotes: '',
        content: p("Elle ne comprit qu'à la gare, en voyant le nom griffonné sur un billet oublié. La même écriture penchée, les mêmes boucles.") +
          p("Le train arriva. Léa resta sur le quai, la lettre contre sa poitrine, et décida de ne pas partir.") }
    ],
    chars: [
      { id: genId(), name: 'Léa Marchand', role: 'Héroïne', age: '29', phys: 'Brune, le regard attentif', info: "Revenue vivre au village après dix ans de ville. Curieuse, têtue." },
      { id: genId(), name: 'Armand', role: 'Voisin', age: '74', phys: 'Voûté, mains tachées de peinture', info: "Ancien facteur du village. Il connaît tous les secrets et n'en dit aucun." }
    ],
    places: [
      { id: genId(), name: 'Saint-Aubin', info: 'Village de 300 habitants, une place, un café, une gare qui ne sert presque plus.' },
      { id: genId(), name: 'La gare', info: "Un quai, un banc, un train par jour. C'est là que tout se dénoue." }
    ],
    quests: [
      { id: genId(), text: 'Qui a écrit la lettre ?', done: false, reward: 'Comprendre pourquoi Léa est revenue', steps: "1. Trouver la lettre\n2. Interroger Armand\n3. Reconnaître l'écriture" }
    ],
    weakWords: ['juste', 'très', 'lentement']
  };
}
