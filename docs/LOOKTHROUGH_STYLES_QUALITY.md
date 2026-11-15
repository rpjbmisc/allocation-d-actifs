# Analyse partielle « look-through » : styles et rentabilité

**Instantané :** novembre 2026. **Ce module n'est pas une classification complète du portefeuille.**

## Sources et périmètre

- [MSCI World](https://www.msci.com/indexes/index/990100/msci-world-index) — dix principales lignes au 30/10/2026.
- [MSCI Emerging Markets](https://www.msci.com/documents/10199/10c3f32f-4565-4a92-aa1c-edf6f3a4e03f) — dix principales lignes au 30/10/2026.
- [MSCI Emerging Markets Asia](https://www.msci.com/indexes/index/899700/msci-em-asia-index) — dix principales lignes au 30/10/2026.
- [MSCI Europe](https://www.msci.com/indexes/index/990500/msci-europe-index) — dix principales lignes au 30/10/2026.
- [Morningstar Stock Style Box](https://www.morningstar.com/investing-terms/stock-style-box) — étiquette Value/Core/Growth individuelle ; **Core est rangé dans Blend** pour le graphique. La date de cette étiquette n'est pas nécessairement identique au mois des positions MSCI. Chaque étiquette enregistrée renvoie à sa source.
- [Morningstar fiches de titres](https://www.morningstar.com/stocks/xnas/nvda/quote) — ROIC normalisé individuel, si la valeur a pu être vérifiée sur la page publique. Les titres sans ROIC publié restent inconnus.

Les références et observations exactes sont stockées dans `public/data/index_lookthrough.json`.

**Important :** le registre décrit les **indices**, pas les positions physiques détenues par WPEA/PAASI/PAEEM ni le panier de substitution d'un ETF synthétique. Ces ETF peuvent utiliser une réplication indirecte, des exclusions ESG et des conditions différentes. Ce calcul est une approximation de l'exposition économique à un **indice de référence**, pas un audit complet d'ETF.

## Méthode de calcul

Pour un indice à poids `w` dans les actions et une société de poids `h` dans l'indice, sa contribution aux styles/ROIC est `w × h / 100`. On ne renormalise **jamais** les titres observés (top 10) à 100 %. Tout poids non analysé reste « non documenté ».

Le moteur valide que les positions ont un poids fini, non négatif, qu'aucune valeur ne figure deux fois dans un indice et que leur poids agrégé n'excède pas 100 %. Un snapshot invalide est ignoré. Les dates et sources sont documentées.

La **couverture des positions** indique combien de l'allocation est identifié dans des lignes publiées ; la **couverture du style** et la **couverture ROIC** peuvent être inférieures car certains titres n'ont pas encore de classification vérifiée. Les graphiques couvrent toujours 100 % de la poche actions, inconnues incluses.

## Ce que mesure « Qualité (proxy) »

Le module n'utilise **pas** le score « MSCI Quality » (qui repose notamment sur ROE, stabilité des bénéfices et endettement). Il distingue seulement :
- `ROIC normalisé ≥ 15 %` : rentabilité élevée selon un **seuil illustratif**, non une vérité universelle.
- `ROIC normalisé < 15 %`.
- `ROIC non documenté`.

Le ROIC n'est pas une mesure universellement comparable pour les banques/assureurs. Aucun nombre n'est inventé pour eux.

## Limites

1. L'échantillon est majoritairement composé des plus grosses positions mondiales ; il est **biaisé vers les mégacapitalisations**. Il ne représente pas la distribution réelle Value/Blend/Growth de chaque indice complet.
2. Les poids MSCI et classifications Morningstar sont proches dans le temps mais **pas synchronisés exactement**.
3. Les séries historiques annuelles et les optimisations ne sont pas touchées. Il ne faut jamais rétroprojeter cet instantané sur 1994–2025.
4. Sans fichier complet de positions, de classification stylistique homogène et de scores de qualité comparables, impossible d'afficher honnêtement 100 % des styles ou le facteur MSCI Quality exact.

## Étape suivante pour une couverture quasi complète

Importer des positions exhaustives d'un émetteur ou d'un indice, puis y joindre des classifications et métriques vérifiables au moyen d'une source sous licence (ou d'un fichier exporté explicitement avec autorisation). Prévoir identifiants ISIN/FIGI, classe de titre, date de pondération, source et devise. Ne pas utiliser les dates d'un portefeuille historique pour attribuer des styles actuels.

## Extension de novembre 2026 : inventaires ETF complets

La routine `scripts/refresh_holdings_audit.py` télécharge les fichiers de positions quotidiennes de cinq ETF physiques State Street représentatifs (SPPW, SPYM, ERO, ZPRV, ZPRX), vérifie leurs poids et produit un **JSON agrégé uniquement**, sans republier toutes les positions. Elle fonctionne avec Python standard, sans dépendance Excel, à partir du ZIP/XLSX source. Un workflow dédié `.github/workflows/holdings-audit.yml` valide l'import et dépose un artefact consultable.

**Exécution vérifiée le 15 novembre 2026**, sur les portefeuilles au 12 novembre 2026 :

| ETF proxy | Positions | Top 10 (%) | Styles individuels documentés (%) |
| --- | ---: | ---: | ---: |
| SPPW — MSCI World | 1 237 | 26,42 | 27,75 |
| SPYM — MSCI Emerging Markets | 1 175 | 36,46 | 17,40 |
| ERO — MSCI Europe | 384 | 21,70 | 8,61 |
| ZPRV — USA Small Cap Value Weighted | 1 623 | 5,53 | 0,00 |
| ZPRX — Europe Small Cap Value Weighted | 799 | 9,41 | 0,00 |

`public/data/holdings_audit.json` conserve les agrégats vérifiés : nombre de positions, secteurs GICS, et pondérations stylistiques documentées / non documentées. **5 218 lignes de positions** sont prises en compte, avec de possibles doublons d'entreprises entre ETF.

Les 15 observations de style préexistantes ont été rapprochées des positions sur les **ISIN** dans `scripts/stock_styles_seed.csv`. Elles ne sont **pas** une base exhaustive de classifications ; sans correspondance étayée, le titre demeure « non documenté ». Les informations de style viennent de pages publiques Morningstar précédemment relevées et peuvent ne pas être synchronisées exactement avec le 12 novembre 2026.

Le calcul prend désormais en priorité les agrégats stylistiques de l'inventaire **complet** lorsqu'ils existent, plutôt que les estimations de couverture des dix premières lignes. Les autres indices (notamment MSCI EM Asia et Pacific ex Japan IMI) restent sur les photographies limitées ou inconnues. La rentabilité/ROIC reste une dimension séparée, basée sur un échantillon de titres vérifiés.

### Pour actualiser ou étendre la classification

```bash
python3 -m unittest discover -s scripts -p 'test_refresh_holdings_audit.py'
python3 scripts/refresh_holdings_audit.py \
  --styles-csv scripts/stock_styles_seed.csv \
  --output holdings-audit.json
```

Le CSV facultatif des classifications doit contenir `isin,style,source`, avec `Value`, `Blend` (ou `Core`), `Growth`, et une URL HTTPS de provenance par ligne. On peut substituer un référentiel enrichi dont l'utilisation est autorisée, sans devoir publier le référentiel intégral. Aucune classification de titres ne doit être inférée automatiquement du secteur ou du nom de l'indice.

**Limites persistantes :** une couverture complète des positions n'entraîne pas une couverture complète des styles ; il manque toujours des classifications pour la majorité des entreprises. Le fonds physique servant de proxy peut différer d'un indice MSCI exact, d'un ETF synthétique ou ESG ; les secteurs publiés ne sont pas la preuve d'un profil Growth/Value. La publication du résumé ne vaut pas redistribution des fichiers bruts.
