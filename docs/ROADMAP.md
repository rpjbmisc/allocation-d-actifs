# Feuille de route — Allocation d'actifs

> **Document de pilotage** · Créé le 18 octobre 2026 · Référence de travail pour ChatGPT, Codex et OpenCode.
>
> **Statut** : phases 0 et 1 fusionnées (#1, #2) ; phase 2 implémentée sur branche dédiée, en attente de revue et de fusion ; phases 3 à 6 non commencées. Mettre à jour les statuts **après fusion** des changements correspondants dans `main`.

## 1. Vision et périmètre

Construire une application d'aide à la **définition d'une allocation cible de long terme** : chercher une croissance annualisée (TCAM/CAGR) élevée, tout en maîtrisant les pertes, la concentration et la dépendance à une seule période historique.

L'application est un outil d'**analyse et de simulation**, pas une promesse de rendement ni un conseil financier automatisé.

### Décisions validées (à conserver)

1. **Un seul onglet « Portefeuille »** et trois espaces internes : **Construction**, **Comparaison** et **Validation**. Pas un onglet par méthode.
2. **Trois profils automatiques** :
   - **Croissance** : maximiser le CAGR (d'abord historique, puis éventuellement attendu) sous contraintes configurables ;
   - **Robustesse** : privilégier des résultats acceptables dans différents scénarios, sans dépendance excessive à un régime passé ;
   - **Objectif patrimonial** : maximiser la probabilité simulée d'atteindre un capital cible sur un horizon choisi, sous contraintes de risque.
3. **Pondérations manuelles conservées** dans Construction. Une proposition peut être ajustée ; elle devient une allocation **Personnalisée**, sans modifier la définition du profil automatique d'origine.
4. **Comparaison** : montrer côte à côte les trois propositions automatiques, l'allocation Personnalisée, et des références simples (équipondérée, éventuellement MSCI World selon disponibilité).
5. **Validation** : un même moteur **walk-forward** teste les méthodes automatiques hors échantillon. L'allocation Personnalisée est évaluée séparément comme **allocation à poids cibles fixes avec rééquilibrage annuel**, afin de distinguer les deux expériences.
6. **Données annuelles maintenues** : ne pas conditionner le projet à des données mensuelles. Toujours préciser que drawdown, volatilité et crises sont observés **aux dates annuelles seulement**.
7. **Concentration** : des indices différents peuvent recouvrir les mêmes expositions (ex. S&P 500 et MSCI World) ; ne pas confondre nombre d'actifs et diversification économique.
8. Garder corrélation, ratio de diversification et contributions au risque comme **diagnostics**, pas comme critères arbitraires de profil. La moyenne de corrélations entre actifs distincts doit exclure l'autocorrélation (diagonale), tout en conservant la diagonale dans les calculs corrects de variance/covariance.
9. **Travail incrémental** : une phase = branche dédiée + tests + Pull Request ; aucune fusion automatique dans `main` sans validation.

### Non-objectifs immédiats

- Acquisition obligatoire de séries mensuelles, intrajournalières ou en temps réel.
- Trading, recommandations d'achat d'ETF, intégration courtier ou exécution d'ordres.
- Projection présentée comme une vérité statistique ; une probabilité simulée est toujours **conditionnelle aux hypothèses**.
- Refonte complète de l'interface pendant la phase de fiabilisation du moteur.

## 2. Expérience utilisateur cible

### Construction

- Choisir l'univers d'actifs, la devise (EUR/USD), la lecture (nominal/réel), une période historique et des hypothèses explicites.
- Choisir Croissance, Robustesse ou Objectif patrimonial.
- Configurer les contraintes communes : allocation totale 100 %, pas de poids négatifs (pas de vente à découvert), poids maximum par actif, limite de risque mesurée **sur des observations annuelles**, rééquilibrage annuel.
- Obtenir une proposition + les métriques de rendement/risque + les avertissements de fiabilité.
- **Modifier librement les curseurs de pondération existants** ; afficher le mode « Personnalisée » et permettre de réappliquer la proposition automatique sans perdre les paramètres choisis.

### Comparaison

- Tableau homogène des profils et de Personnalisée : pondérations, CAGR (historique et, si disponible, projeté **distinctement**), volatilité, drawdown annuel, diversification et robustesse.
- Comparaison à période, devise, coûts, hypothèses et contraintes identiques ; afficher « non comparable » si ce n'est pas possible.
- Différencier explicitement **résultat in-sample**, **hors échantillon** et **simulation prospective**.

### Validation

- Paramétrer des fenêtres d'apprentissage et de test (exemple indicatif : 20 ans / 5 ans, à adapter à l'historique disponible).
- Optimiser les stratégies sur les données **connues à la date de décision**, geler les poids pour la période de test (rééquilibrage annuel vers ces poids cibles), puis répéter.
- Comparer le CAGR géométrique hors échantillon composé sur l'ensemble des tests, la volatilité, le drawdown annuel, la stabilité des poids, le nombre d'années/fenêtres testées et les références.
- Test de Personnalisée = poids cibles choisis aujourd'hui appliqués rétrospectivement aux fenêtres ; **ce n'est pas une stratégie historiquement réoptimisée**.
- Avertir lorsque les tests sont trop peu nombreux ou absents ; ne jamais présenter un score fiable si les données sont insuffisantes.

## 3. Phases, dépendances et définition de « terminé »

| Phase | Statut initial | Dépendances | Livrable principal |
|---|---|---|---|
| **0. Cadrage** | Fusionnée (#1) | Aucune | ROADMAP, ARCHITECTURE, lien depuis README |
| **1. Fondations financières** | Fusionnée (#2) | 0 | Moteur modulaire + tests de référence + invariants |
| **2. Profil Croissance** | Implémentée, à revoir (non fusionnée) | 1 | Optimisation CAGR sous contraintes communes + édition manuelle |
| **3. Validation walk-forward** | À faire | 2 | Backtests temporels hors échantillon + comparateur |
| **4. Profil Robustesse** | À faire | 3 | Moteur de scénarios + objectif robuste + validation |
| **5. Objectif patrimonial** | À faire | 4 | Simulation d'épargne/capital + probabilité conditionnelle |
| **6. Concentration économique** | À faire | 1–5 | Métadonnées d'exposition + contraintes de recouvrement |

La phase 6 peut être commencée plus tôt en mode exploratoire ; son contrôle économique **complet** dépend de métadonnées vérifiables. La structure de données permettant son ajout ne doit pas être bloquante pour les phases 2–5.

### Phase 0 — Documentation et passage de relais

- [x] Formaliser les décisions métier, les trois profils, le parcours Construction / Comparaison / Validation.
- [x] Documenter les choix financiers et le fonctionnement actuel dans `ARCHITECTURE.md`.
- [x] Définir les critères de recette de chaque phase et la manière de reprendre le travail dans une nouvelle conversation.
- [x] Prévoir un lien depuis le README.
- [x] Faire relire et **fusionner** la Pull Request dans `main` (#1).

**Recette** : les deux documents existent dans `docs/`, les liens fonctionnent, aucun calcul ou comportement de production n'est modifié, `main` reste intact avant fusion.

### Phase 1 — Fondations, audit et tests (priorité immédiate)

Travaux :
- Extraire progressivement les fonctions métier de `src/analytics.ts` et la logique de calcul de `src/App.tsx` sans changer visuellement l'application.
- Isoler : chargement/normalisation, conversion de devise et inflation, séries de rendements, simulation de portefeuille, métriques, contraintes, optimisation, simulation et validation.
- Établir une **règle unique de gestion des données** : année initiale sans rendement, continuité et années communes, valeurs manquantes, nombre minimal d'observations, séries incohérentes.
- Documenter et tester les hypothèses de conversion de devise (USD/EUR non couverte), d'inflation française, de rééquilibrage annuel et de calcul géométrique.
- Corriger/clarifier les indicateurs ambigus : Sharpe actuel = moyenne brute / volatilité (pas un Sharpe excédentaire conventionnel) ; corrélation pondérée avec diagonale ; ratio de diversification sur années communes.
- Ajouter des tests unitaires et des fixtures déterministes ; garder les observations historiques inchangées sauf corrections tracées.

**Recette** :
- `npm run build` réussit ; `npm test` passe après ajout d'un script de test.
- Séries synthétiques testées : rendement constant, pertes et reprise, corrélations 0 / +1 / −1, portefeuille monoactif et multi-actifs, poids qui ne somment pas à 100, rééquilibrage, données manquantes, change/inflation.
- Pas de CAGR artificiellement bon obtenu en sautant des années manquantes ; les échecs ou historiques insuffisants sont explicites.
- Les valeurs clés de l'interface existante sont contrôlées par des tests de non-régression ou leurs écarts sont expliqués et approuvés.

#### Livraison de phase 1

- Extraction derrière `src/analytics.ts` : données/alignement, devises/inflation,
  métriques, portefeuille/rééquilibrage, séries graphiques, diversification,
  contraintes et recherche historique. Le chargement réseau est séparé du domaine.
- Politique unique : années contiguës et complètes ; seule une véritable valeur
  initiale sans rendement peut être exclue. Les raisons d'échec sont disponibles
  via `alignAnnualSeries`. L'interface affiche un historique indisponible plutôt
  qu'un CAGR calculé en sautant des années.
- Rendements et volatilités en pourcentage ; poids saisis normalisés explicitement
  en fractions. Poids négatifs/non finis refusés. Un rendement suffit au CAGR ;
  au moins deux sont nécessaires à la volatilité/corrélation.
- Tests synthétiques, audit des 15 séries, références historiques avant refactoring
  dans les quatre modes devise/lecture et tests des contrôles React. `npm test`
  et `npm run build` ; workflow CI de validation ajouté aux Pull Requests.
- Corrections soumises à revue : corrélation pondérée hors diagonale, diagnostic
  sur les mêmes années que le portefeuille, récupération après perte en première
  année, perte totale à −100 %, indisponibilité des périodes incomplètes et
  clarification du ratio brut/volatilité. Détails et limites dans
  [ARCHITECTURE §11](ARCHITECTURE.md#11-fondations-livrées-en-phase-1).
- Observations historiques et interface visuelle conservées. Les libellés
  méthodologiques sont précisés ; les seuils des anciens profils restent hérités,
  leur remplacement relève de la phase 2. Walk-forward et simulations prospectives
  restent explicitement réservés aux phases 3–5.

La phase 1 a été revue et fusionnée dans `main` via la PR #2. La phase 2
ci-dessous reste soumise à revue et cette branche ne modifie pas `main`.

### Phase 2 — Optimisation Croissance sous contraintes

Travaux :
- Construire une interface commune d'optimiseur `optimize(strategy, inputs, constraints)` (nom indicatif), indépendante de l'UI.
- Maximiser le CAGR **historique** sur la période d'apprentissage choisie, sous contraintes : somme des poids, long-only, poids plafond, drawdown de **clôture annuelle**, éventuellement volatilité.
- Rendre le budget de risque et la concentration configurables ; ne pas fixer arbitrairement « 40 % » ou « 35 % » comme universels.
- Respecter le mode Personnalisée et recalculer toutes les métriques après édition.
- Remplacer les seuils « diversification modérée/forte » actuellement basés sur corrélation pondérée + diversification ratio.
- Optimisation déterministe et bornée en temps ; reprendre la grille existante comme référence, puis introduire si nécessaire une recherche plus efficace (avec vérification du résultat sur petits cas).

**Recette** : mêmes entrées = mêmes poids ; toutes les contraintes respectées à tolérance définie ; pas de solution impossible maquillée en optimum ; exemple synthétique à optimum connu ; UI inchangée hors nouveaux contrôles ; contrôle manuel préservé.

#### Livraison de cette branche (à valider en revue)

- [x] Contrat indépendant de l'UI : `optimize(strategy, inputs, constraints)` ; la stratégie `growth` maximise le CAGR historique sur la fenêtre fournie.
- [x] Contraintes explicites : long-only, somme à 100 %, plafond par instrument, drawdown de clôture annuelle et volatilité annuelle optionnelle.
- [x] Recherche discrète déterministe et bornée par un nombre maximal d'évaluations ; les mêmes entrées donnent les mêmes poids et une infaisabilité retourne `weights: null`.
- [x] Paramètres UI éditables : drawdown initialement à 40 % pour conserver le comportement historique mais désactivable, volatilité désactivée par défaut et plafond par actif initialement à 100 % (aucun plafond effectif). Ces valeurs ne sont pas des règles universelles.
- [x] Les anciens boutons de diversification fondés sur des seuils corrélation/ratio sont retirés ; corrélation et ratio restent des diagnostics.
- [x] Les pondérations manuelles, la normalisation et le recalcul des métriques sont conservés ; cliquer à nouveau sur Croissance réapplique la proposition sans changer les contraintes.
- [x] Tests déterministes d'optimum connu, contraintes de drawdown/volatilité, infaisabilité, déterminisme, budget de recherche et contrôles UI.
- [ ] Revue et fusion dans `main`.

Limites assumées : la recherche est optimale à la granularité de grille choisie (5, 10
ou 20 points dans l'interface, selon le nombre d'actifs), pas un optimum continu ; les
coûts, la fiscalité et les drawdowns intra-annuels ne sont pas modélisés. La période
reste historique et in-sample ; la validation walk-forward est réservée à la phase 3.

### Phase 3 — Walk-forward commun et comparaison

Travaux :
- Définir des fenêtres chronologiques non chevauchantes pour les tests ; apprentissage expansif dans une première version, apprentissage roulant en option ultérieure.
- N'utiliser pour l'optimisation, le calibrage des seuils et la sélection des actifs que des données disponibles **avant** le début de chaque test ; ne pas ajuster a posteriori les règles à partir du test.
- Tenir compte des dates de début réelles de chaque actif et des proxys reconstruits ; refuser les fenêtres insuffisantes.
- Exécuter une stratégie rebalancée selon sa règle et comparer à Personnalisée (poids fixes), équipondérée et benchmark disponible.
- Permettre de choisir la durée d'apprentissage/test selon la profondeur des historiques ; afficher le faible nombre d'essais et une incertitude qualitative.

**Recette** : tests « sans fuite temporelle » ; résultats de chaque fenêtre reproductibles ; CAGR OOS composé (pas moyenne naïve des CAGR) ; années sans données détectées ; prise en compte explicite des frais/hypothèses si ajoutés ; affichage de « données insuffisantes » pour les fenêtres non valides.

### Phase 4 — Robustesse multi-scénarios

Travaux :
- Construire un moteur de scénarios **conjoints entre actifs** : commencer par des rééchantillonnages d'années historiques *en bloc pour tous les actifs* ; ajouter ensuite des scénarios macroéconomiques documentés.
- Éviter les simulations qui supposent de façon tacite une prévisibilité des rendements ; expliciter hypothèses, horizon, graine aléatoire, nombre de scénarios.
- Tester une fonction robuste candidate (par exemple quantile bas du CAGR simulé, pénalité de fragilité ou regret maximal contrôlé) sur données d'entraînement uniquement.
- Comparer la performance et la stabilité à Croissance et aux références via le walk-forward.

**Recette** : scénarios déterministes avec graine fixe ; corrélations de choc respectées dans l'échantillonnage conjoint ; aucun accès aux données du test lors du calibrage ; sensibilité aux hypothèses présentée ; distinction claire entre données historiques et hypothèses prospectives.

### Phase 5 — Objectif patrimonial

Travaux :
- Paramètres : capital initial, versements annuels ou mensuels agrégés selon convention explicite, horizon, montant cible, devise, objectif nominal ou réel.
- Simuler le capital final et les trajectoires avec l'ensemble des actifs et des corrélations scénarisées ; intégrer calendrier des contributions, rééquilibrage et éventuellement frais.
- Optimiser une probabilité de réussite **conditionnelle aux hypothèses**, assortie d'une contrainte de pertes/volatilité et d'une mesure des issues défavorables.
- Montrer des intervalles et scénarios défavorables, pas une précision trompeuse ; indiquer quand l'objectif est irréaliste avec les paramètres.

**Recette** : scénarios déterministes ; cas calculables à la main (0 % rendement, versement fixe, inflation) ; probabilités dans [0, 1] ; aucune confusion entre rendement réel et objectif nominal ; comparaison fiable avec les deux autres profils.

### Phase 6 — Expositions économiques et concentration

Travaux :
- Modéliser des expositions sous-jacentes horodatées et sourcées : actions US/internationales, styles/facteurs, obligations/taux, crédit, devises et autres si pertinent.
- Repérer les chevauchements : MSCI World + S&P 500 + marché US total ne sont pas trois moteurs de risque indépendants.
- Afficher les concentrations de capital **et** les contributions au risque ; proposer des limites d'exposition économiques seulement si les métadonnées les justifient.
- Quand les données de composition sont absentes, afficher « non mesurable » et conserver des diagnostics statistiques (corrélation, contribution au risque) sans prétendre mesurer un chevauchement exact.

**Recette** : exemples synthétiques d'exposition calculés correctement ; traçabilité des sources/dates ; somme et catégories cohérentes ; information manquante non assimilée à exposition nulle ; aucunes interdictions automatiques basées sur les seuls noms d'indices.

## 4. Garde-fous transversaux

- **Pas de look-ahead** : aucune information postérieure à la date de décision en entraînement, sélection d'actifs ou calibrage ; noter les séries reconstruites rétroactivement.
- **Données comparables** : garder distincts prix, gross/net/total return, frais d'ETF, change et inflation. Certains historiques sont des proxys ; le signaler.
- **Annualité** : le drawdown observé sur valeurs en fin d'année est moins sévère qu'un éventuel drawdown intra-annuel.
- **Éviter la sur-optimisation** : bornes de poids, baselines simples, validation hors échantillon, stabilité et sensibilité des résultats.
- **Traçabilité** : version des règles, inputs, période, graine, contraintes, origine des données et nombre d'observations avec chaque résultat.
- **Interface pédagogique** : distinguer « rendement observé », « scénario simulé » et « probabilité conditionnelle » ; pas de note unique de qualité présentée comme objective.

## 5. Méthode de travail par conversation / outil

1. Lire `README.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, puis les fichiers concernés par la phase.
2. Identifier les **décisions validées** et **points encore ouverts** ; éviter de modifier une décision validée par inadvertance.
3. Créer une branche `feature/phase-N-description` à partir de `main` à jour ; une Pull Request par phase, sans fusionner automatiquement.
4. Implémenter en petits commits testables. Exécuter tests et compilation ; fournir preuves (commandes, résultats, limites).
5. Mettre à jour les deux documents dans la PR : architecture réellement livrée, décisions modifiées, statut, tests et tâches restantes.
6. Après revue et fusion, récupérer les changements en local (`git pull`) pour OpenCode / Codex.

**Consigne de démarrage phase 1 (copiable)** :

> Implémente la phase 1 du projet `rpjbmisc/allocation-d-actifs` selon `docs/ROADMAP.md` et `docs/ARCHITECTURE.md`. Préserve les calculs et l'UI existants sauf correction justifiée, ajoute des tests financiers déterministes, exécute build + tests, et ouvre une PR sur une branche dédiée sans fusionner dans `main`.

## 6. Points à décider au moment de l'implémentation

Ces choix sont **proposés, pas encore validés** :
- Règle exacte de budget de risque et limites de concentration ; pas de valeur universelle présupposée.
- Taille minimale des fenêtres walk-forward et type de fenêtre (expansive/roulante).
- Coûts de transaction, fiscalité, frais et politique précise de versement/rééquilibrage.
- Modèle et pondération des scénarios économiques ; objective robuste exacte.
- Méthode d'estimation prospective des rendements et de l'incertitude.
- Représentation du chevauchement des indices, qualité et date des métadonnées d'exposition.

Ces sujets doivent être tranchés **avant le codage de la phase concernée**, ou faire l'objet d'hypothèses affichées et réversibles.
