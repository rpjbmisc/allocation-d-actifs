# Composition du portefeuille : méthodologie, preuve et limites

Mise à jour : 14 novembre 2026. Ces informations sont **des instantanés d'indices**, pas les poids historiques des années du backtest ni les positions réellement détenues dans les ETF.

## 1. Trois objets différents

- **Pays / zones** : classification de l'indice, pas provenance du chiffre d'affaires des sociétés.
- **Tailles** : Large / Mid / Small calculées ou estimées à partir de la capitalisation flottante, jamais depuis les rendements.
- **Styles économiques** : Value / Blend / Growth au **niveau des entreprises**, selon une méthodologie homogène (non calculables sans données de positions ou d'analyse stylistique comparables).
- **Biais explicites** : stratégie de sélection/pondération de l'indice (Value, Growth ou Quality). Il ne s'agit pas de la proportion économique des entreprises Value/Blend/Growth. Quality est transversal : une entreprise Value peut aussi être Quality.

Les deux derniers indicateurs sont séparés dans l'interface ; par conséquent, un indice non orienté factoriellement n'est pas équivalent à 100 % Blend ni à 0 % Value.

## 2. Traçabilité des tailles

Le registre `public/data/asset_exposures.json` contient `sizes`, `sizeMethod`, `sizeSource` et `sizeAsOf`.

- **Mesuré** : ratio de la capitalisation flottante du sous-indice *Mid Cap* sur celle de l'indice *Standard*, dans la **même devise** et **au même mois**. Exemple : MSCI World juin 2026, 12 845 389,18 / 89 113 902,65 = 14,4146 % Mid ; 85,5854 % Large. MSCI Europe juillet 2026 : 2 068 878,79 / 12 421 163,05 = 16,6561 % Mid, 83,3439 % Large. Sources dans le registre.
- **Estimé** : quand les deux instantanés ne sont pas disponibles au même mois, utiliser les *cibles de couverture* de la méthodologie MSCI : Large 70 %, Standard 85 %, IMI 99 % de l'univers investissable flottant. À l'intérieur d'un indice Standard, Large 70/85 et Mid 15/85 ; à l'intérieur d'un IMI, Large 70/99, Mid 15/99 et Small 14/99. **Ce ne sont pas des pondérations observées** et les véritables couvertures peuvent s'écarter des cibles.
- **Small Cap** : lorsque l'indice suit explicitement ce segment, la poche est Small à 100 % au sens de la **classification MSCI**, même si certains titres ont grandi depuis la dernière revue.
- **Non détaillé** : ne jamais affecter arbitrairement 50/50 aux indices Large+Mid, ni attribuer 0 % Small aux univers toutes tailles.

La « couverture tailles mesurées » et la part « tailles estimées » sont affichées séparément. Les dimensions pays et tailles peuvent avoir des dates de sources différentes.

## 3. Libellés historiques corrigés

Les deux fichiers `CAGR_msci-usa-small-cap-weighted_ntr.csv` et `CAGR_msci-europe-small-cap-weighted_ntr.csv` restent inchangés par compatibilité (identifiants d'actifs et noms de fichiers conservés). L'application présente désormais les noms **MSCI USA Small Cap Value Weighted** et **MSCI Europe Small Cap Value Weighted**.

- Pour les États-Unis, les rendements annuels USD NTR 2021–2025 correspondent exactement aux données MSCI de l'indice Value Weighted ; les fonds ZPRV sont liés à cet indice.
- Pour l'Europe, les performances du CSV exprimées en USD semblent correspondre aux rendements MSCI Europe Small Cap Value Weighted en EUR après conversion de devise. Cette identification reste indirecte, car nous n'avons pas ici le tableau USD NTR officiel année par année. Le biais Value s'appuie sur cette identification et doit être revalidé si la source initiale du CSV diffère.
- **Weighted ≠ Value Weighted** par définition : c'est la concordance des séries et la documentation du fournisseur qui justifient la correction, pas le nom court.
- Les rendements ne sont pas retouchés par cette intervention.

## 4. Styles Value / Blend / Growth

Le registre permet un éventuel champ `styles: {Value, Blend, Growth}` dont la somme doit être 100 %. **Aucune série globale n'a été imputée par défaut.**

Pour remplir ce champ de façon fiable, il faut un échantillon homogène de positions et une méthode cohérente (par exemple une classification Morningstar/Sustainalytics ou la méthode de MSCI, pour toutes les zones, à une date proche). Des découpages approximatifs construits à partir du seul nom de l'indice produiraient de la fausse précision.

L'application affiche donc « Style non documenté » lorsqu'on manque de données, tout en indiquant séparément les biais Value des indices concernés.

## 5. Vérifications et limites

- Des tests automatisés vérifient la normalisation à la poche actions, la distinction mesures/estimations, le calcul des biais explicites et l'absence d'invention des styles.
- Un changement d'allocation recalcule toutes les dimensions ; les composants Construction et Comparaison partagent la même fonction.
- **Ne pas** comparer un backtest 1994–2025 à une exposition 2026 comme si l'exposition avait été constante pendant toute la période.
- Expositions comparables seulement au regard des méthodologies et dates ; des ETF filtrés ESG/Screened peuvent s'écarter des indices bruts.
- Si l'on souhaite un véritable pourcentage Quality économique, il faut analyser les lignes du portefeuille et le score financier de chacune : la présence d'un indice Quality ne signifie pas que 100 % des sociétés sont de « qualité » selon une métrique universelle.

Sources générales :
- [MSCI Global Investable Market Indexes Methodology, mai 2025](https://www.msci.com/indexes/documents/methodology/1_MSCI_Global_Investable_Market_Indexes_Methodology_20250513.pdf)
- [MSCI USA Small Cap Value Weighted](https://www.msci.com/indexes/index/139249/msci-usa-small-cap-value-weighted-index)
- [MSCI Europe Small Cap Value Weighted](https://www.msci.com/indexes/index/139245/msci-europe-small-cap-value-weighted-index)
