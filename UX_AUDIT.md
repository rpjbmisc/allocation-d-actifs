# Audit UX et feuille de route

## Contexte

Application React/Vite d'analyse historique multi-actifs et de construction d'allocations. L'interface actuelle possède une identité visuelle éditoriale cohérente, mais doit progresser sur la lisibilité, la compréhension des données, l'accessibilité et le parcours utilisateur.

Fichiers principaux :

- `src/App.tsx` : structure des écrans, contrôles, graphiques et tableaux.
- `src/styles.css` : système visuel et responsive.
- `src/analytics.ts` : calculs statistiques et portefeuille.
- `public/data/` : séries historiques et allocations candidates.

## Décisions prises

- Traiter une priorité par session pour limiter les régressions et la charge de contexte.
- Ne pas modifier les calculs métier pendant les chantiers purement visuels ou UX.
- Conserver l'identité actuelle plutôt que remplacer l'interface par un design générique.
- Vérifier `npm run build` à la fin de chaque session.
- Lire l'état du dépôt et le `git diff` au début de chaque nouvelle session.

## Diagnostic

### Lisibilité et hiérarchie

- Le hero est très imposant et repousse les contrôles utiles sous la ligne de flottaison.
- Beaucoup de textes secondaires sont trop petits, souvent entre 8 et 11 px.
- Plusieurs textes utilisent des couleurs peu contrastées (`#91a0aa`, `#a1adb4`, `#8797a1`).
- Les métriques financières (`TCAM`, `drawdown`, `Sharpe`) ne sont pas suffisamment expliquées.
- Le repère « A » dans le panneau de contrôle est décoratif et n'aide pas à comprendre l'action.

### Compréhension des données

- La comparaison par niveaux utilise des actifs dont les unités sont différentes sur un axe commun logarithmique.
- Le texte de la vue « Niveaux » peut laisser croire que chaque actif possède une échelle séparée.
- Les unités et le nombre d'observations ne sont pas toujours visibles au premier regard.
- La période commune peut se resserrer après la sélection d'un actif récent sans expliquer clairement pourquoi.
- Les observations de la matrice de corrélations ne sont visibles qu'au survol via `title`.

### Navigation et interactions

- La page `/correlations` et l'onglet intégré « Corrélations » ont des contextes différents mais des libellés proches.
- Les onglets et paramètres ne sont pas persistés dans l'URL.
- Le bouton « Exporter les données » de `ChartCard` est visible mais n'a aucune action.
- La normalisation du portefeuille peut produire un total calculé différent des poids saisis, ce qui doit être explicité.

### Accessibilité

- Les états sélectionnés reposent principalement sur la couleur et les classes CSS.
- Les onglets, modes, presets et sélecteurs d'actifs n'utilisent pas encore systématiquement `aria-selected` ou `aria-pressed`.
- Le switch masque l'input natif avec `display: none`.
- Aucun style global `:focus-visible` n'est défini.
- Les graphiques et la matrice de corrélations ont besoin d'une alternative textuelle ou tabulaire.
- Les tableaux devraient utiliser `caption` et `scope`.

### Responsive

- Les tableaux et la matrice nécessitent un défilement horizontal important sur mobile.
- Les premières colonnes ne restent pas visibles pendant le défilement.
- Les contrôles numériques sont petits pour une utilisation tactile.
- Les onglets défilent horizontalement sans signaler suffisamment cette possibilité.

## Feuille de route par sessions

### Session 1 - Lisibilité et hiérarchie

Périmètre : `src/styles.css` et libellés principaux de `src/App.tsx`.

- Réduire légèrement le hero.
- Augmenter la lisibilité et le contraste des textes secondaires.
- Clarifier les titres, sous-titres et cartes KPI.
- Ajouter des définitions courtes aux métriques techniques.
- Ajouter des états `focus-visible`, `hover` et `disabled` cohérents.

Critère de sortie : l'écran d'analyse est lisible sans zoom et la hiérarchie entre configuration, résultats et détails est immédiate.

### Session 2 - Parcours de configuration

Périmètre : contrôles de sélection dans `src/App.tsx` et styles associés.

- Structurer le parcours en « Actifs », « Période », « Lecture ».
- Ajouter un bouton de réinitialisation.
- Expliquer le changement automatique de période commune.
- Améliorer les états vides, erreurs et données indisponibles.

Critère de sortie : un nouvel utilisateur comprend quoi faire sans lire la documentation.

### Session 3 - Graphiques

Périmètre : vues `price`, `returns`, `growth`, `decades` et `ChartCard`.

- Faire de « 100 $ investis » la vue de comparaison principale.
- Clarifier les unités et le choix linéaire/logarithmique.
- Corriger le texte de la vue « Niveaux ».
- Ajouter une alternative tabulaire ou un résumé textuel.
- Implémenter l'export ou retirer le bouton inactif.

Critère de sortie : chaque graphique peut être interprété sans ambiguïté sur les unités, l'échelle et la période.

### Session 4 - Portefeuille

Périmètre : `PortfolioView` et styles associés.

- Ajouter des sliders en complément des champs numériques.
- Visualiser la répartition des poids.
- Distinguer poids saisis, poids normalisés et poids effectivement utilisés.
- Mettre en avant rendement, volatilité et drawdown maximal.

Critère de sortie : l'utilisateur comprend exactement quelle allocation est simulée.

### Session 5 - Corrélations et navigation

Périmètre : `CorrelationView`, navigation principale et onglets.

- Renommer les contextes en « Corrélations de la sélection » et « Matrice globale ».
- Afficher les observations directement dans la matrice.
- Ajouter les états sémantiques des onglets et de la navigation.
- Évaluer la persistance des paramètres dans l'URL.

Critère de sortie : les deux vues de corrélation sont clairement distinguées et partageables.

### Session 6 - Accessibilité et mobile

Périmètre : application complète, sans changement de logique métier.

- Corriger les rôles et attributs ARIA.
- Préserver la navigation clavier et le focus visible.
- Rendre les tableaux utilisables avec une colonne d'identification sticky.
- Augmenter les zones tactiles.
- Tester les largeurs 320, 390, 768 et desktop.

Critère de sortie : les parcours principaux sont utilisables au clavier et sur petit écran.

## Protocole de reprise

Au début d'une nouvelle session, utiliser ce message :

```text
Nous travaillons sur l'application située dans ce dépôt. Lis d'abord UX_AUDIT.md, puis vérifie git status et git diff. Traite uniquement la session indiquée ci-dessous, sans anticiper les suivantes. Préserve les calculs métier sauf nécessité explicite. Lance npm run build à la fin et résume les fichiers modifiés, les vérifications effectuées et les points restants.

Session à traiter : [indiquer le numéro et le titre]
```

## État initial de l'audit

- Audit réalisé avant toute modification UX.
- Aucun changement de code effectué dans le cadre de cet audit.
- Prochaine étape recommandée : Session 1 - Lisibilité et hiérarchie.
