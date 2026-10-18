# Architecture — Allocation d'actifs

> **Document technique vivant** · État des lieux au 18 octobre 2026, basé sur le code `main` examiné en phase 0.
>
> Les sections « **Existant** » décrivent le code actuel. Les sections « **Cible** » sont des propositions de refactoring, **pas des fonctionnalités déjà implémentées**.
>
> Voir [ROADMAP.md](./ROADMAP.md) pour les décisions validées, le séquencement, la recette et les consignes de passage de relais.

## 1. Objectif architectural

Séparer de manière vérifiable :
1. les **données historiques** et leur qualité ;
2. les **calculs financiers purs** (rendements, volatilité, drawdown, corrélations…) ;
3. les **contraintes de portefeuille** ;
4. les **stratégies d'optimisation** (Croissance, Robustesse, Objectif patrimonial) ;
5. la **validation chronologique** (walk-forward) ;
6. les **hypothèses prospectives et scénarios** ;
7. l'**interface**, qui orchestre ces modules sans recalculer indépendamment la logique métier.

Objectifs secondaires : reproductibilité, testabilité, performance acceptable dans le navigateur, explicitation des limitations statistiques.

## 2. Existant constaté dans le dépôt

| Élément | Rôle actuel |
|---|---|
| `src/App.tsx` | Application React, chargement CSV/JSON, sélection, contrôles, onglets, simulations et affichage du portefeuille. |
| `src/analytics.ts` | Normalisation et conversion, statistiques, simulation d'allocations, matrice de corrélations et recherche d'allocations par grille. |
| `src/styles.css` | Styles de l'interface. |
| `public/data/assets_index.json` | Registre des séries d'actifs disponibles avec bornes temporelles. |
| `public/data/CAGR_*.csv` | Séries annuelles (`Year,Series_Level,Annual_Return_Pct`). |
| `public/data/asset_currency_metadata.json` | Devise source, nature du rendement (prix/NTR/TR), avertissements de qualité. |
| `public/data/candidate_presets.json` | Allocations candidates **statiques**, choisies précédemment hors chargement. |
| `public/data/fx_*.csv` et `french_cpi_*.csv` | Conversion USD/EUR et inflation française. |
| `package.json` | React, TypeScript, Vite, Recharts, PapaParse, Lucide ; scripts dev/build/preview, **pas encore de test**. |
| `.github/workflows/deploy-pages.yml` | Déploiement de l'application par GitHub Actions. |

### Fonctionnement financier actuel à préserver/clarifier

- L'application lit les rendements **annuels** ; la première année d'une série est typiquement une valeur initiale sans rendement.
- Conversion actuelle de l'USD vers l'EUR : rendement de l'actif en USD combiné au rendement USD/EUR non couvert. Rendement réel : correction de l'inflation française.
- `computePortfolio` calcule une moyenne **arithmétique pondérée des rendements annuels** (pondérations cibles réappliquées annuellement) puis compose les années ; il suppose donc un **rééquilibrage annuel**.
- CAGR = croissance géométrique annualisée des valeurs composées ; volatilité = écart-type des rendements annuels ; drawdown = retrait depuis un plus-haut **de fin d'année** (sans creux intra-annuels).
- `sharpe` actuel = moyenne arithmétique brute des rendements / volatilité : ce n'est **pas** un ratio de Sharpe conventionnel déduction faite du taux sans risque.
- `computeDiversificationMetrics` calcule : (a) moyenne pondérée des corrélations **avec diagonale incluse** ; (b) ratio de diversification = somme pondérée des volatilités / volatilité du portefeuille.
- `searchPortfolioOptimizationProfiles` teste des combinaisons de poids sur grille et maximise le CAGR sous drawdown historique annuel de 40 %. Deux variantes imposent des seuils arbitraires de corrélation pondérée et diversification ratio.
- Dans `App.tsx`, la grille est adaptative : **pas de 5 points** pour petites sélections, **10** à partir de 5 actifs et **20** à partir de 7 actifs. Ce n'est donc pas un optimum continu garanti.
- Les profils candidats historiques stockés dans `candidate_presets.json` ne sont pas forcément recalculés sur la période courante ; ne pas les confondre avec les nouveaux optimiseurs.
- Les rendements sont calculés en USD ou EUR, nominaux ou réels, selon les contrôles existants.
- Sélection maximale actuelle dans l'application principale : **10 actifs**.

