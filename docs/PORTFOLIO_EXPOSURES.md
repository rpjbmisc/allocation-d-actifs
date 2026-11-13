# Composition économique des allocations — version initiale

Cette fonctionnalité est issue du cahier des charges « Construction / Comparaison » du 13 novembre 2026, indépendamment des phases historiques de ROADMAP.

## Fonctionnalités

- Sous les principaux KPI de Portefeuille > Construction, quatre ventilations : zones, pays, tailles et **biais factoriels des indices**.
- Dans Portefeuille > Comparaison, choix libre de deux allocations (Personnalisée sauvegardée, Croissance, Tout-terrain, Objectif patrimonial, équipondérée, MSCI World) et tableau A/B avec écart B−A en points.
- Seule la **poche actions** est normalisée à 100 % pour ces ventilations ; l'application affiche séparément les proportions actions, autres actifs et non classés dans le portefeuille complet.
- Aucun détail « taille et facteur à l'intérieur de chaque zone ».
- Aucun effet sur les calculs de rendement et les moteurs d'optimisation.

## Référentiel

`public/data/asset_exposures.json` contient des photographies de données par indice : date, source, pays connus, groupe « Autres », univers de tailles et biais explicitement ciblé. Chaque actif du registre des rendements doit être classé en `equity` ou `other`, ou demeure « non classé » si sa fiche manque. Les parts publiées doivent totaliser 100 % (tolérance limitée aux arrondis).

Les **pays non détaillés** restent inconnus ; les groupes `EU_OTHER`, `ASIA_EM_OTHER` et `PACIFIC_OTHER` permettent de conserver la zone quand elle est connue sans inventer de pays. La précision pays mesure la fraction de la poche actions attribuée à des pays nommés, pas la qualité des sources.

Les tailles `large_mid` et `all_caps` ne sont jamais divisées arbitrairement en grandes, moyennes et petites capitalisations : cela conduirait à inventer un résultat. L'indice S&P 500 est classé « grandes capitalisations » et le Russell 2000 « petites capitalisations » par leur méthodologie de sélection, sans prétendre que leurs frontières de capitalisation soient universelles.

La dimension « Facteurs » est une **orientation des indices** :
- `factor: value` signifie indice à biais Value explicite ;
- `factor: growth` et `factor: quality` sont réservés aux indices dont la méthodologie les vise ;
- `factor: none` signifie « sans biais factoriel explicite documenté » et **non** « 100 % Blend ».

Elle ne prétend **pas** reconstruire la répartition réelle Value / Blend / Growth ou le degré de Quality des entreprises sous-jacentes. Quality chevauche Value, Blend et Growth et n'est pas une quatrième catégorie exclusive. Une répartition complète exige un fournisseur de holdings et une méthodologie homogène.

## Sources et dates

Certaines fiches MSCI affichent seulement cinq pays, puis « Other » ; certaines sont antérieures aux autres. Pour reproduire les nombres, utiliser la date `asOf` enregistrée et la page `source` de chaque actif. Ne pas interpréter la photographie comme une exposition applicable aux historiques de rendement ou aux fenêtres de backtest.

Le fichier contient des classifications d'indices sans pourcentage détaillé quand les chiffres n'ont pas été vérifiés. Les actifs absents du registre d'expositions conservent une classe « non classé » plutôt que de disparaître.

L'agrégateur est `src/domain/exposures.ts`, sans React et sans accès réseau ; l'interface est `src/components/portfolio/ExposurePanels.tsx`. Tests dédiés : `src/tests/exposures.test.ts`.

## Limites connues

- Les REIT et les infrastructures ne sont pas incorporés à la poche actions dans cette version prudente, faute de vérification homogène de leurs composants sous-jacents.
- L'index `MSCI World Small Cap Value` et les indices `Small Cap Weighted` ne suffisent pas à reconstituer tous les pays.
- Les groupes « Autres » peuvent cacher des zones différentes et diminuent la précision géographique affichée.
- Les données ne sont pas rafraîchies automatiquement et aucun recouvrement ligne par ligne entre indices n'est calculé.
- Dans Comparaison, Personnalisée prend **les poids sauvegardés** et pas les poids du profil automatiquement affiché.

## Complément du 13 novembre 2026 : détail géographique enrichi

Les fiches MSCI synthétiques ne publient souvent que 5 pays et un agrégat Autres. Pour améliorer la couverture, le fichier d'expositions s'appuie, quand les fiches MSCI ne suffisent pas, sur les **ventilations pays d'ETF qui suivent l'indice concerné**, et porte alors `basis: "proxy_etf"`. Les données sont des estimations très proches mais pas nécessairement identiques aux poids de l'indice (tracking, ajustements, trésorerie, etc.).

- MSCI Pacific ex Japan IMI : les quatre pays directement publiés par MSCI, au 31 juillet 2026.
- MSCI Europe : proxy ETF State Street SPDR MSCI Europe au 13 octobre 2026, tous les pays détaillés.
- MSCI Emerging Markets : proxy ETF State Street SPDR MSCI Emerging Markets au 7 août 2026, 26 pays.
- MSCI World : proxy ETF State Street SPDR MSCI World au 4 novembre 2026, 23 pays.
- MSCI World ex USA : **calcul dérivé** des poids pays du proxy MSCI World (hors États-Unis, puis renormalisé), à la même date.
- MSCI World Small Cap Value : pays listés dans la fiche de cet indice (et non de sa variante Value Weighted), au 31 juillet 2026.
- MSCI World Value : cinq pays fournis dans la composition MSCI au 30 juin 2026.

Le sous-ensemble MSCI Europe Small Cap Weighted reste en bloc Europe : sans confirmation que les rendements correspondent exactement à l'indice *Value Weighted* ou à une autre méthodologie, réutiliser les pondérations du fonds ZPRX serait une extrapolation non justifiée. Des indices multi-pays non complètement documentés peuvent toujours afficher « Autres », de manière intentionnelle.

Le statut `basis` et les notes sources sont affichés dans le volet « Sources et limites ». Les données ne sont pas des expositions géographiques historiques ni une cartographie des ventes géographiques des entreprises.