### Risques techniques/statistiques identifiés

1. **Années manquantes** : `computePortfolio` fait l'intersection des années valides ; des années non contiguës peuvent être composées comme si elles se suivaient, gonflant le CAGR annualisé. Exiger la continuité des séries dans la période testée ou exposer explicitement une règle alternative.
2. **Corrélations par paire** : deux séries peuvent être corrélées sur des années différentes d'une troisième. Pour construire une matrice de covariance exploitable et positive semi-définie, choisir une fenêtre commune et vérifier la cohérence ; pour un diagnostic paire par paire, afficher les observations.
3. **Corrélation moyenne pondérée** : la diagonale augmente artificiellement l'indicateur dit « entre actifs » ; exclure les paires identiques **seulement pour le diagnostic entre actifs**, jamais pour la variance du portefeuille.
4. **Concentration de risques** : posséder MSCI World et S&P 500 peut concentrer l'exposition aux grandes capitalisations américaines. Les poids individuels ne suffisent pas.
5. **Optimisation historique** : haut risque de surajustement ; période, univers et paramètres ne doivent pas être sélectionnés en regardant les résultats hors échantillon.
6. **Séries hétérogènes** : certaines séries sont en prix, d'autres TR/NTR. Le S&P 500 NTR comporte un proxy estimé avant 2015 (voir métadonnées) ; ce niveau de qualité doit apparaître dans l'interprétation.
7. **Mesure du risque annuel** : une forte baisse intra-annuelle peut être invisible avec les seules valeurs de clôture annuelle ; ne jamais nommer l'indicateur « pire perte réellement subie » sans précision.
8. **Rendement attendu** : ne jamais assimiler le CAGR in-sample à une prévision future certaine.
9. **Sélection des paramètres** : optimiser l'algorithme après lecture des fenêtres de test crée une fuite méthodologique, même si le code n'utilise pas directement les années futures.

## 3. Architecture cible proposée (évolutive, sans big bang)

Les noms de dossiers sont **indicatifs**, à adapter à l'implémentation et aux conventions de l'application.

```text
src/
  App.tsx                         # orchestration React, progressivement allégée
  analytics.ts                   # façade de compatibilité le temps de la migration
  domain/
    types.ts                     # types partagés : actifs, années, configuration
    data.ts                      # validité, alignement, transformations des séries
    returns.ts                   # inflation, devises, rendements
    portfolio.ts                 # trajectoire et rééquilibrage
    metrics.ts                   # CAGR, volatilité, drawdown, diversification
    constraints.ts               # vérification / raisons d'infaisabilité
  optimization/
    interface.ts                 # stratégie, entrées, contraintes, sortie
    growth.ts                    # maximisation CAGR
    robust.ts                    # optimisation robustesse (phase 4)
    goal.ts                      # objectif patrimonial (phase 5)
    search.ts                    # solveur/grille ou alternative, testable
  validation/
    walkForward.ts               # découpes temporelles, exécution OOS, baselines
  scenarios/
    generator.ts                 # scénarios conjoints, graine, hypothèses
    assumptions.ts               # paramètres de croissance/inflation/incertitude
  data/
    exposures.ts                 # métadonnées économiques horodatées (phase 6)
  components/
    portfolio/                   # Construction, Comparaison, Validation
  tests/                         # tests unitaires et fixtures synthétiques
public/data/                    # séries et métadonnées existantes conservées
docs/
  ROADMAP.md
  ARCHITECTURE.md
```

Règle : les modules financiers n'importent **ni React, ni composants graphiques, ni accès réseau**. L'UI peut importer le domaine, jamais l'inverse.

Migrer progressivement et préserver si nécessaire les exports existants via une façade temporaire `src/analytics.ts` ; ne pas casser l'application pendant le refactoring.

## 4. Contrats métier cibles

### 4.1 Entrées / sorties communes

Proposition conceptuelle (pas un contrat TypeScript déjà écrit) :

```typescript
type StrategyId = "growth" | "robust" | "goal";

interface AllocationInput {
  assetIds: string[];
  annualReturns: Record<string, Map<number, number>>;
  currency: "eur" | "usd";
  returnMode: "nominal" | "real";
  trainStart: number;
  trainEnd: number;
  rebalancing: "annual";
}

interface PortfolioConstraints {
  longOnly: true;
  minWeight: number;              // en fraction, ex. 0
  maxWeightByAsset?: Record<string, number>;
  maxAnnualCloseDrawdownPct?: number;
  maxAnnualVolatilityPct?: number;
  // Phase 6 : limites d'exposition économique validées par données sourcées.
}

interface OptimizationResult {
  strategy: StrategyId;
  weights: Record<string, number>; // fractions normalisées, somme ~1
  feasible: boolean;
  diagnostics: string[];           // exceptions, faible profondeur, hypothèses
  // score, modèle, métadonnées, paramètres et preuves seront versionnés
}
```

**Décision de cadrage** : appliquer les mêmes contraintes communes aux trois méthodes dans le comparateur ; les paramètres spécifiques de chaque stratégie sont additionnels, jamais cachés.

### 4.2 Invariants comptables et temporels

- Pondérations finies et non négatives ; somme égale à 1 à tolérance flottante connue, sans levier ni vente à découvert en V1.
- Rendements en **fractions ou pourcentages**, convention unique **documentée dans le module** ; ne pas mélanger les unités. CSV existants en %.
- Période de simulation = années d'observation du rendement effectivement complètes et **contiguës** ; refuser/signer des données insuffisantes, sans annualiser artificiellement des trous.
- Une année initiale avec niveau d'indice mais sans rendement n'est pas une année de performance à zéro.
- CAGR calculé sur **N rendements annuels réellement observés**, pas sur N+1 niveaux ni la durée calendaire comprimée.
- Pour un portefeuille à poids cibles annuels : rendement annuel = somme des poids cibles × rendements de l'année ; valorisation par produit `(1+r_t)`.
- Éviter de composer des rendements réels directement après un double comptage de l'inflation ; contrôler la cohérence nominal/réel à tous les étages.
- Définir les conventions de coûts/frais/fiscalité et les exposer ; en V1, indiquer explicitement **non pris en compte** si absents.
- Toute simulation aléatoire doit recevoir une **graine** pour être reproductible.

### 4.3 Statistiques de diversification et risque

Conserver :
- Corrélations de Pearson annuelles (avec nombre d'observations et avertissements).
- Ratio de diversification : `sum(w_i * sigma_i) / sigma_portefeuille` calculé sur le même échantillon de rendements.
- Moyenne de corrélation pondérée **hors diagonale** seulement en tant que diagnostic, avec normalisation par la somme `w_i*w_j` des paires distinctes effectivement valides.
- Contribution au risque de chaque actif et indicateurs globaux dérivés, mais sans les substituer aux pertes historiques et au CAGR.
- Drawdown historique de clôture annuelle, pire année, volatilité annuelle ; métriques sans suffisamment d'observations = « n.d. ».
- Sharpe : le calcul existant doit être renommé « rendement brut / volatilité » **ou** remplacé par Sharpe excédentaire avec rendement sans risque cohérent à la devise et à la période. Éviter un faux libellé.

À ne pas faire : créer une « note universelle de diversification » ou des catégories normatives uniquement à partir de corrélations/ratios arbitraires.

## 5. Architecture des trois stratégies

### Croissance — `growth`

- **Phase 2** : objectif = maximiser le CAGR historique **sur la fenêtre d'apprentissage uniquement**, sous contraintes paramétrables.
- Période de test exclue de la recherche. Évaluer systématiquement face aux références.
- Utiliser ensuite des hypothèses de rendement attendu robustifiées si leur modèle et leurs données sont justifiés.
- Des plafonds de poids protègent de la concentration par *instrument* ; ne pas faire croire qu'ils plafonnent les expositions sous-jacentes.

### Robustesse — `robust`

- **Phase 4** : générateur de scénarios en bloc pour les actifs, et hypothèses économiques explicitement déclarées.
- Objectif exact à arbitrer : quantile défavorable du CAGR, mesure pénalisant la fragilité, ou regret. Documenter avant implémentation.
- Calibration de l'objectif, pénalités et scénarios sans regarder la période OOS du walk-forward.
- Les années peuvent être rééchantillonnées **conjointement** pour préserver les co-mouvements instantanés entre actifs ; cela ne reproduit pas nécessairement les dépendances dans le temps. Tester une variante par blocs pluriannuels si l'historique le permet.
- Rapporter les sensibilités et les hypothèses ; des séries annuelles courtes ne justifient pas des probabilités très précises.

### Objectif patrimonial — `goal`

- **Phase 5** : entrées capital initial, versements, horizon, capital cible, inflation et convention de dates.
- Simuler le capital de fin d'horizon sur des trajectoires multiples ; scorer la proportion de scénarios atteignant l'objectif, sous contrainte de risque et sans incitation à une concentration illimitée.
- Afficher capital médian, intervalle, quantiles défavorables, probabilité **conditionnelle aux hypothèses**.
- Si la cible est réelle, actualiser les flux et la cible en euros constants ; ne pas comparer un objectif nominal à des trajectoires réelles.

## 6. Moteur de validation walk-forward (phase 3)

### 6.1 Procédure

1. Fixer l'univers admissible, les contraintes et une politique de fenêtres **avant** d'observer les résultats OOS.
2. Pour une coupure historique `T` : utiliser seulement des rendements `<= T` pour choisir les poids et tous les hyperparamètres de la stratégie.
3. Obtenir une allocation `w(T)`, ou un échec d'optimisation documenté.
4. Sur `T+1…T+k` : appliquer cette allocation à poids cibles avec **rééquilibrage annuel** (pas d'optimisation a posteriori pendant le bloc de test).
5. Répéter avec une nouvelle coupure et agréger les **rendements annuels hors échantillon chronologiquement** en une trajectoire composée.
6. Confronter aux benchmarks et à la version Personnalisée à poids fixes ; rapporter métriques, nombre de fenêtres, périodes, hypothèses et données manquantes.

Première proposition : **apprentissage expansif**, test de **5 ans** sans chevauchement, apprentissage minimal par défaut de **20 ans** lorsque possible. Ces valeurs sont **à valider**, et le moteur doit permettre de les modifier. Pas de faux test lorsque Bitcoin ou une série récente réduit trop l'historique commun.

### 6.2 Particularités fondamentales

- L'univers doit être **investissable/observable au moment du test** : identifier séries rétroconstruites et indices disponibles seulement ex post. Un indice historique calculé ex post doit être étiqueté comme approximation, pas comme placement réalisable à l'époque.
- Si la phase 4 a besoin de scénarios, ils seront calibrés *dans chaque période d'entraînement*, sans observer la période de test ; idem pour la phase 5.
- Les résultats de toutes les méthodes doivent utiliser les **mêmes années de test** pour être comparables.
- Ne pas assimiler l'application rétrospective de pondérations manuelles choisies aujourd'hui à une stratégie de sélection sans information future. L'étiqueter « simulation de poids fixes », pas preuve d'anticipation.
- Distinguer : `backtest complet in-sample`, `walk-forward hors échantillon`, `projection par scénarios`.
- Les tests OOS successifs ne rendent pas les décennies passées indépendantes : interpréter avec prudence.
- Si l'historique commun est trop court, afficher **« Validation indisponible / insuffisante »**, sans extrapolation silencieuse.

### 6.3 Benchmarks

- Equipondération sur **le même univers d'actifs éligibles**, rééquilibrée annuellement.
- Allocation Personnalisée à poids cibles fixes, si toutes ses séries sont disponibles sur la période.
- Benchmark de marché indépendant (par exemple MSCI World si la même période est couverte et conventions comparables).
- Eventuellement « buy-and-hold » distinct de « allocation rééquilibrée annuellement », mais ne pas confondre les deux règles de gestion.

## 7. Conception des contraintes et recouvrements d'indices

Trois couches distinctes, avec des fonctions et limitations explicitement affichées :

1. **Poids de capital** (phase 2) : poids maximum de chaque actif/ETF/indice, sans présumer qu'il est économiquement indépendant.
2. **Risques statistiques** (phases 1–3) : covariance sur années communes, contributions au risque, drawdown annuel, corrélations. Détecter des redondances potentielles mais **ne pas inférer un recouvrement exact depuis une corrélation élevée**.
3. **Exposition économique** (phase 6) : données de composition ou catégories sourcées et horodatées ; par exemple la part réellement exposée aux actions américaines via S&P 500 et MSCI World. Gérer recouvrements et métadonnées manquantes.

Tout plafond sur exposition « US », « actions », « crédit », etc. doit être alimenté par des métadonnées suffisantes et datées ; sinon ne pas activer ce contrôle comme s'il était exact.

## 8. Stratégie de tests (phase 1 et suite)

Installer un outil de test adapté au projet TypeScript/Vite (Vitest convient ; choix réversible). Créer au moins :

- **Tests de conformité des données** : années triées, doublons, niveaux sans rendement, trous, non-finies, métadonnées discordantes.
- **Calculs à la main** : CAGR composé, drawdown de fin d'année, volatilité, rééquilibrage, effet d'une année à −50 % suivie de +100 %.
- **Conversion** : USD→EUR, change nul, taux réels/inflation, seuils 0 % et données absentes.
- **Diversification** : deux actifs indépendants 50/50 vs 90/10, corrélation hors diagonale, variance avec diagonale, ratio de diversification.
- **Contraintes** : somme 100 %, long-only, plafond par actif, aucun candidat faisable, cas avec un seul actif.
- **Optimisation** : solutions connues sur petit univers, déterminisme, effet de la granularité.
- **Walk-forward** : données futures volontairement modifiées **sans effet sur les poids antérieurs** ; dates de test strictement après dates de train ; composition du CAGR OOS ; trous / périodes insuffisantes.
- **Scénarios et objectif** : graine fixe, trajectoires connues, versements déterministes, objectif nominal/réel, probabilité dans [0, 1].
- **Non-régression UI** : les contrôles existants et la modification manuelle des pondérations continuent de fonctionner.

Pour chaque PR : publier les commandes exécutées et leurs résultats ; ne pas déclarer les tests « passés » sans les avoir exécutés.

## 9. Décisions, points ouverts et mise à jour

### Décisions validées

- Un seul onglet Portefeuille / Construction–Comparaison–Validation.
- Trois profils automatiques, tous sous contraintes comparables.
- Mode Personnalisée conservé ; comparaison des poids fixes vs stratégie re-optimisée.
- Walk-forward comme validation transverse ; données annuelles acceptées avec limites explicites.
- Concentration statistique immédiate puis économique sourcée, sans confondre indices et expositions.
- Branches + Pull Requests par phase ; pas de fusion silencieuse.

### Choix techniques/probabilistes à trancher en phase concernée

- Contrats TypeScript exacts, découpage final des dossiers et politique de gestion des erreurs.
- Paramètres par défaut des contraintes ; convention du taux sans risque.
- Granularité/algorithme de recherche et garanties d'optimalité.
- Forme exacte des scénarios, pondération des futurs possibles, objectifs de Robustesse.
- Méthode de simulation patrimoniale, convention des versements et traitement des frais.
- Fenêtres walk-forward par défaut et politique si insuffisance de données.
- Sources, dates et qualité des informations de composition économique.

### Politique de maintenance

À chaque phase fusionnée, mettre à jour :
1. L'état de la phase dans `ROADMAP.md` et sa recette cochée.
2. Les éléments « Existant » / « Cible » de ce document et les éventuelles décisions nouvelles.
3. Les scripts de build/tests et les limites reconnues.
4. Si la documentation diverge du code, **signaler la divergence**, ne pas supposer que l'implémentation existe.

## 10. Démarrage / transmission à Codex ou OpenCode

```bash
git pull
npm install
npm run dev
npm run build
# npm test sera ajouté pendant la phase 1
```

Lire `README.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md` puis les fichiers concernés. Avant toute implémentation, rappeler la phase demandée, les décisions validées, les hypothèses ouvertes et les risques de régression. Ouvrir une PR sur branche dédiée, joindre tests et statut ; ne pas modifier `main` directement.
